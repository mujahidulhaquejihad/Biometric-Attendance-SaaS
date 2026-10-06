import Link from "next/link";
import { TrendChart } from "@/components/chart";
import { MonthGrid } from "@/components/month-grid";
import { Card, PageHeader, Stat } from "@/components/ui";
import { requireRole } from "@/lib/session";
import { todayStats, trend } from "@/lib/stats";
import { daysBetween, fromDbDate, localDate, monthRange, toDbDate } from "@/lib/time";

export const metadata = { title: "My team" };
export const dynamic = "force-dynamic";

export default async function Team({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireRole(["manager", "admin", "hr"]);
  const managerId = ctx.employee?.id ?? "__none__";
  const settings = await ctx.db.orgSettings.findFirst();
  const today = localDate(new Date(), settings?.timezone ?? "UTC");
  const m = (await searchParams).month;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : today.slice(0, 7);
  const { from, to } = monthRange(month);

  const [s, chart, reports, days] = await Promise.all([
    todayStats(ctx.orgId, { managerId }),
    trend(ctx.orgId, 14, managerId),
    ctx.db.employee.findMany({ where: { managerId, active: true }, orderBy: { name: "asc" } }),
    ctx.db.attendanceDay.findMany({ where: { employee: { managerId }, date: { gte: toDbDate(from), lte: toDbDate(to) } } }),
  ]);
  const rows = reports.map((e) => ({
    id: e.id,
    name: e.name,
    cells: Object.fromEntries(days.filter((d) => d.employeeId === e.id).map((d) => [fromDbDate(d.date), { status: d.status, late: d.lateMinutes > 0 }])),
  }));

  return (
    <>
      <PageHeader title="My team" description={`${reports.length} direct report(s)`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Present" value={s.present.length} tone="green" of={s.total} />
        <Stat label="Late" value={s.late.length} tone="amber" of={s.total} />
        <Stat label="On leave" value={s.leave.length} tone="violet" of={s.total} />
        <Stat label="Absent" value={s.absent.length} tone="red" of={s.total} />
        <Stat label="Not yet in" value={s.notYetIn.length} tone="blue" of={s.total} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Today" className="xl:col-span-1">
          <ul className="space-y-1 text-sm">
            {[...s.present.map((p) => ({ ...p, st: s.late.some((l) => l.id === p.id) ? "Late" : "In" })),
              ...s.leave.map((p) => ({ ...p, st: "Leave" })), ...s.absent.map((p) => ({ ...p, st: "Absent" })),
              ...s.notYetIn.map((p) => ({ ...p, st: "Not yet in" })), ...s.off.map((p) => ({ ...p, st: "Off" }))].map((p) => (
              <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="text-xs text-slate-500">{p.st}</span></li>
            ))}
            {!reports.length && <li className="text-slate-400">No direct reports. HR sets &quot;Reports to&quot; on employee profiles.</li>}
          </ul>
        </Card>
        <Card title="Last 14 days" className="xl:col-span-2"><TrendChart data={chart} /></Card>
      </div>
      <Card
        className="mt-6"
        title={`Team calendar ${month}`}
        actions={<Link href="/approvals" className="text-sm text-blue-600">Approvals inbox</Link>}
      >
        <MonthGrid dates={daysBetween(from, to)} rows={rows} />
      </Card>
    </>
  );
}
