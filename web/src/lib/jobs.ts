import PgBoss from "pg-boss";
import { prisma } from "./db";
import { notify, usersWithRoles } from "./notify";
import { addDays, localDate, wallClock } from "./time";

const g = globalThis as unknown as { boss?: Promise<PgBoss> };

const QUEUES: [string, PgBoss.Queue["policy"]?][] = [
  ["recompute", "stately"],
  ["webhook"],
  ["poll-cloud", "singleton"],
  ["device-offline", "singleton"],
  ["hourly", "singleton"],
];

export function getBoss() {
  g.boss ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
    boss.on("error", (e) => console.error("[jobs]", e));
    await boss.start();
    for (const [name, policy] of QUEUES) await boss.createQueue(name, policy ? { name, policy } : { name });
    return boss;
  })();
  return g.boss;
}

/** One queued job per employee-day; extra punches while queued collapse into it. */
export async function queueRecompute(items: { employeeId: string; date: string }[]) {
  if (!items.length) return;
  const boss = await getBoss();
  // Batch insert keeps the stately policy (ON CONFLICT DO NOTHING), so big imports don't do one round-trip per day.
  for (let i = 0; i < items.length; i += 1000)
    await boss.insert(items.slice(i, i + 1000).map((data) => ({ name: "recompute", data, singletonKey: `${data.employeeId}:${data.date}`, retryLimit: 3 })));
}

export async function startWorkers() {
  const boss = await getBoss();
  const { recomputeDay } = await import("./attendance");
  const { deliverWebhook, emitWebhook } = await import("./webhooks");
  const { pollCloudDevices } = await import("./adapters/cloud");
  const { runScheduledReports } = await import("./reports");
  const { sendDigest } = await import("./stats");

  await boss.work<{ employeeId: string; date: string }>("recompute", { batchSize: 20 }, async (jobs) => {
    for (const j of jobs) await recomputeDay(j.data.employeeId, j.data.date);
  });
  await boss.work<{ webhookId: string; body: string }>("webhook", async ([j]) => deliverWebhook(j.data));
  await boss.work("poll-cloud", async () => pollCloudDevices());

  await boss.work("device-offline", async () => {
    const stale = await prisma.device.findMany({
      where: { status: "ACTIVE", organizationId: { not: null }, offlineNotified: false, lastSeenAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    });
    for (const d of stale) {
      await prisma.device.update({ where: { id: d.id }, data: { offlineNotified: true } });
      await notify(d.organizationId!, await usersWithRoles(d.organizationId!, ["admin", "hr"]), `Device offline: ${d.name}`, `No contact since ${d.lastSeenAt?.toISOString()}.`, `/devices/${d.id}`);
      await emitWebhook(d.organizationId!, "device.offline", { deviceId: d.id, name: d.name, lastSeenAt: d.lastSeenAt });
    }
  });

  await boss.work("hourly", async () => {
    const orgs = await prisma.orgSettings.findMany();
    for (const s of orgs) {
      const now = new Date();
      const hour = wallClock(now, s.timezone).h;
      // Close yesterday after midnight, and again at noon once night shifts have ended.
      if (hour === 1 || hour === 12) {
        const emps = await prisma.employee.findMany({ where: { organizationId: s.organizationId, active: true }, select: { id: true, branch: { select: { timezone: true } } } });
        await queueRecompute(emps.map((e) => ({ employeeId: e.id, date: addDays(localDate(now, e.branch?.timezone ?? s.timezone), -1) })));
      }
      if (hour === s.digestHour) await sendDigest(s.organizationId);
      await runScheduledReports(s.organizationId, s.timezone, hour);
    }
  });

  await boss.schedule("poll-cloud", "* * * * *");
  await boss.schedule("device-offline", "*/5 * * * *");
  await boss.schedule("hourly", "2 * * * *");
  console.log("[jobs] workers started");
}
