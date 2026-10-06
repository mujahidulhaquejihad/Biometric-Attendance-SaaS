import { prisma, tenantDb } from "./db";
import { PLANS } from "./plans";

/** New tenant with sensible defaults: settings, plan, a general shift, leave types, and the creator as admin. */
export async function createOrganization(name: string, timezone: string, ownerUserId: string, ownerName: string) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
  const org = await prisma.organization.create({ data: { name, slug } });
  await prisma.member.create({ data: { organizationId: org.id, userId: ownerUserId, role: "admin" } });

  const db = tenantDb(org.id);
  await db.orgSettings.create({ data: { timezone, weekOffs: [0] } });
  await db.subscription.create({ data: { plan: "FREE", ...PLANS.FREE } });
  const branch = await db.branch.create({ data: { name: "Head office", timezone } });
  const shift = await db.shift.create({ data: { name: "General (09:00-18:00)", startMinute: 540, endMinute: 1080 } });
  await db.leaveType.createMany({
    data: [
      { name: "Casual leave", code: "CL", annualQuota: 10 },
      { name: "Sick leave", code: "SL", annualQuota: 14 },
      { name: "Annual leave", code: "AL", annualQuota: 18, accrual: "MONTHLY", carryForwardMax: 10 },
      { name: "Unpaid leave", code: "UL", paid: false, annualQuota: 365 },
    ],
  });
  await db.employee.create({
    data: { code: "1", name: ownerName, userId: ownerUserId, branchId: branch.id, defaultShiftId: shift.id },
  });
  return org;
}
