import { prisma } from "./db";
import { notify, usersWithRoles } from "./notify";
import { addDays, dayOfWeek, fromDbDate, localDate, minutesFromMidnight, toDbDate } from "./time";

type Person = { id: string; name: string; code: string; department: string | null; managerId: string | null };

/** Live "who is where" for today, per employee time zone. */
export async function todayStats(orgId: string, filter: { managerId?: string } = {}) {
  const settings = await prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
  const orgTz = settings?.timezone ?? "UTC";
  const now = new Date();
  const orgToday = localDate(now, orgTz);
  const dates = [addDays(orgToday, -1), orgToday, addDays(orgToday, 1)].map(toDbDate);

  const [emps, days, assigns, leaves, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId: orgId, active: true, ...(filter.managerId ? { managerId: filter.managerId } : {}) },
      include: { department: true, defaultShift: true, branch: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceDay.findMany({ where: { organizationId: orgId, date: { in: dates } } }),
    prisma.shiftAssignment.findMany({ where: { organizationId: orgId, date: { in: dates } }, include: { shift: true } }),
    prisma.leaveRequest.findMany({ where: { organizationId: orgId, status: "APPROVED", fromDate: { lte: dates[2] }, toDate: { gte: dates[0] } } }),
    prisma.holiday.findMany({ where: { organizationId: orgId, date: { in: dates } } }),
  ]);
  const k = (id: string, d: Date | string) => `${id}|${typeof d === "string" ? d : fromDbDate(d)}`;
  const dayMap = new Map(days.map((d) => [k(d.employeeId, d.date), d]));
  const assignMap = new Map(assigns.map((a) => [k(a.employeeId, a.date), a]));

  const out = { total: emps.length, present: [] as Person[], late: [] as (Person & { minutes: number })[], leave: [] as Person[], off: [] as Person[], absent: [] as Person[], notYetIn: [] as Person[] };
  for (const e of emps) {
    const tz = e.branch?.timezone ?? orgTz;
    const today = localDate(now, tz);
    const p: Person = { id: e.id, name: e.name, code: e.code, department: e.department?.name ?? null, managerId: e.managerId };
    const day = dayMap.get(k(e.id, today));
    if (day?.firstIn) {
      out.present.push(p);
      if (day.lateMinutes > 0) out.late.push({ ...p, minutes: day.lateMinutes });
      continue;
    }
    if (leaves.some((l) => l.employeeId === e.id && fromDbDate(l.fromDate) <= today && fromDbDate(l.toDate) >= today)) {
      out.leave.push(p);
      continue;
    }
    const a = assignMap.get(k(e.id, today));
    const shift = a ? a.shift : e.defaultShift;
    const weekOff = a ? !a.shiftId : (shift?.weekOffs ?? settings?.weekOffs ?? [0]).includes(dayOfWeek(today));
    const holiday = holidays.some((h) => fromDbDate(h.date) === today && (!h.branchId || h.branchId === e.branchId));
    if (weekOff || holiday) {
      out.off.push(p);
      continue;
    }
    const start = (shift?.startMinute ?? 540) + (shift?.graceIn ?? 10);
    (minutesFromMidnight(now, today, tz) > start ? out.absent : out.notYetIn).push(p);
  }
  return out;
}

/** Daily counts for the trend chart. */
export async function trend(orgId: string, days = 14, managerId?: string) {
  const s = await prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
  const to = localDate(new Date(), s?.timezone ?? "UTC");
  const from = addDays(to, -(days - 1));
  const rows = await prisma.attendanceDay.findMany({
    where: { organizationId: orgId, date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(managerId ? { employee: { managerId } } : {}) },
    select: { date: true, status: true, lateMinutes: true },
  });
  const out = new Map<string, { date: string; present: number; late: number; absent: number; leave: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) out.set(d, { date: d, present: 0, late: 0, absent: 0, leave: 0 });
  for (const r of rows) {
    const o = out.get(fromDbDate(r.date));
    if (!o) continue;
    if (r.status === "PRESENT" || r.status === "HALF_DAY") o.present++;
    if (r.status === "ABSENT") o.absent++;
    if (r.status === "LEAVE") o.leave++;
    if (r.lateMinutes > 0) o.late++;
  }
  return [...out.values()];
}

/** Attendance % per department per day (present / expected), last N days. */
export async function departmentHeatmap(orgId: string, days = 7) {
  const s = await prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
  const to = localDate(new Date(), s?.timezone ?? "UTC");
  const from = addDays(to, -(days - 1));
  const rows = await prisma.attendanceDay.findMany({
    where: { organizationId: orgId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    select: { date: true, status: true, employee: { select: { department: { select: { name: true } } } } },
  });
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const agg = new Map<string, Map<string, { p: number; n: number }>>();
  for (const r of rows) {
    if (r.status === "WEEK_OFF" || r.status === "HOLIDAY") continue;
    const dept = r.employee.department?.name ?? "Unassigned";
    const m = agg.get(dept) ?? new Map();
    agg.set(dept, m);
    const c = m.get(fromDbDate(r.date)) ?? { p: 0, n: 0 };
    c.n++;
    if (r.status === "PRESENT" || r.status === "HALF_DAY") c.p++;
    m.set(fromDbDate(r.date), c);
  }
  return {
    dates,
    rows: [...agg.entries()].sort().map(([dept, m]) => ({ dept, cells: dates.map((d) => (m.get(d)?.n ? Math.round((m.get(d)!.p / m.get(d)!.n) * 100) : null)) })),
  };
}

export async function sendDigest(orgId: string) {
  const s = await todayStats(orgId);
  const lines = [
    `Present: ${s.present.length} / ${s.total}`,
    `Late: ${s.late.length}`,
    `On leave: ${s.leave.length}`,
    `Absent: ${s.absent.length}`,
    `Not yet in: ${s.notYetIn.length}`,
    s.absent.length ? `\nAbsent: ${s.absent.slice(0, 30).map((p) => p.name).join(", ")}` : "",
  ];
  await notify(orgId, await usersWithRoles(orgId, ["admin", "hr"]), "Daily attendance digest", lines.join("\n"), "/today");
}
