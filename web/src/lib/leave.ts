import type { TenantDb } from "./db";
import { toDbDate } from "./time";

export const leaveDays = (from: string, to: string, halfDay: boolean) =>
  halfDay ? 0.5 : Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86400_000) + 1;

/**
 * Balance per leave type for a year: allocation (yearly, or accrued monthly to date) + manual
 * adjustments/carry-forward - approved usage.
 */
// ponytail: usage counts calendar days; switch to working days if a tenant needs weekends excluded.
export async function leaveBalances(db: TenantDb, employeeId: string, year: number, today = new Date()) {
  const [types, adjustments, requests] = await Promise.all([
    db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId, year } }),
    db.leaveRequest.findMany({
      where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, fromDate: { lte: toDbDate(`${year}-12-31`) }, toDate: { gte: toDbDate(`${year}-01-01`) } },
    }),
  ]);
  const monthsElapsed = today.getUTCFullYear() > year ? 12 : today.getUTCFullYear() < year ? 0 : today.getUTCMonth() + 1;
  return types.map((t) => {
    const allocated = t.accrual === "MONTHLY" ? Math.round(((t.annualQuota * monthsElapsed) / 12) * 2) / 2 : t.annualQuota;
    const adjustment = adjustments.find((a) => a.leaveTypeId === t.id)?.adjustment ?? 0;
    const sum = (status: string) => requests.filter((r) => r.leaveTypeId === t.id && r.status === status).reduce((a, r) => a + r.days, 0);
    const used = sum("APPROVED");
    const pending = sum("PENDING");
    return { type: t, allocated, adjustment, used, pending, available: allocated + adjustment - used - pending };
  });
}