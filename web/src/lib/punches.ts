import type { Direction, PunchSource } from "@prisma/client";
import { prisma } from "./db";
import { queueRecompute } from "./jobs";
import { publish } from "./live";
import { addDays, localDate } from "./time";
import { emitWebhook } from "./webhooks";

export type RawPunch = { employeeCode: string; timestamp: Date; verifyMode?: string | null; direction?: Direction | null };

export async function orgTimezone(orgId: string, branchId?: string | null) {
  if (branchId) {
    const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
    if (b?.timezone) return b.timezone;
  }
  const s = await prisma.orgSettings.findUnique({ where: { organizationId: orgId }, select: { timezone: true } });
  return s?.timezone ?? "UTC";
}

/**
 * Single entry point for every punch source (terminals, agent, API, manual).
 * Idempotent: duplicates by (device, code, timestamp) are skipped.
 */
export async function ingestPunches(
  opts: { orgId: string; deviceId: string | null; deviceName?: string | null; source: PunchSource; createdById?: string; note?: string },
  punches: RawPunch[],
) {
  const maxTs = Date.now() + 24 * 3600_000;
  const valid = punches.filter((p) => p.employeeCode && Number.isFinite(p.timestamp.getTime()) && p.timestamp.getTime() < maxTs);
  if (!valid.length) return 0;

  const codes = [...new Set(valid.map((p) => p.employeeCode))];
  const emps = await prisma.employee.findMany({
    where: { organizationId: opts.orgId, code: { in: codes } },
    select: { id: true, code: true, name: true, branch: { select: { timezone: true } } },
  });
  const byCode = new Map(emps.map((e) => [e.code, e]));

  const created = await prisma.punch.createManyAndReturn({
    data: valid.map((p) => ({
      organizationId: opts.orgId,
      employeeCode: p.employeeCode,
      employeeId: byCode.get(p.employeeCode)?.id ?? null,
      deviceId: opts.deviceId,
      timestamp: p.timestamp,
      verifyMode: p.verifyMode ?? null,
      direction: p.direction ?? null,
      source: opts.source,
      createdById: opts.createdById,
      note: opts.note,
    })),
    skipDuplicates: true,
  });
  if (!created.length) return 0;

  const orgTz = await orgTimezone(opts.orgId);
  const jobs = new Map<string, { employeeId: string; date: string }>();
  for (const p of created) {
    if (!p.employeeId) continue;
    const tz = byCode.get(p.employeeCode)?.branch?.timezone ?? orgTz;
    const d = localDate(p.timestamp, tz);
    for (const date of [d, addDays(d, -1)]) jobs.set(`${p.employeeId}|${date}`, { employeeId: p.employeeId, date });
  }
  await queueRecompute([...jobs.values()]);

  // Only fresh punches go to the live feed; offline backlogs would flood it.
  const recent = created.filter((p) => Date.now() - p.timestamp.getTime() < 6 * 3600_000).slice(-50);
  for (const p of recent) {
    await publish({
      orgId: opts.orgId,
      type: "punch",
      employeeName: byCode.get(p.employeeCode)?.name ?? null,
      employeeCode: p.employeeCode,
      deviceId: p.deviceId,
      deviceName: opts.deviceName ?? null,
      timestamp: p.timestamp.toISOString(),
      direction: p.direction,
      verifyMode: p.verifyMode,
    });
  }

  // History imports are not new events; subscribers would get thousands of stale punches.
  if (opts.source !== "IMPORT") await emitWebhook(
    opts.orgId,
    "punch.created",
    created.map((p) => ({ id: p.id, employeeCode: p.employeeCode, timestamp: p.timestamp, direction: p.direction, source: p.source, deviceId: p.deviceId })),
  );
  return created.length;
}

/** Attach earlier unresolved punches to a newly created employee and recompute those days. */
export async function linkPunches(orgId: string, employeeId: string, code: string, tz: string) {
  const orphans = await prisma.punch.findMany({ where: { organizationId: orgId, employeeCode: code, employeeId: null }, select: { timestamp: true } });
  if (!orphans.length) return;
  await prisma.punch.updateMany({ where: { organizationId: orgId, employeeCode: code, employeeId: null }, data: { employeeId } });
  const dates = new Set(orphans.flatMap((p) => [localDate(p.timestamp, tz), addDays(localDate(p.timestamp, tz), -1)]));
  await queueRecompute([...dates].map((date) => ({ employeeId, date })));
}
