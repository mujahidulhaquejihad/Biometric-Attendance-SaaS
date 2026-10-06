import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

const SCOPED = new Set([
  "OrgSettings", "Subscription", "Branch", "Department", "Designation", "Employee", "Consent",
  "BiometricTemplate", "Device", "DeviceCommand", "Punch", "PunchPhoto", "Shift", "ShiftAssignment",
  "Holiday", "AttendanceDay", "LeaveType", "LeaveBalance", "LeaveRequest", "Regularization",
  "OvertimeRequest", "CompOffRequest", "Notice", "Visitor", "AuditLog", "Notification", "ApiKey", "Webhook", "ReportSchedule",
]);

/**
 * Prisma client that injects organizationId into every top-level query on tenant models.
 * Creates must use scalar foreign keys (employeeId: x), not relation connects.
 */
export function tenantDb(organizationId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SCOPED.has(model)) return query(args);
          const a = (args ?? {}) as Record<string, any>;
          switch (operation) {
            case "create":
              a.data = { ...a.data, organizationId };
              break;
            case "createMany":
            case "createManyAndReturn":
              a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: object) => ({ ...d, organizationId }));
              break;
            case "upsert":
              a.where = { ...a.where, organizationId };
              a.create = { ...a.create, organizationId };
              break;
            default:
              a.where = { ...a.where, organizationId };
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
