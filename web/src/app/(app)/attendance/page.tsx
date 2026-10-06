import { revalidatePath } from "next/cache";
import Link from "next/link";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Badge, Button, Card, Field, FilterBar, Input, LinkButton, PageHeader, Select, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { queueRecompute } from "@/lib/jobs";
import { ingestPunches, orgTimezone } from "@/lib/punches";
import { assertRole, HR, requireRole } from "@/lib/session";
import { addDays, fmtDuration, localDate, localTime, toDbDate, zonedToUtc } from "@/lib/time";

export const metadata = { title: "Daily attendance" };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function manualPunch(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({ employeeId: z.string(), date: DATE, time: z.string().regex(/^\d{2}:\d{2}$/), direction: z.enum(["IN", "OUT"]), note: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(fd));
  const e = await ctx.db.employee.findFirstOrThrow({ where: { id: p.employeeId } });
  const tz = await orgTimezone(ctx.orgId, e.branchId);
  await ingestPunches(
    { orgId: ctx.orgId, deviceId: null, source: "MANUAL", createdById: ctx.user.id, note: p.note },
    [{ employeeCode: e.code, timestamp: zonedToUtc(p.date, p.time, tz), direction: p.direction }],
  );
  await audit(ctx, "manual_punch", "Employee", e.id, p);
  revalidatePath("/attendance");
}

async function recompute(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const from = DATE.parse(fd.get("from"));
  const to = DATE.parse(fd.get("to"));
  if (to < from || (new Date(to).getTime() - new Date(from).getTime()) / 86400_000 > 62) throw new Error("Pick a range of at most 62 days.");
  const emps = await ctx.db.employee.findMany({ where: { active: true }, select: { id: true } });
  const items: { employeeId: string; date: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) for (const e of emps) items.push({ employeeId: e.id, date: d });
  await queueRecompute(items);
  await audit(ctx, "recompute", "AttendanceDay", null, { from, to });
  revalidatePath("/attendance");
}

async function setLock(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const from = DATE.parse(fd.get("from"));
  const to = DATE.parse(fd.get("to"));
  const locked = fd.get("locked") === "true";
  const r = await ctx.db.attendanceDay.updateMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, data: { locked } });
  await audit(ctx, locked ? "lock_period" : "unlock_period", "AttendanceDay", null, { from, to, rows: r.count });
  revalidatePath("/attendance");
}

export default async function Attendance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireRole(HR);
  const q = await searchParams;
  const settings = await ctx.db.orgSettings.findFirst();
  const tz = settings?.timezone ?? "UTC";
  const date = q.date && DATE.safeParse(q.date).success ? q.date : localDate(new Date(), tz);

  const [days, branches, departments, employees] = await Promise.all([
    ctx.db.attendanceDay.findMany({
      where: {
        date: toDbDate(date),
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.late ? { lateMinutes: { gt: 0 } } : {}),
        ...(q.missing ? { missingPunch: true } : {}),
        employee: { ...(q.branch ? { branchId: q.branch } : {}), ...(q.dept ? { departmentId: q.dept } : {}) },
      },
      include: { employee: { include: { department: true, branch: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const nav = (d: string) => `?${new URLSearchParams({ ...(q as Record<string, string>), date: d })}`;

  return (
    <>
      <PageHeader
        title="Daily attendance"
        description={date}
        actions={
          <>
            <Link className="text-sm text-blue-600" href={nav(addDays(date, -1))}>← Previous day</Link>
            <Link className="text-sm text-blue-600" href={nav(addDays(date, 1))}>Next day →</Link>
            <LinkButton href={`/api/reports/daily?format=xlsx&from=${date}&to=${date}`}>Export</LinkButton>
          </>
        }
      />
      <FilterBar>
        <Input type="date" name="date" defaultValue={date} />
        <Select name="branch" defaultValue={q.branch ?? ""}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Select name="dept" defaultValue={q.dept ?? ""}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select name="status" defaultValue={q.status ?? ""}>
          <option value="">Any status</option>
          {["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </Select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="late" defaultChecked={!!q.late} /> Late only</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="missing" defaultChecked={!!q.missing} /> Missing punch</label>
      </FilterBar>

      <div className="grid gap-6 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <Table head={["Employee", "Department", "Status", "In", "Out", "Worked", "Late", "Early", "OT", ""]} empty="No attendance computed for this day yet.">
            {days.map((d) => {
              const etz = d.employee.branch?.timezone ?? tz;
              return (
                <tr key={d.id}>
                  <td><Link href={`/employees/${d.employeeId}`} className="font-medium hover:underline">{d.employee.name}</Link> <span className="text-xs text-slate-400">{d.employee.code}</span></td>
                  <td className="text-xs">{d.employee.department?.name}</td>
                  <td><Badge>{d.status}</Badge>{d.missingPunch && <span className="ml-1 text-xs text-amber-700">missing</span>}</td>
                  <td>{localTime(d.firstIn, etz)}</td>
                  <td>{localTime(d.lastOut, etz)}</td>
                  <td>{fmtDuration(d.workedMinutes)}</td>
                  <td className={d.lateMinutes ? "text-amber-700" : ""}>{d.lateMinutes || ""}</td>
                  <td>{d.earlyMinutes || ""}</td>
                  <td>{fmtDuration(d.otMinutes)}</td>
                  <td>{d.locked && <span className="text-xs text-slate-500" title="Payroll closed">Locked</span>}</td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <div className="space-y-6">
          <Card title="Add manual punch">
            <form action={manualPunch} className="space-y-3">
              <Field label="Employee">
                <Select name="employeeId" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}</Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date"><Input type="date" name="date" defaultValue={date} required /></Field>
                <Field label="Time"><Input type="time" name="time" required /></Field>
              </div>
              <Field label="Direction"><Select name="direction"><option>IN</option><option>OUT</option></Select></Field>
              <Field label="Reason (audited)"><Input name="note" required minLength={3} /></Field>
              <Button className="w-full">Add punch</Button>
            </form>
          </Card>
          <Card title="Recompute">
            <form action={recompute} className="space-y-3">
              <p className="text-xs text-slate-500">Re-run attendance rules after changing shifts or policies. Locked days are skipped.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="From"><Input type="date" name="from" defaultValue={date} required /></Field>
                <Field label="To"><Input type="date" name="to" defaultValue={date} required /></Field>
              </div>
              <Button variant="secondary" className="w-full">Recompute</Button>
            </form>
          </Card>
          {ctx.role === "admin" && (
            <Card title="Payroll close">
              <form action={setLock} className="space-y-3">
                <p className="text-xs text-slate-500">Locked days can no longer change, even if late punches arrive.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From"><Input type="date" name="from" defaultValue={`${date.slice(0, 7)}-01`} required /></Field>
                  <Field label="To"><Input type="date" name="to" defaultValue={date} required /></Field>
                </div>
                <div className="flex gap-2">
                  <input type="hidden" name="locked" value="true" />
                  <ConfirmButton message="Lock attendance for this period?" className="flex-1 rounded-md bg-slate-800 px-3 py-2 text-sm text-white">Lock</ConfirmButton>
                </div>
              </form>
              <form action={setLock} className="mt-2 flex gap-2">
                <input type="hidden" name="locked" value="false" />
                <input type="hidden" name="from" value={`${date.slice(0, 7)}-01`} />
                <input type="hidden" name="to" value={date} />
                <button className="text-xs text-slate-500 hover:underline">Unlock this month to date</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
