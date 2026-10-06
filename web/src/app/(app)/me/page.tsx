import { Timer } from "lucide-react";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { z } from "zod";
import { ConfirmButton, WebPunch, type ActionResult } from "@/components/client";
import { Badge, Card, LinkButton, PageHeader, Stat, STATUS_CELL, STATUS_CODE, Table } from "@/components/ui";
import { leaveBalances } from "@/lib/leave";
import { ingestPunches } from "@/lib/punches";
import { getCtx } from "@/lib/session";
import { addDays, dayOfWeek, fmtDuration, fromDbDate, localDate, localTime, monthRange, toDbDate } from "@/lib/time";
import { deleteBiometrics } from "../employees/actions";

export const metadata = { title: "My attendance" };

const rad = Math.PI / 180;
/** Great-circle distance in metres (haversine). */
const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  2 * 6371000 * Math.asin(Math.sqrt(Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2));

// ponytail: the browser reports its own GPS fix, which a determined user can spoof; orgs needing proof of presence should use terminals.
async function punchFromWeb(_: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const ctx = await getCtx();
  const emp = ctx.employee;
  if (!emp?.active) return { ok: false, message: "Your login isn't linked to an active employee." };
  const settings = await ctx.db.orgSettings.findFirst();
  if (!settings?.webPunch) return { ok: false, message: "Punching from phone/browser is turned off." };
  const p = z.object({
    direction: z.enum(["IN", "OUT"]),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    accuracy: z.coerce.number().min(0),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: "Your location is required to punch." };
  const { direction, lat, lng, accuracy } = p.data;
  if (await ctx.db.punch.findFirst({ where: { employeeId: emp.id, source: "WEB", createdAt: { gte: new Date(Date.now() - 60_000) } } }))
    return { ok: false, message: "You punched less than a minute ago." };

  const branch = emp.branchId ? await ctx.db.branch.findFirst({ where: { id: emp.branchId } }) : null;
  let where = "";
  if (branch?.lat != null && branch.lng != null) {
    if (accuracy > 500) return { ok: false, message: `Location is too imprecise (±${Math.round(accuracy)} m). Turn on GPS and try again.` };
    const d = distanceM({ lat, lng }, { lat: branch.lat, lng: branch.lng });
    if (d - accuracy > branch.radiusM) return { ok: false, message: `You are about ${Math.round(d)} m from ${branch.name}. Punching is allowed within ${branch.radiusM} m.` };
    where = ` · ${Math.round(d)} m from ${branch.name}`;
  }
  const now = new Date();
  await ingestPunches(
    { orgId: ctx.orgId, deviceId: null, source: "WEB", createdById: ctx.user.id, note: `GPS ${lat.toFixed(5)},${lng.toFixed(5)} ±${Math.round(accuracy)}m${where}` },
    [{ employeeCode: emp.code, timestamp: now, direction, verifyMode: "WEB" }],
  );
  revalidatePath("/me");
  return { ok: true, message: `Clocked ${direction === "IN" ? "in" : "out"} at ${localTime(now, branch?.timezone ?? settings.timezone)}${where}.` };
}

export default async function Me({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await getCtx();
  const emp = ctx.employee;
  if (!emp) {
    return <Card title="No employee record">Your login is not linked to an employee record yet. Ask HR to link it.</Card>;
  }
  const settings = await ctx.db.orgSettings.findFirst();
  const branch = emp.branchId ? await ctx.db.branch.findFirst({ where: { id: emp.branchId } }) : null;
  const tz = branch?.timezone ?? settings?.timezone ?? "UTC";
  const today = localDate(new Date(), tz);
  const month = /^\d{4}-\d{2}$/.test((await searchParams).month ?? "") ? (await searchParams).month! : today.slice(0, 7);
  const { from, to } = monthRange(month);

  const [days, punches, balances, templates, consent, notices] = await Promise.all([
    ctx.db.attendanceDay.findMany({ where: { employeeId: emp.id, date: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: { date: "asc" } }),
    ctx.db.punch.findMany({ where: { employeeId: emp.id }, include: { device: true }, orderBy: { timestamp: "desc" }, take: 20 }),
    leaveBalances(ctx.db, emp.id, Number(month.slice(0, 4))),
    ctx.db.biometricTemplate.count({ where: { employeeId: emp.id } }),
    ctx.db.consent.findFirst({ where: { employeeId: emp.id, revokedAt: null } }),
    ctx.db.notice.findMany({ where: { OR: [{ expiresOn: null }, { expiresOn: { gte: toDbDate(today) } }] }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 3 }),
  ]);
  const byDate = new Map(days.map((d) => [fromDbDate(d.date), d]));
  const count = (s: string) => days.filter((d) => d.status === s).length;
  const lead = (dayOfWeek(from) + 6) % 7; // Monday-first calendar
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  const prev = addDays(from, -1).slice(0, 7);
  const next = addDays(to, 1).slice(0, 7);

  return (
    <>
      <PageHeader
        title={`Hello, ${emp.name.split(" ")[0]}`}
        description={`Employee code ${emp.code}`}
        actions={<LinkButton href="/me/requests" variant="primary">Request leave or correction</LinkButton>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Present" value={count("PRESENT") + count("HALF_DAY") / 2} tone="green" />
        <Stat label="Absent" value={count("ABSENT")} tone="red" />
        <Stat label="Leave" value={count("LEAVE")} tone="violet" />
        <Stat label="Late days" value={days.filter((d) => d.lateMinutes > 0).length} tone="amber" />
        <Stat label="Worked" value={fmtDuration(days.reduce((a, d) => a + d.workedMinutes, 0))} tone="blue" icon={Timer} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title={new Date(from + "T00:00:00Z").toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}
          actions={<div className="flex gap-3 text-sm"><Link className="text-blue-600" href={`?month=${prev}`}>←</Link><Link className="text-blue-600" href={`?month=${next}`}>→</Link></div>}
        >
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1 text-slate-500">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const a = byDate.get(d);
              return (
                <div key={d} className={`min-h-16 rounded-md border p-1 text-left ${d === today ? "border-blue-500" : "border-slate-100"} ${a ? STATUS_CELL[a.status] : ""}`}>
                  <div className="flex justify-between"><span className="font-medium">{d.slice(8)}</span>{a && <span>{STATUS_CODE[a.status]}</span>}</div>
                  {a?.firstIn && <div className="mt-1 tabular-nums">{localTime(a.firstIn, tz)}–{localTime(a.lastOut, tz)}</div>}
                  {a && a.lateMinutes > 0 && <div className="text-amber-700">late {a.lateMinutes}m</div>}
                  {a?.missingPunch && <div className="text-amber-700">missing punch</div>}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          {notices.length > 0 && (
            <Card title="Notices" actions={<Link className="text-xs font-medium text-blue-600 hover:underline" href="/notices">All notices</Link>}>
              <ul className="space-y-3">
                {notices.map((n) => (
                  <li key={n.id}>
                    <div className="text-sm font-medium text-slate-900">{n.title}</div>
                    <p className="line-clamp-2 whitespace-pre-line text-xs text-slate-600">{n.body}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {settings?.webPunch && (
            <Card title="Punch from this device">
              <WebPunch action={punchFromWeb} />
              {branch?.lat != null && <p className="mt-2 text-xs text-slate-400">Allowed within {branch.radiusM} m of {branch.name}.</p>}
            </Card>
          )}
          <Card title="Leave balance">
            <Table head={["Type", "Available", "Used"]}>
              {balances.map((b) => (
                <tr key={b.type.id}><td>{b.type.name}</td><td className="font-medium">{b.available}</td><td>{b.used}{b.pending ? ` (+${b.pending} pending)` : ""}</td></tr>
              ))}
            </Table>
          </Card>
          <Card title="Recent punches">
            <ul className="space-y-1 text-sm">
              {punches.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>{p.timestamp.toLocaleString("en", { timeZone: tz })}</span>
                  <span className="text-xs text-slate-500">{p.device?.name ?? p.source.toLowerCase()} {p.direction && <Badge>{p.direction}</Badge>}</span>
                </li>
              ))}
              {!punches.length && <li className="text-slate-400">No punches yet.</li>}
            </ul>
          </Card>
          <Card title="My biometric data">
            <p className="text-sm text-slate-600">
              {templates} fingerprint template(s) stored, encrypted. {consent ? `Consent given ${consent.givenAt.toLocaleDateString()}.` : "No active consent."}
            </p>
            {(templates > 0 || consent) && (
              <form action={deleteBiometrics} className="mt-3">
                <input type="hidden" name="employeeId" value={emp.id} />
                <ConfirmButton message="Delete your fingerprints and withdraw consent? You will need another way to record attendance.">Delete my biometric data</ConfirmButton>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
