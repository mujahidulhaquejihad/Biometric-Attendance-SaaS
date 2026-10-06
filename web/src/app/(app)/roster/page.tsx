import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Button, Card, FilterBar, PageHeader, Select } from "@/components/ui";
import { audit } from "@/lib/audit";
import { queueRecompute } from "@/lib/jobs";
import { assertRole, HR, requireRole } from "@/lib/session";
import { addDays, dayOfWeek, fromDbDate, localDate, toDbDate } from "@/lib/time";

export const metadata = { title: "Roster" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function saveRoster(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const shiftIds = new Set((await ctx.db.shift.findMany({ select: { id: true } })).map((s) => s.id));
  const empIds = new Set((await ctx.db.employee.findMany({ select: { id: true } })).map((e) => e.id));
  const today = localDate(new Date(), (await ctx.db.orgSettings.findFirst())?.timezone ?? "UTC");
  const recompute: { employeeId: string; date: string }[] = [];
  let changes = 0;

  for (const [key, raw] of fd) {
    const m = /^cell:([^|]+)\|(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m || !empIds.has(m[1])) continue;
    const [, employeeId, date] = m;
    const value = String(raw);
    const prev = String(fd.get(`prev:${employeeId}|${date}`) ?? "");
    if (value === prev) continue;
    const where = { employeeId_date: { employeeId, date: toDbDate(date) } };
    if (value === "") await ctx.db.shiftAssignment.deleteMany({ where: { employeeId, date: toDbDate(date) } });
    else {
      const shiftId = value === "off" ? null : shiftIds.has(value) ? value : undefined;
      if (shiftId === undefined) continue;
      await ctx.db.shiftAssignment.upsert({ where, create: { employeeId, date: toDbDate(date), shiftId }, update: { shiftId } });
    }
    changes++;
    if (date <= today) recompute.push({ employeeId, date });
  }
  await queueRecompute(recompute);
  await audit(ctx, "update", "Roster", null, { changes });
  revalidatePath("/roster");
}

export default async function Roster({ searchParams }: { searchParams: Promise<{ week?: string; dept?: string; branch?: string }> }) {
  const ctx = await requireRole(HR);
  const q = await searchParams;
  const settings = await ctx.db.orgSettings.findFirst();
  const today = localDate(new Date(), settings?.timezone ?? "UTC");
  const weekStart = q.week && /^\d{4}-\d{2}-\d{2}$/.test(q.week) ? q.week : addDays(today, -((dayOfWeek(today) + 6) % 7));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [shifts, departments, branches, employees, assigns] = await Promise.all([
    ctx.db.shift.findMany({ orderBy: { startMinute: "asc" } }),
    ctx.db.department.findMany({ orderBy: { name: "asc" } }),
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({
      where: { active: true, ...(q.dept ? { departmentId: q.dept } : {}), ...(q.branch ? { branchId: q.branch } : {}) },
      include: { defaultShift: true }, orderBy: { name: "asc" }, take: 150,
    }),
    ctx.db.shiftAssignment.findMany({ where: { date: { gte: toDbDate(dates[0]), lte: toDbDate(dates[6]) } } }),
  ]);
  const cell = new Map(assigns.map((a) => [`${a.employeeId}|${fromDbDate(a.date)}`, a.shiftId ?? "off"]));
  const nav = (w: string) => `?${new URLSearchParams({ ...(q as Record<string, string>), week: w })}`;
  const color = new Map(shifts.map((s) => [s.id, s.color]));

  return (
    <>
      <PageHeader
        title="Roster"
        description="Override an employee's default shift on specific days, or mark a day off. Blank = default shift."
        actions={<><Link className="text-sm text-blue-600" href={nav(addDays(weekStart, -7))}>← Previous week</Link><Link className="text-sm text-blue-600" href={nav(addDays(weekStart, 7))}>Next week →</Link></>}
      />
      <FilterBar>
        <input type="hidden" name="week" value={weekStart} />
        <Select name="branch" defaultValue={q.branch ?? ""}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Select name="dept" defaultValue={q.dept ?? ""}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
      </FilterBar>
      <Card>
        <form action={saveRoster}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="px-2 py-2 text-left">Employee</th>
                  {dates.map((d) => <th key={d} className={`px-1 py-2 ${d === today ? "text-blue-700" : ""}`}>{DAYS[dayOfWeek(d)]} {d.slice(5)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="px-2 py-1">
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-slate-400">{e.defaultShift?.name ?? "No default shift"}</div>
                    </td>
                    {dates.map((d) => {
                      const v = cell.get(`${e.id}|${d}`) ?? "";
                      return (
                        <td key={d} className="px-1 py-1">
                          <input type="hidden" name={`prev:${e.id}|${d}`} value={v} />
                          <select
                            name={`cell:${e.id}|${d}`}
                            defaultValue={v}
                            className="w-full rounded border border-slate-200 px-1 py-1 text-xs"
                            style={{ borderLeft: `4px solid ${v === "off" ? "#94a3b8" : (color.get(v) ?? "transparent")}` }}
                          >
                            <option value="">Default</option>
                            <option value="off">Day off</option>
                            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {employees.length === 150 && <p className="mt-2 text-xs text-slate-500">Showing the first 150 employees; filter by branch or department to see others.</p>}
          <Button className="mt-4">Save roster</Button>
        </form>
      </Card>
    </>
  );
}
