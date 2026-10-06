import { Award, Cake, CheckCheck, WifiOff } from "lucide-react";
import Link from "next/link";
import { TrendChart } from "@/components/chart";
import { LiveFeed, type LiveEvent } from "@/components/client";
import { Card, FingerprintArt, Stat } from "@/components/ui";
import { isOnline } from "@/lib/device-meta";
import { orgTimezone } from "@/lib/punches";
import { HR, requireRole } from "@/lib/session";
import { departmentHeatmap, todayStats, trend } from "@/lib/stats";
import { fromDbDate, localDate, nextAnniversary } from "@/lib/time";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function Today() {
  const ctx = await requireRole(HR);
  const since = new Date(Date.now() - 12 * 3600_000);
  const [s, chart, heat, punches, devices, pending, people, tz] = await Promise.all([
    todayStats(ctx.orgId),
    trend(ctx.orgId),
    departmentHeatmap(ctx.orgId),
    ctx.db.punch.findMany({ where: { timestamp: { gte: since } }, include: { employee: true, device: true }, orderBy: { timestamp: "desc" }, take: 30 }),
    ctx.db.device.findMany({ where: { status: "ACTIVE" } }),
    Promise.all([
      ctx.db.leaveRequest.count({ where: { status: "PENDING" } }),
      ctx.db.regularization.count({ where: { status: "PENDING" } }),
      ctx.db.overtimeRequest.count({ where: { status: "PENDING" } }),
      ctx.db.compOffRequest.count({ where: { status: "PENDING" } }),
    ]),
    ctx.db.employee.findMany({ where: { active: true, OR: [{ birthDate: { not: null } }, { joinDate: { not: null } }] }, select: { id: true, name: true, birthDate: true, joinDate: true } }),
    orgTimezone(ctx.orgId),
  ]);
  const today = localDate(new Date(), tz);
  const celebrations = people
    .flatMap((p) => {
      const b = p.birthDate && nextAnniversary(fromDbDate(p.birthDate), today);
      const j = p.joinDate && nextAnniversary(fromDbDate(p.joinDate), today);
      return [
        ...(b ? [{ p, ...b, what: "Birthday" }] : []),
        ...(j && j.years > 0 ? [{ p, ...j, what: `${j.years} year${j.years > 1 ? "s" : ""} with us` }] : []),
      ];
    })
    .filter((c) => c.inDays < 7)
    .sort((a, b) => a.inDays - b.inDays || a.p.name.localeCompare(b.p.name));
  const initial: LiveEvent[] = punches.map((p) => ({
    orgId: ctx.orgId, type: "punch", employeeName: p.employee?.name ?? null, employeeCode: p.employeeCode, deviceId: p.deviceId,
    deviceName: p.device?.name ?? null, timestamp: p.timestamp.toISOString(), direction: p.direction, verifyMode: p.verifyMode,
  }));
  const offline = devices.filter((d) => !isOnline(d));
  const pendingTotal = pending.reduce((a, b) => a + b, 0);

  const hour = +new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date());
  const expected = s.total - s.leave.length - s.off.length;
  const rate = expected > 0 ? Math.round((s.present.length / expected) * 100) : 0;

  return (
    <>
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-blue-700 to-violet-700 px-8 py-7 text-white shadow-xl shadow-blue-900/20">
        <FingerprintArt className="pointer-events-none absolute -right-6 -top-10 h-72 w-64 text-white/10" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-blue-100">
              {new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz })}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, {ctx.user.name.split(" ")[0]}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-blue-100">
              {s.present.length} of {expected} expected people are in{s.late.length > 0 && `, ${s.late.length} late`}.
              {pendingTotal > 0 && ` ${pendingTotal} request${pendingTotal > 1 ? "s" : ""} waiting for approval.`}
            </p>
          </div>
          <Ring value={rate} />
        </div>
      </section>
      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Employees" value={s.total} />
        <Stat label="Present" value={s.present.length} tone="green" of={s.total} />
        <Stat label="Late" value={s.late.length} tone="amber" of={s.total} />
        <Stat label="On leave" value={s.leave.length} tone="violet" of={s.total} />
        <Stat label="Absent" value={s.absent.length} tone="red" of={s.total} />
        <Stat label="Not yet in" value={s.notYetIn.length} tone="blue" of={s.total} />
      </div>

      {(offline.length > 0 || pendingTotal > 0) && (
        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          {offline.length > 0 && (
            <Link href="/devices" className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-rose-800 transition hover:bg-rose-100">
              <WifiOff aria-hidden className="h-4 w-4 shrink-0" /> {offline.length} device(s) offline: {offline.map((d) => d.name).join(", ")}
            </Link>
          )}
          {pendingTotal > 0 && (
            <Link href="/approvals" className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-800 transition hover:bg-amber-100">
              <CheckCheck aria-hidden className="h-4 w-4 shrink-0" /> {pendingTotal} request(s) awaiting approval
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Last 14 days"><TrendChart data={chart} /></Card>
          <Card title="Department attendance (last 7 days)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="px-2 py-1 text-left">Department</th>
                    {heat.dates.map((d) => <th key={d} className="px-2 py-1">{d.slice(5)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {heat.rows.map((r) => (
                    <tr key={r.dept}>
                      <td className="px-2 py-1">{r.dept}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="p-0.5">
                          <div
                            className="rounded py-1 text-center text-xs"
                            style={{ background: c === null ? "#f1f5f9" : `hsl(${(c / 100) * 120} 70% 85%)` }}
                          >
                            {c === null ? "-" : `${c}%`}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!heat.rows.length && <tr><td className="py-6 text-center text-slate-400" colSpan={8}>No data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Card title={`Absent (${s.absent.length})`}>
              <PeopleList people={s.absent} />
            </Card>
            <Card title={`Late (${s.late.length})`}>
              <ul className="space-y-1 text-sm">
                {s.late.map((p) => (
                  <li key={p.id} className="flex justify-between"><Link className="hover:underline" href={`/employees/${p.id}`}>{p.name}</Link><span className="text-amber-700">{p.minutes} min</span></li>
                ))}
                {!s.late.length && <li className="text-slate-400">Nobody late.</li>}
              </ul>
            </Card>
          </div>
        </div>
        <div className="space-y-6">
          <Card title="Live punches"><LiveFeed initial={initial} /></Card>
          <Card title="Birthdays & anniversaries (next 7 days)">
            <ul className="space-y-2 text-sm">
              {celebrations.map((c) => (
                <li key={`${c.p.id}-${c.what}`} className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.what === "Birthday" ? "bg-pink-50 text-pink-600" : "bg-amber-50 text-amber-600"}`}>
                    {c.what === "Birthday" ? <Cake aria-hidden className="h-4 w-4" /> : <Award aria-hidden className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link className="font-medium hover:underline" href={`/employees/${c.p.id}`}>{c.p.name}</Link>
                    <span className="block text-xs text-slate-500">{c.what}</span>
                  </span>
                  <span className={c.inDays === 0 ? "rounded-md bg-pink-50 px-2 py-0.5 text-xs font-semibold text-pink-700" : "text-xs text-slate-500"}>
                    {c.inDays === 0 ? "Today" : c.inDays === 1 ? "Tomorrow" : new Date(c.on + "T00:00:00Z").toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                  </span>
                </li>
              ))}
              {!celebrations.length && <li className="text-slate-400">Nothing this week.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 42;
  return (
    <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`${value}% attendance today`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6ee7b7" />
            <stop offset="1" stopColor="#67e8f9" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="9" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="url(#ring)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(Math.min(value, 100) / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{value}%</span>
        <span className="text-[11px] uppercase tracking-wider text-blue-100">attendance</span>
      </div>
    </div>
  );
}

function PeopleList({ people }: { people: { id: string; name: string; department: string | null }[] }) {
  if (!people.length) return <p className="text-sm text-slate-400">Nobody.</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
      {people.map((p) => (
        <li key={p.id} className="flex justify-between">
          <Link className="hover:underline" href={`/employees/${p.id}`}>{p.name}</Link>
          <span className="text-xs text-slate-400">{p.department}</span>
        </li>
      ))}
    </ul>
  );
}
