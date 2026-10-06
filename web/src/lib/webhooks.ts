import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { decrypt, hmac } from "./crypto";
import { prisma } from "./db";
import { getBoss } from "./jobs";

export const WEBHOOK_EVENTS = ["punch.created", "request.decided", "employee.updated", "device.offline"] as const;

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** Tenants must not be able to make the server call its own network (SSRF). */
// ponytail: checked at save and before each delivery, but fetch re-resolves DNS; a rebinding attacker could still race it. Pin the resolved IP via a custom agent if that matters.
export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("Webhook URLs must use https.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) {
    const ip = address.replace(/^::ffff:/i, "");
    if (PRIVATE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4")) throw new Error("Webhook URLs must point to a public address.");
  }
}

export async function emitWebhook(orgId: string, event: (typeof WEBHOOK_EVENTS)[number], data: unknown) {
  const hooks = await prisma.webhook.findMany({ where: { organizationId: orgId, active: true } });
  const targets = hooks.filter((h) => h.events.includes(event) || h.events.includes("*"));
  if (!targets.length) return;
  const boss = await getBoss();
  const body = JSON.stringify({ event, organizationId: orgId, createdAt: new Date().toISOString(), data });
  for (const h of targets) {
    await boss.send("webhook", { webhookId: h.id, body }, { retryLimit: 6, retryBackoff: true });
  }
}

export async function deliverWebhook({ webhookId, body }: { webhookId: string; body: string }) {
  const h = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!h?.active) return;
  await assertPublicUrl(h.url);
  const secret = decrypt(h.organizationId, Buffer.from(h.secret, "base64")).toString();
  const res = await fetch(h.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": `sha256=${hmac(secret, body)}` },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook ${h.url} responded ${res.status}`);
}
