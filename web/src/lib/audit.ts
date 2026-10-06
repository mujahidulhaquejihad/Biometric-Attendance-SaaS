import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export async function audit(
  ctx: { orgId: string | null; user: { id: string } | null },
  action: string,
  entity: string,
  entityId?: string | null,
  data?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: { organizationId: ctx.orgId, userId: ctx.user?.id ?? null, action, entity, entityId: entityId ?? null, data },
  });
}

export async function ingestLog(source: string, level: "info" | "warn" | "error", message: string, deviceSerial?: string | null, organizationId?: string | null) {
  await prisma.ingestLog.create({ data: { source, level, message: message.slice(0, 2000), deviceSerial, organizationId } }).catch(() => {});
}
