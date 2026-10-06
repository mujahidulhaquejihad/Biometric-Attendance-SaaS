"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schedule } from "./attendance";
import { audit } from "./audit";
import { queueRecompute } from "./jobs";
import { leaveBalances, leaveDays } from "./leave";
import { approversFor, notify } from "./notify";
import { ingestPunches, orgTimezone } from "./punches";
import { APPROVERS, assertRole, getCtx, HR, type Ctx } from "./session";
import { daysBetween, fmtDuration, fromDbDate, toDbDate, zonedToUtc } from "./time";
import { emitWebhook } from "./webhooks";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{2}:\d{2}$/).optional());

/** HR may file on behalf of anyone; everyone else only for themselves. */
async function targetEmployee(ctx: Ctx, fd: FormData) {
  const requested = fd.get("employeeId") ? String(fd.get("employeeId")) : null;
  if (requested && requested !== ctx.employee?.id) {
    if (!HR.includes(ctx.role)) throw new Error("You can only file requests for yourself.");
    return ctx.db.employee.findFirstOrThrow({ where: { id: requested } });
  }
  if (!ctx.employee) throw new Error("Your login is not linked to an employee record.");
  return ctx.employee;
}

export async function submitLeave(fd: FormData) {
  const ctx = await getCtx();
  const emp = await targetEmployee(ctx, fd);
  const p = z.object({ leaveTypeId: z.string(), fromDate: DATE, toDate: DATE, reason: z.string().trim().max(500).optional() }).parse(Object.fromEntries(fd));
  if (p.toDate < p.fromDate) throw new Error("End date is before start date.");
  const halfDay = fd.get("halfDay") === "on";
  if (halfDay && p.fromDate !== p.toDate) throw new Error("A half-day leave must start and end on the same day.");
  const days = leaveDays(p.fromDate, p.toDate, halfDay);
  if (days > 366) throw new Error("Leave range is too long.");

  const overlap = await ctx.db.leaveRequest.findFirst({
    where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: toDbDate(p.toDate) }, toDate: { gte: toDbDate(p.fromDate) } },
  });
  if (overlap) throw new Error("This overlaps another leave request.");
  const bal = (await leaveBalances(ctx.db, emp.id, Number(p.fromDate.slice(0, 4)))).find((b) => b.type.id === p.leaveTypeId);
  if (!bal) throw new Error("Unknown leave type.");
  if (bal.type.paid && bal.available < days) throw new Error(`Only ${bal.available} day(s) of ${bal.type.name} available.`);

  const r = await ctx.db.leaveRequest.create({ data: { employeeId: emp.id, leaveTypeId: p.leaveTypeId, fromDate: toDbDate(p.fromDate), toDate: toDbDate(p.toDate), halfDay, days, reason: p.reason } });
  await audit(ctx, "submit", "LeaveRequest", r.id, { days });
  await notify(ctx.orgId, await approversFor(ctx.orgId, emp.id), `Leave request from ${emp.name}`, `${bal.type.name}: ${p.fromDate} to ${p.toDate} (${days} day(s)). ${p.reason ?? ""}`, "/approvals");
  revalidatePath("/me/requests");
}

export async function submitRegularization(fd: FormData) {
  const ctx = await getCtx();
  const emp = await targetEmployee(ctx, fd);
  const p = z.object({ date: DATE, inTime: TIME, outTime: TIME, reason: z.string().trim().min(3).max(500) }).parse(Object.fromEntries(fd));
  if (!p.inTime && !p.outTime) throw new Error("Enter the missing in time, out time, or both.");
  const r = await ctx.db.regularization.create({ data: { employeeId: emp.id, date: toDbDate(p.date), inTime: p.inTime, outTime: p.outTime, reason: p.reason } });
  await audit(ctx, "submit", "Regularization", r.id);
  await notify(ctx.orgId, await approversFor(ctx.orgId, emp.id), `Attendance correction from ${emp.name}`, `${p.date}: in ${p.inTime ?? "-"}, out ${p.outTime ?? "-"}. ${p.reason}`, "/approvals");
  revalidatePath("/me/requests");
}

export async function submitOvertime(fd: FormData) {
  const ctx = await getCtx();
  const emp = await targetEmployee(ctx, fd);
  const p = z.object({ date: DATE, minutes: z.coerce.number().int().min(15).max(960), reason: z.string().trim().max(500).optional() }).parse(Object.fromEntries(fd));
  const r = await ctx.db.overtimeRequest.create({ data: { employeeId: emp.id, date: toDbDate(p.date), minutes: p.minutes, reason: p.reason } });
  await audit(ctx, "submit", "OvertimeRequest", r.id);
  await notify(ctx.orgId, await approversFor(ctx.orgId, emp.id), `Overtime request from ${emp.name}`, `${p.date}: ${p.minutes} minutes. ${p.reason ?? ""}`, "/approvals");
  revalidatePath("/me/requests");
}

/** Worked a holiday or weekly off: half a day of comp-off for a half day's work, a full day for a full day. */
export async function submitCompOff(fd: FormData) {
  const ctx = await getCtx();
  const emp = await targetEmployee(ctx, fd);
  const p = z.object({ date: DATE, reason: z.string().trim().max(500).optional() }).parse(Object.fromEntries(fd));
  const settings = await ctx.db.orgSettings.findFirst();
  const day = await ctx.db.attendanceDay.findFirst({ where: { employeeId: emp.id, date: toDbDate(p.date) } });
  const s = await schedule(emp, p.date, settings?.weekOffs);
  if (!s.holiday && !s.weekOff) throw new Error(`${p.date} was a working day for you, so it doesn't earn comp-off.`);
  const worked = day?.workedMinutes ?? 0;
  const days = worked >= s.rule.fullDayMinutes ? 1 : worked >= s.rule.halfDayMinutes ? 0.5 : 0;
  if (!days) throw new Error(`Only ${fmtDuration(worked)} recorded on ${p.date}; at least ${fmtDuration(s.rule.halfDayMinutes)} is needed for half a day.`);
  if (await ctx.db.compOffRequest.findFirst({ where: { employeeId: emp.id, date: toDbDate(p.date), status: { in: ["PENDING", "APPROVED"] } } }))
    throw new Error(`Comp-off for ${p.date} was already claimed.`);
  const r = await ctx.db.compOffRequest.create({ data: { employeeId: emp.id, date: toDbDate(p.date), days, reason: p.reason } });
  await audit(ctx, "submit", "CompOffRequest", r.id, { days });
  await notify(ctx.orgId, await approversFor(ctx.orgId, emp.id), `Comp-off claim from ${emp.name}`, `Worked ${fmtDuration(worked)} on ${p.date} (${s.holiday ? "holiday" : "weekly off"}): ${days} day(s). ${p.reason ?? ""}`, "/approvals");
  revalidatePath("/me/requests");
}

const KINDS = ["leave", "regularization", "overtime", "compoff"] as const;
const delegateFor = (ctx: Ctx, kind: (typeof KINDS)[number]) =>
  ({ leave: ctx.db.leaveRequest, regularization: ctx.db.regularization, overtime: ctx.db.overtimeRequest, compoff: ctx.db.compOffRequest })[kind] as typeof ctx.db.overtimeRequest;

export async function cancelRequest(fd: FormData) {
  const ctx = await getCtx();
  const kind = z.enum(KINDS).parse(fd.get("kind"));
  const id = String(fd.get("id"));
  const delegate = delegateFor(ctx, kind);
  const r = await delegate.findFirstOrThrow({ where: { id } });
  if (r.employeeId !== ctx.employee?.id && !HR.includes(ctx.role)) throw new Error("Not your request.");
  if (r.status !== "PENDING" && !(kind === "leave" && r.status === "APPROVED" && HR.includes(ctx.role))) throw new Error("Only pending requests can be cancelled.");
  await delegate.update({ where: { id }, data: { status: "CANCELLED" } });
  if (kind === "leave" && r.status === "APPROVED") {
    const l = await ctx.db.leaveRequest.findFirstOrThrow({ where: { id } });
    await queueRecompute(daysBetween(fromDbDate(l.fromDate), fromDbDate(l.toDate)).map((date) => ({ employeeId: l.employeeId, date })));
  }
  await audit(ctx, "cancel", kind, id);
  revalidatePath("/me/requests");
  revalidatePath("/approvals");
}

export async function decideRequest(fd: FormData) {
  const ctx = await assertRole(APPROVERS);
  const kind = z.enum(KINDS).parse(fd.get("kind"));
  const id = String(fd.get("requestId"));
  const approve = fd.get("decision") === "approve";
  const note = String(fd.get("note") ?? "").slice(0, 500) || null;
  const delegate = delegateFor(ctx, kind);
  const r = await delegate.findFirstOrThrow({ where: { id }, include: { employee: true } });
  if (r.status !== "PENDING") throw new Error("This request was already decided.");
  if (!HR.includes(ctx.role) && r.employee.managerId !== ctx.employee?.id) throw new Error("Only the employee's manager or HR can decide this.");
  if (r.employeeId === ctx.employee?.id && ctx.role !== "admin") throw new Error("You cannot approve your own request.");

  await delegate.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note } });

  if (approve && kind === "leave") {
    const l = await ctx.db.leaveRequest.findFirstOrThrow({ where: { id } });
    await queueRecompute(daysBetween(fromDbDate(l.fromDate), fromDbDate(l.toDate)).map((date) => ({ employeeId: l.employeeId, date })));
  }
  if (approve && kind === "compoff") {
    const c = await ctx.db.compOffRequest.findFirstOrThrow({ where: { id } });
    const type = await ctx.db.leaveType.upsert({
      where: { organizationId_code: { organizationId: ctx.orgId, code: "CO" } },
      create: { name: "Comp-off", code: "CO", paid: true, annualQuota: 0 },
      update: {},
    });
    // ponytail: credited to the year it was earned; comp-off earned in late December must be used that year (no expiry rules).
    const year = c.date.getUTCFullYear();
    const note = `Comp-off for ${fromDbDate(c.date)}`;
    await ctx.db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: c.employeeId, leaveTypeId: type.id, year } },
      create: { employeeId: c.employeeId, leaveTypeId: type.id, year, adjustment: c.days, note },
      update: { adjustment: { increment: c.days }, note },
    });
  }
  if (approve && kind === "regularization") {
    const g = await ctx.db.regularization.findFirstOrThrow({ where: { id } });
    const tz = await orgTimezone(ctx.orgId, r.employee.branchId);
    const date = fromDbDate(g.date);
    // Night-shift out times earlier than the in time belong to the next morning.
    const outDate = g.inTime && g.outTime && g.outTime < g.inTime ? fromDbDate(new Date(g.date.getTime() + 86400_000)) : date;
    await ingestPunches(
      { orgId: ctx.orgId, deviceId: null, source: "MANUAL", createdById: ctx.user.id, note: `Regularization ${id}: ${g.reason}` },
      [
        ...(g.inTime ? [{ employeeCode: r.employee.code, timestamp: zonedToUtc(date, g.inTime, tz), direction: "IN" as const }] : []),
        ...(g.outTime ? [{ employeeCode: r.employee.code, timestamp: zonedToUtc(outDate, g.outTime, tz), direction: "OUT" as const }] : []),
      ],
    );
  }

  await audit(ctx, approve ? "approve" : "reject", kind, id, { note });
  await notify(ctx.orgId, [r.employee.userId], `Your ${{ leave: "leave", regularization: "attendance correction", overtime: "overtime", compoff: "comp-off" }[kind]} request was ${approve ? "approved" : "rejected"}`, note ?? undefined, "/me/requests");
  await emitWebhook(ctx.orgId, "request.decided", { kind, id, employeeCode: r.employee.code, approved: approve });
  revalidatePath("/approvals");
}
