import type { DeviceVendor } from "@prisma/client";
import { sha256 } from "./crypto";
import { prisma } from "./db";
import { clientIp } from "./ratelimit";

/** Resolve an active, claimed device from its secret token and mark it seen. */
export async function deviceByToken(token: string | null | undefined, vendors: DeviceVendor[], req?: Request) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const d = await prisma.device.findUnique({ where: { tokenHash: sha256(token) }, include: { branch: true } });
  if (!d || !d.organizationId || d.status !== "ACTIVE" || !vendors.includes(d.vendor)) return null;
  const ip = req ? clientIp(req) : d.ip;
  if (req && d.allowedIps.length && !d.allowedIps.includes(ip ?? "")) return null;
  if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 30_000) {
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), ip, offlineNotified: false } });
  }
  return d as typeof d & { organizationId: string };
}

export const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
