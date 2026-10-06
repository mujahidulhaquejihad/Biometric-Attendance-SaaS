"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/components/client";
import { admsCmd, queueCommands } from "@/lib/adapters/adms";
import { audit } from "@/lib/audit";
import { queueRecompute } from "@/lib/jobs";
import { leaveBalances } from "@/lib/leave";
import { parseDateTime, parsePunchRows, readTable, records, type DateOrder } from "@/lib/migrate";
import { assertLimit } from "@/lib/plans";
import { ingestPunches, orgTimezone, type RawPunch } from "@/lib/punches";
import { assertRole, HR } from "@/lib/session";
import { localDate, toDbDate, zonedToUtc } from "@/lib/time";
import { afterSave, employeeSchema } from "../employees/shared";

async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function upload(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose a file first.");
  if (file.size > 20_000_000) throw new Error("File is larger than 20 MB. Split it (for example by month) and import each part.");
  return { name: file.name, table: await readTable(file.name, new Uint8Array(await file.arrayBuffer())) };
}

const preview = (fd: FormData) => fd.get("mode") === "preview";
const dateOrder = (fd: FormData): DateOrder => z.enum(["ymd", "dmy", "mdy"]).catch("ymd").parse(fd.get("order"));
const done = (message: string, details: string[]) => ({
  ok: true,
  message,
  details: details.length > 50 ? [...details.slice(0, 50), `…and ${details.length - 50} more`] : details,
});

/** Employees from any system's CSV/XLSX export; column names are matched loosely (see ALIASES in lib/migrate). */
export async function importEmployees(_: ActionResult, fd: FormData) {
  return guard(async () => {
    const ctx = await assertRole(HR);
    const order = dateOrder(fd);
    const { table } = await upload(fd);
    const recs = records(table, ["code", "name", "lastName", "email", "phone", "branch", "department", "designation", "shift", "joinDate", "birthDate"], ["code", "name"]);

    const errors: string[] = [];
    const valid = [];
    for (const r of recs) {
      const [joinDate, birthDate] = (["joinDate", "birthDate"] as const).map((f) => (r.get(f) ? parseDateTime(r.get(f), order)?.date : ""));
      if (joinDate === undefined || birthDate === undefined) {
        errors.push(`Row ${r.line}: can't read ${joinDate === undefined ? `join date "${r.get("joinDate")}"` : `date of birth "${r.get("birthDate")}"`}.`);
        continue;
      }
      const p = employeeSchema.safeParse({ code: r.get("code"), name: [r.get("name"), r.get("lastName")].filter(Boolean).join(" "), email: r.get("email"), phone: r.get("phone"), joinDate, birthDate });
      if (p.success) valid.push({ p: p.data, r });
      else errors.push(`Row ${r.line}: ${p.error.issues[0].message}`);
    }
    const existing = new Set((await ctx.db.employee.findMany({ select: { code: true } })).map((e) => e.code));
    const newCodes = new Set(valid.map((v) => v.p.code).filter((c) => !existing.has(c)));
    if (preview(fd)) return done(`Preview: ${newCodes.size} new and ${valid.length - newCodes.size} existing employees would be saved. Nothing was changed.`, errors);
    await assertLimit(ctx.db, "employees", newCodes.size);

    const cache = new Map<string, string>();
    const lookup = async (kind: "branch" | "department" | "designation", name: string) => {
      if (!name) return null;
      const key = `${kind}:${name.toLowerCase()}`;
      if (!cache.has(key)) {
        const delegate = (kind === "branch" ? ctx.db.branch : kind === "department" ? ctx.db.department : ctx.db.designation) as typeof ctx.db.department;
        const row = (await delegate.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ?? (await delegate.create({ data: { name } }));
        cache.set(key, row.id);
      }
      return cache.get(key)!;
    };
    const shifts = await ctx.db.shift.findMany();

    let created = 0;
    let updated = 0;
    for (const { p, r } of valid) {
      const data = {
        name: p.name, email: p.email ?? null, phone: p.phone ?? null,
        branchId: await lookup("branch", r.get("branch")), departmentId: await lookup("department", r.get("department")),
        designationId: await lookup("designation", r.get("designation")),
        defaultShiftId: shifts.find((s) => s.name.toLowerCase() === r.get("shift").toLowerCase())?.id ?? null,
        joinDate: p.joinDate ? toDbDate(p.joinDate) : null,
        ...(p.birthDate && { birthDate: toDbDate(p.birthDate) }),
      };
      const prev = await ctx.db.employee.findFirst({ where: { code: p.code } });
      const e = prev ? await ctx.db.employee.update({ where: { id: prev.id }, data }) : await ctx.db.employee.create({ data: { ...data, code: p.code } });
      prev ? updated++ : created++;
      await afterSave(ctx, e.id, e.code, e.branchId);
    }
    await audit(ctx, "import", "Employee", null, { created, updated, errors: errors.length });
    revalidatePath("/employees");
    return done(`Imported ${created} new and updated ${updated} employees.`, errors);
  });
}

/** Historical punches (CSV/XLSX/attlog.dat). Times are read as wall-clock in each employee's branch time zone. */
export async function importPunches(_: ActionResult, fd: FormData) {
  return guard(async () => {
    const ctx = await assertRole(HR);
    const { name, table } = await upload(fd);
    const { rows, errors } = parsePunchRows(table, dateOrder(fd));

    const emps = await ctx.db.employee.findMany({ select: { code: true, branch: { select: { timezone: true } } } });
    const tzOf = new Map(emps.map((e) => [e.code, e.branch?.timezone]));
    const orgTz = await orgTimezone(ctx.orgId);
    const unknown = new Set<string>();
    const byKey = new Map<string, RawPunch>();
    for (const r of rows) {
      if (!tzOf.has(r.code)) unknown.add(r.code);
      const timestamp = zonedToUtc(r.date, r.time, tzOf.get(r.code) ?? orgTz);
      byKey.set(`${r.code}|${timestamp.getTime()}`, { employeeCode: r.code, timestamp, direction: r.direction, verifyMode: "IMPORT" });
    }
    const punches = [...byKey.values()];
    if (!punches.length) return { ok: false, message: "No readable punches in this file.", details: errors.slice(0, 50) };

    // The unique index ignores rows without a device, so skip anything already stored at the same second.
    let min = Infinity, max = -Infinity;
    for (const p of punches) (min = Math.min(min, p.timestamp.getTime())), (max = Math.max(max, p.timestamp.getTime()));
    const have = await ctx.db.punch.findMany({
      where: { timestamp: { gte: new Date(min), lte: new Date(max) }, employeeCode: { in: [...new Set(punches.map((p) => p.employeeCode))] } },
      select: { employeeCode: true, timestamp: true },
    });
    const haveKeys = new Set(have.map((p) => `${p.employeeCode}|${Math.floor(p.timestamp.getTime() / 1000) * 1000}`));
    const fresh = punches.filter((p) => !haveKeys.has(`${p.employeeCode}|${Math.floor(p.timestamp.getTime() / 1000) * 1000}`));

    const notes = [...errors];
    if (unknown.size) notes.unshift(`${unknown.size} code(s) don't match an employee yet (${[...unknown].slice(0, 10).join(", ")}). Their punches are kept and attach automatically once you add those employees.`);
    const range = `${localDate(new Date(min), orgTz)} to ${localDate(new Date(max), orgTz)}`;
    const skipped = punches.length - fresh.length;
    if (preview(fd)) return done(`Preview: ${fresh.length} new punches from ${range} (${skipped} already in the system). Nothing was changed.`, notes);

    let n = 0;
    for (let i = 0; i < fresh.length; i += 2000)
      n += await ingestPunches({ orgId: ctx.orgId, deviceId: null, source: "IMPORT", createdById: ctx.user.id, note: `Imported from ${name}`.slice(0, 200) }, fresh.slice(i, i + 2000));
    await audit(ctx, "import", "Punch", null, { file: name, imported: n, skipped, errors: errors.length });
    revalidatePath("/attendance");
    return done(`Imported ${n} punches (${range}); ${skipped} duplicates skipped. Attendance is being recalculated in the background.`, notes);
  });
}

/** Sets this year's adjustment so the available balance equals the closing balance from the old system. */
export async function importLeaveBalances(_: ActionResult, fd: FormData) {
  return guard(async () => {
    const ctx = await assertRole(HR);
    const recs = records((await upload(fd)).table, ["code", "leaveType", "balance", "year"], ["code", "leaveType", "balance"]);
    const thisYear = Number(localDate(new Date(), await orgTimezone(ctx.orgId)).slice(0, 4));
    const [emps, types] = await Promise.all([ctx.db.employee.findMany({ select: { id: true, code: true } }), ctx.db.leaveType.findMany({ where: { active: true } })]);
    const empId = new Map(emps.map((e) => [e.code, e.id]));
    const typeOf = (s: string) => types.find((t) => t.code.toLowerCase() === s.toLowerCase() || t.name.toLowerCase() === s.toLowerCase());

    const errors: string[] = [];
    const todo = [];
    for (const r of recs) {
      const employeeId = empId.get(r.get("code"));
      const type = typeOf(r.get("leaveType"));
      const balance = Number(r.get("balance"));
      const year = r.get("year") ? Number(r.get("year")) : thisYear;
      if (!employeeId) errors.push(`Row ${r.line}: no employee with code "${r.get("code")}".`);
      else if (!type) errors.push(`Row ${r.line}: unknown leave type "${r.get("leaveType")}" (have: ${types.map((t) => t.code).join(", ")}).`);
      else if (!Number.isFinite(balance) || balance < -365 || balance > 365) errors.push(`Row ${r.line}: balance "${r.get("balance")}" is not a number of days.`);
      else if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.push(`Row ${r.line}: bad year "${r.get("year")}".`);
      else todo.push({ employeeId, type, balance, year });
    }
    if (preview(fd)) return done(`Preview: ${todo.length} balances would be set. Nothing was changed.`, errors);

    for (const t of todo) {
      const cur = (await leaveBalances(ctx.db, t.employeeId, t.year)).find((b) => b.type.id === t.type.id)!;
      const adjustment = cur.adjustment + (t.balance - cur.available);
      await ctx.db.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: t.employeeId, leaveTypeId: t.type.id, year: t.year } },
        create: { employeeId: t.employeeId, leaveTypeId: t.type.id, year: t.year, adjustment, note: "Opening balance import" },
        update: { adjustment, note: "Opening balance import" },
      });
    }
    await audit(ctx, "import", "LeaveBalance", null, { count: todo.length, errors: errors.length });
    revalidatePath("/leave");
    return done(`Set ${todo.length} opening leave balances.`, errors);
  });
}

export async function importHolidays(_: ActionResult, fd: FormData) {
  return guard(async () => {
    const ctx = await assertRole(HR);
    const recs = records((await upload(fd)).table, ["date", "holiday", "branch"], ["date", "holiday"]);
    const order = dateOrder(fd);
    const [branches, existing] = await Promise.all([ctx.db.branch.findMany(), ctx.db.holiday.findMany({ select: { date: true, name: true } })]);
    const have = new Set(existing.map((h) => `${h.date.toISOString().slice(0, 10)}|${h.name.toLowerCase()}`));

    const errors: string[] = [];
    const data = [];
    for (const r of recs) {
      const date = parseDateTime(r.get("date"), order)?.date;
      const name = r.get("holiday").slice(0, 100);
      const branch = r.get("branch") ? branches.find((b) => b.name.toLowerCase() === r.get("branch").toLowerCase()) : null;
      if (!date) errors.push(`Row ${r.line}: can't read date "${r.get("date")}".`);
      else if (!name) errors.push(`Row ${r.line}: missing holiday name.`);
      else if (branch === undefined) errors.push(`Row ${r.line}: no branch named "${r.get("branch")}".`);
      else if (!have.has(`${date}|${name.toLowerCase()}`)) {
        have.add(`${date}|${name.toLowerCase()}`);
        data.push({ date, name, branchId: branch?.id ?? null });
      }
    }
    if (preview(fd)) return done(`Preview: ${data.length} new holidays would be added. Nothing was changed.`, errors);

    await ctx.db.holiday.createMany({ data: data.map((h) => ({ ...h, date: toDbDate(h.date) })) });
    const today = localDate(new Date(), await orgTimezone(ctx.orgId));
    const past = [...new Set(data.map((h) => h.date).filter((d) => d <= today))];
    if (past.length) {
      const emps = await ctx.db.employee.findMany({ where: { active: true }, select: { id: true } });
      await queueRecompute(past.flatMap((date) => emps.map((e) => ({ employeeId: e.id, date }))));
    }
    await audit(ctx, "import", "Holiday", null, { count: data.length });
    revalidatePath("/holidays");
    return done(`Added ${data.length} holidays.`, errors);
  });
}

/** Ask push (ADMS) terminals to upload every punch they still hold for a date range. */
export async function pullTerminalLogs(_: ActionResult, fd: FormData) {
  return guard(async () => {
    const ctx = await assertRole(HR);
    const p = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(Object.fromEntries(fd));
    if (p.from > p.to) throw new Error("'From' must be before 'To'.");
    const devices = await ctx.db.device.findMany({ where: { vendor: "ZKTECO_ADMS", status: "ACTIVE" }, select: { id: true } });
    if (!devices.length) throw new Error("No active ZKTeco/eSSL push terminals. Pull-mode terminals are read in full by the bridge agent automatically.");
    for (const d of devices) await queueCommands(ctx.orgId, d.id, [admsCmd.queryLogs(p.from, p.to)]);
    await audit(ctx, "pull_logs", "Device", null, { ...p, devices: devices.length });
    return done(`Asked ${devices.length} terminal(s) to re-send logs from ${p.from} to ${p.to}. They upload on their next check-in (usually within a minute); duplicates are ignored.`, []);
  });
}
