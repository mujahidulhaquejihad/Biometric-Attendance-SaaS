import type { Shift } from "@prisma/client";
import { prisma } from "./db";
import { computeDay, type ShiftRule } from "./engine/compute";
import { notify } from "./notify";
import { addDays, dayOfWeek, localDate, minutesFromMidnight, toDbDate, zonedToUtc } from "./time";

const DEFAULT_RULE: ShiftRule = {
  startMinute: 540, endMinute: 1080, graceIn: 10, graceOut: 10, breakMinutes: 60, halfDayMinutes: 240,
  fullDayMinutes: 420, otThreshold: 30, otMax: 0, windowBefore: 240, windowAfter: 240,
};
const toRule = (s: Shift | null | undefined): ShiftRule => (s ? { ...DEFAULT_RULE, ...s } : DEFAULT_RULE);

/** The shift rule for an employee-day and whether it is a holiday or weekly off. */
export async function schedule(emp: { id: string; organizationId: string; branchId: string | null; defaultShiftId: string | null }, date: string, orgWeekOffs?: number[]) {
  const [assignment, holiday, defaultShift] = await Promise.all([
    prisma.shiftAssignment.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDbDate(date) } }, include: { shift: true } }),
    prisma.holiday.findFirst({ where: { organizationId: emp.organizationId, date: toDbDate(date), OR: [{ branchId: null }, ...(emp.branchId ? [{ branchId: emp.branchId }] : [])] } }),
    emp.defaultShiftId ? prisma.shift.findUnique({ where: { id: emp.defaultShiftId } }) : null,
  ]);
  const shift = assignment ? assignment.shift : defaultShift;
  const weekOff = assignment ? assignment.shiftId === null : (shift?.weekOffs ?? orgWeekOffs ?? [0]).includes(dayOfWeek(date));
  return { shift, rule: toRule(shift), weekOff, holiday: !!holiday };
}

/** Recompute one employee-day from raw punches. Locked (payroll-closed) days are never touched. */
export async function recomputeDay(employeeId: string, date: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { branch: true } });
  if (!emp) return;
  const orgId = emp.organizationId;
  const key = { employeeId_date: { employeeId, date: toDbDate(date) } };
  const existing = await prisma.attendanceDay.findUnique({ where: key });
  if (existing?.locked) return;

  const settings = await prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
  const tz = emp.branch?.timezone ?? settings?.timezone ?? "UTC";

  // No rows for future days or days before joining.
  if (date > localDate(new Date(), tz)) return;
  if (emp.joinDate && toDbDate(date) < emp.joinDate) return;

  const [{ shift, rule, weekOff, holiday }, leave, punches] = await Promise.all([
    schedule(emp, date, settings?.weekOffs),
    prisma.leaveRequest.findFirst({ where: { employeeId, status: "APPROVED", fromDate: { lte: toDbDate(date) }, toDate: { gte: toDbDate(date) } } }),
    prisma.punch.findMany({
      where: { employeeId, timestamp: { gte: zonedToUtc(addDays(date, -1), "00:00", tz), lt: zonedToUtc(addDays(date, 2), "00:00", tz) } },
      select: { timestamp: true },
    }),
  ]);
  if (!emp.active && !punches.length) return;

  const r = computeDay({
    punches: punches.map((p) => minutesFromMidnight(p.timestamp, date, tz)),
    shift: rule,
    weekOff,
    holiday,
    leave: leave ? (leave.halfDay ? "HALF" : "FULL") : null,
    missingPunchStatus: settings?.missingPunchStatus ?? "PRESENT",
    autoDeductBreak: settings?.autoDeductBreak ?? true,
    dedupeMinutes: settings?.dedupeMinutes ?? 2,
  });

  const midnight = zonedToUtc(date, "00:00", tz).getTime();
  const at = (m: number | null) => (m === null ? null : new Date(midnight + m * 60_000));
  const data = {
    status: r.status,
    firstIn: at(r.firstIn),
    lastOut: at(r.lastOut),
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    earlyMinutes: r.earlyMinutes,
    otMinutes: r.otMinutes,
    missingPunch: r.missingPunch,
    shiftId: shift?.id ?? null,
  };
  await prisma.attendanceDay.upsert({
    where: key,
    create: { organizationId: orgId, employeeId, date: toDbDate(date), ...data },
    update: data,
  });

  // Only today's lateness is news; imports and terminal backlogs recompute old days too.
  if (settings?.notifyLate && r.lateMinutes > 0 && !existing?.lateMinutes && emp.userId && date === localDate(new Date(), tz)) {
    await notify(orgId, [emp.userId], `Late arrival on ${date}`, `You checked in ${r.lateMinutes} minutes after your shift start.`, "/me");
  }
}
