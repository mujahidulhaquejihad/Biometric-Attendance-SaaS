import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDay, type DayInput, type ShiftRule } from "./compute.ts";

const day: ShiftRule = {
  startMinute: 9 * 60, endMinute: 18 * 60, graceIn: 10, graceOut: 10, breakMinutes: 60,
  halfDayMinutes: 240, fullDayMinutes: 420, otThreshold: 30, otMax: 0, windowBefore: 240, windowAfter: 240,
};
const night: ShiftRule = { ...day, startMinute: 22 * 60, endMinute: 6 * 60 };
const t = (h: number, m = 0) => h * 60 + m;
const run = (punches: number[], over: Partial<DayInput> = {}) =>
  computeDay({ punches, shift: day, weekOff: false, holiday: false, leave: null, missingPunchStatus: "PRESENT", autoDeductBreak: true, dedupeMinutes: 2, ...over });

test("on time within grace", () => {
  const r = run([t(9, 10), t(18)]);
  assert.equal(r.status, "PRESENT");
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.workedMinutes, 530 - 60);
});

test("late beyond grace counts from shift start", () => {
  assert.equal(run([t(9, 11), t(18)]).lateMinutes, 11);
});

test("early exit beyond grace", () => {
  assert.equal(run([t(9), t(17, 30)]).earlyMinutes, 30);
});

test("night shift crossing midnight", () => {
  const r = run([t(21, 55), t(30, 10)], { shift: night }); // 06:10 next day
  assert.equal(r.status, "PRESENT");
  assert.equal(r.workedMinutes, 495 - 60);
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.otMinutes, 0); // 15 extra < 30 threshold
});

test("overtime and cap", () => {
  assert.equal(run([t(9), t(20)]).otMinutes, 120);
  assert.equal(run([t(9), t(20)], { shift: { ...day, otMax: 90 } }).otMinutes, 90);
});

test("missing out-punch uses policy status", () => {
  const r = run([t(9)]);
  assert.equal(r.missingPunch, true);
  assert.equal(r.status, "PRESENT");
  assert.equal(r.workedMinutes, 0);
  assert.equal(run([t(9)], { missingPunchStatus: "HALF_DAY" }).status, "HALF_DAY");
});

test("double tap is de-duplicated and break pairs are not auto-deducted", () => {
  const r = run([t(9), t(9, 1), t(13), t(14), t(18)]);
  assert.equal(r.workedMinutes, 240 + 240);
  assert.equal(r.missingPunch, false);
});

test("punches outside the window are ignored", () => {
  assert.equal(run([-30, t(9), t(18)]).firstIn, t(9)); // 23:30 previous day
});

test("absent, holiday, week-off, leave", () => {
  assert.equal(run([]).status, "ABSENT");
  assert.equal(run([], { holiday: true }).status, "HOLIDAY");
  assert.equal(run([], { weekOff: true }).status, "WEEK_OFF");
  assert.equal(run([], { leave: "FULL" }).status, "LEAVE");
  const worked = run([t(9), t(13)], { weekOff: true });
  assert.equal(worked.status, "PRESENT");
  assert.equal(worked.otMinutes, 240 - 60);
});

test("short day becomes half day; half-day leave covers the rest", () => {
  assert.equal(run([t(9), t(14)]).status, "HALF_DAY");
  assert.equal(run([t(9), t(14)], { leave: "HALF" }).status, "PRESENT");
});
