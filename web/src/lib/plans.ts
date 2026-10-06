import type { TenantDb } from "./db";

export const PLANS = {
  FREE: { maxEmployees: 25, maxDevices: 2 },
  PRO: { maxEmployees: 500, maxDevices: 25 },
  ENTERPRISE: { maxEmployees: 100_000, maxDevices: 2_000 },
} as const;

export async function assertLimit(db: TenantDb, kind: "employees" | "devices", adding = 1) {
  const sub = await db.subscription.findFirst();
  if (!sub) return;
  const [count, max] =
    kind === "employees"
      ? [await db.employee.count({ where: { active: true } }), sub.maxEmployees]
      : [await db.device.count({ where: { status: { not: "DISABLED" } } }), sub.maxDevices];
  if (count + adding > max) throw new Error(`Your ${sub.plan} plan allows ${max} ${kind}. Upgrade to add more.`);
}
