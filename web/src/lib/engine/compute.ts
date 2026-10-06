/**
 * Pure attendance rules. All times are minutes from local midnight of the attendance date,
 * so a night shift's next-morning punch at 06:10 is 1810.
 */

export type DayStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE" | "HOLIDAY" | "WEEK_OFF";

export type ShiftRule = {
  startMinute: number;
  endMinute: number; // <= startMinute means the shift ends the next day
  graceIn: number;
  graceOut: number;
  breakMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  otThreshold: number; // extra minutes needed before any OT counts
  otMax: number; // 0 = uncapped
  windowBefore: number; // punches accepted this long before start...
  windowAfter: number; // ...and this long after end
};

export type DayInput = {
  punches: number[];
  shift: ShiftRule;
  weekOff: boolean;
  holiday: boolean;
  leave: "FULL" | "HALF" | null;
  missingPunchStatus: DayStatus;
  autoDeductBreak: boolean;
  dedupeMinutes: number;
};

export type DayResult = {
  status: DayStatus;
  firstIn: number | null;
  lastOut: number | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otMinutes: number;
  missingPunch: boolean;
};

export function computeDay(i: DayInput): DayResult {
  const s = i.shift;
  const start = s.startMinute;
  const end = s.endMinute <= start ? s.endMinute + 1440 : s.endMinute;

  const ps: number[] = [];
  for (const p of [...i.punches].sort((a, b) => a - b)) {
    if (p < start - s.windowBefore || p > end + s.windowAfter) continue;
    if (ps.length && p - ps[ps.length - 1] < i.dedupeMinutes) continue;
    ps.push(p);
  }

  const pairs = Math.floor(ps.length / 2);
  let worked = 0;
  for (let k = 0; k < pairs; k++) worked += ps[2 * k + 1] - ps[2 * k];
  // A single in/out pair means the break was never punched; deduct it.
  if (pairs === 1 && i.autoDeductBreak && worked > s.breakMinutes) worked -= s.breakMinutes;

  const missingPunch = ps.length % 2 === 1;
  const firstIn = ps[0] ?? null;
  const lastOut = pairs ? ps[2 * pairs - 1] : null;
  const capOt = (m: number) => (m >= s.otThreshold ? (s.otMax ? Math.min(m, s.otMax) : m) : 0);
  const base = { firstIn, lastOut, workedMinutes: worked, missingPunch, lateMinutes: 0, earlyMinutes: 0 };

  if (i.weekOff || i.holiday) {
    const off: DayStatus = i.holiday ? "HOLIDAY" : "WEEK_OFF";
    return { ...base, status: ps.length ? "PRESENT" : off, otMinutes: capOt(worked) };
  }
  if (i.leave === "FULL") return { ...base, status: "LEAVE", otMinutes: 0 };

  const scheduled = end - start - s.breakMinutes;
  const otMinutes = capOt(worked - scheduled);

  if (i.leave === "HALF") {
    const status: DayStatus = worked >= s.halfDayMinutes ? "PRESENT" : "HALF_DAY";
    return { ...base, status, otMinutes };
  }

  const lateMinutes = firstIn !== null && firstIn > start + s.graceIn ? firstIn - start : 0;
  const earlyMinutes = lastOut !== null && lastOut < end - s.graceOut ? end - lastOut : 0;

  let status: DayStatus;
  if (!ps.length) status = "ABSENT";
  else if (missingPunch) status = i.missingPunchStatus;
  else status = worked >= s.fullDayMinutes ? "PRESENT" : worked >= s.halfDayMinutes ? "HALF_DAY" : "ABSENT";

  return { ...base, status, lateMinutes, earlyMinutes, otMinutes };
}
