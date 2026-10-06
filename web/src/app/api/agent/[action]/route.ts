import { z } from "zod";
import { audit } from "@/lib/audit";
import { decrypt, decryptJson, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { bearer, deviceByToken } from "@/lib/device-auth";
import { ingestPunches, orgTimezone, type RawPunch } from "@/lib/punches";
import { rateLimit } from "@/lib/ratelimit";
import { parseLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

const punchesSchema = z.object({
  punches: z.array(z.object({
    code: z.string().min(1).max(24),
    time: z.string().datetime({ offset: true }).optional(),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/).optional(),
    serial: z.string().max(64).optional(),
    verifyMode: z.string().max(20).optional(),
    direction: z.enum(["IN", "OUT"]).optional(),
  })).max(5000),
  seen: z.array(z.string().max(64)).max(200).optional(),
});

const templateSchema = z.object({ code: z.string().min(1).max(24), finger: z.number().int().min(0).max(9), template: z.string().max(40_000) });

async function agent(req: Request) {
  const token = bearer(req);
  if (!rateLimit(`agent:${token?.slice(0, 12)}`, 300)) return null;
  return deviceByToken(token, ["AGENT"], req);
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== "sync") return json({ error: "not found" }, 404);
  const d = await agent(req);
  if (!d) return json({ error: "unauthorized" }, 401);
  const branch = d.branchId ? { branchId: d.branchId } : {};
  const [employees, templates, pull] = await Promise.all([
    prisma.employee.findMany({ where: { organizationId: d.organizationId, active: true, ...branch }, select: { id: true, code: true, name: true, photoUrl: true } }),
    prisma.biometricTemplate.findMany({ where: { organizationId: d.organizationId, format: "SOURCEAFIS", employee: { active: true, ...branch } }, include: { employee: { select: { code: true } } } }),
    prisma.device.findMany({ where: { organizationId: d.organizationId, vendor: "ZK_PULL", status: "ACTIVE", ...(d.branchId ? { OR: [{ branchId: d.branchId }, { branchId: null }] } : {}) } }),
  ]);
  return json({
    serverTime: new Date().toISOString(),
    agent: { id: d.id, name: d.name },
    employees: employees.map(({ code, name, photoUrl }) => ({ code, name, photoUrl })),
    templates: templates.map((t) => ({ code: t.employee.code, finger: t.finger, template: decrypt(d.organizationId, t.data).toString("base64") })),
    pullDevices: pull.map((p) => ({ serial: p.serial, ...decryptJson<{ ip?: string; port?: number }>(d.organizationId, p.config) })).filter((p) => p.ip),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const action = (await params).action;
  const d = await agent(req);
  if (!d) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => null);

  if (action === "punches") {
    const p = punchesSchema.safeParse(body);
    if (!p.success) return json({ error: p.error.issues[0].message }, 400);
    const groups = new Map<string, typeof p.data.punches>();
    for (const x of p.data.punches) groups.set(x.serial ?? "", [...(groups.get(x.serial ?? "") ?? []), x]);

    let accepted = 0;
    for (const [serial, list] of groups) {
      const source = serial ? await prisma.device.findFirst({ where: { organizationId: d.organizationId, vendor: "ZK_PULL", serial } }) : d;
      if (!source) continue;
      const tz = await orgTimezone(d.organizationId, source.branchId);
      const raw: RawPunch[] = list
        .filter((x) => x.time || x.localTime)
        .map((x) => ({ employeeCode: x.code, timestamp: x.time ? new Date(x.time) : parseLocal(x.localTime!, tz), verifyMode: x.verifyMode ?? "FINGERPRINT", direction: x.direction ?? null }));
      accepted += await ingestPunches({ orgId: d.organizationId, deviceId: source.id, deviceName: source.name, source: serial ? "DEVICE" : "AGENT" }, raw);
    }
    if (p.data.seen?.length) {
      await prisma.device.updateMany({ where: { organizationId: d.organizationId, vendor: "ZK_PULL", serial: { in: p.data.seen } }, data: { lastSeenAt: new Date(), offlineNotified: false } });
    }
    return json({ accepted, received: p.data.punches.length });
  }

  if (action === "templates") {
    const p = templateSchema.safeParse(body);
    if (!p.success) return json({ error: p.error.issues[0].message }, 400);
    const e = await prisma.employee.findUnique({ where: { organizationId_code: { organizationId: d.organizationId, code: p.data.code } } });
    if (!e) return json({ error: "unknown employee" }, 404);
    const consent = await prisma.consent.findFirst({ where: { employeeId: e.id, revokedAt: null } });
    if (!consent) return json({ error: "no biometric consent on record for this employee" }, 403);
    const data = encrypt(d.organizationId, Buffer.from(p.data.template, "base64"));
    await prisma.biometricTemplate.upsert({
      where: { employeeId_finger_format: { employeeId: e.id, finger: p.data.finger, format: "SOURCEAFIS" } },
      create: { organizationId: d.organizationId, employeeId: e.id, finger: p.data.finger, format: "SOURCEAFIS", data },
      update: { data },
    });
    await audit({ orgId: d.organizationId, user: null }, "enroll_finger", "Employee", e.id, { finger: p.data.finger, agent: d.id });
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
