/**
 * Pull-based integrations, polled every minute by the "poll-cloud" job:
 *  - Suprema BioStar 2 (on-prem server REST API)
 *  - Anviz CrossChex Cloud API
 * Cursor and last error are kept inside the device's encrypted config.
 */
import type { Device } from "@prisma/client";
import { ingestLog } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import { prisma } from "../db";
import { ingestPunches, type RawPunch } from "../punches";

type Cfg = { baseUrl?: string; username?: string; password?: string; apiKey?: string; apiSecret?: string; cursor?: string; lastError?: string | null };

export async function pollCloudDevices() {
  const devices = await prisma.device.findMany({ where: { status: "ACTIVE", organizationId: { not: null }, vendor: { in: ["SUPREMA_BIOSTAR", "ANVIZ_CLOUD"] } } });
  for (const d of devices) {
    const orgId = d.organizationId!;
    const cfg = decryptJson<Cfg>(orgId, d.config);
    if (!cfg.baseUrl) continue;
    const since = cfg.cursor ? new Date(cfg.cursor) : new Date(Date.now() - 24 * 3600_000);
    try {
      const { punches, cursor } = d.vendor === "SUPREMA_BIOSTAR" ? await pollBioStar(cfg, since) : await pollAnviz(cfg, since);
      await ingestPunches({ orgId, deviceId: d.id, deviceName: d.name, source: "DEVICE" }, punches);
      await save(d, { ...cfg, cursor: cursor.toISOString(), lastError: null }, true);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== cfg.lastError) await ingestLog(d.vendor.toLowerCase(), "error", msg, d.serial, orgId);
      await save(d, { ...cfg, lastError: msg }, false);
    }
  }
}

async function save(d: Device, cfg: Cfg, ok: boolean) {
  await prisma.device.update({
    where: { id: d.id },
    data: { config: encryptJson(d.organizationId!, cfg), ...(ok ? { lastSeenAt: new Date(), offlineNotified: false } : {}) },
  });
}

const timeout = () => AbortSignal.timeout(20_000);

// ---------- Suprema BioStar 2 ----------
// ponytail: BioStar servers often use self-signed TLS; point NODE_EXTRA_CA_CERTS at its CA rather than disabling verification.

/** Verify-success (0x10xx) and identify-success (0x13xx) event codes. */
const isAuthSuccess = (code: number) => (code >= 0x1000 && code <= 0x10ff) || (code >= 0x1300 && code <= 0x13ff);

async function pollBioStar(cfg: Cfg, since: Date) {
  const base = cfg.baseUrl!.replace(/\/$/, "");
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ User: { login_id: cfg.username, password: cfg.password } }),
    signal: timeout(),
  });
  const session = login.headers.get("bs-session-id");
  if (!login.ok || !session) throw new Error(`BioStar login failed (${login.status})`);

  const now = new Date();
  const res = await fetch(`${base}/api/events/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "bs-session-id": session },
    body: JSON.stringify({
      Query: {
        limit: 500,
        conditions: [{ column: "datetime", operator: 3, values: [since.toISOString(), now.toISOString()] }],
        orders: [{ column: "datetime", descending: false }],
      },
    }),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`BioStar event search failed (${res.status})`);
  const body = (await res.json()) as { EventCollection?: { rows?: { datetime: string; user_id?: { user_id?: string }; event_type_id?: { code?: string } }[] } };
  const rows = body.EventCollection?.rows ?? [];

  const punches: RawPunch[] = rows
    .filter((r) => r.user_id?.user_id && isAuthSuccess(Number(r.event_type_id?.code)))
    .map((r) => ({ employeeCode: String(r.user_id!.user_id), timestamp: new Date(r.datetime), verifyMode: "BIOSTAR" }));
  // A full page means more remain: continue from the last row next minute.
  const cursor = rows.length === 500 ? new Date(rows[rows.length - 1].datetime) : now;
  return { punches, cursor };
}

// ---------- Anviz CrossChex Cloud ----------

async function anvizCall(base: string, nameSpace: string, nameAction: string, payload: object, token?: string) {
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      header: { nameSpace, nameAction, version: "1.0", requestId: crypto.randomUUID(), timestamp: new Date().toISOString() },
      ...(token ? { authorize: { type: "token", token } } : {}),
      payload,
    }),
    signal: timeout(),
  });
  const j = (await res.json().catch(() => ({}))) as { header?: { nameSpace?: string }; payload?: Record<string, any> };
  if (!res.ok || j.header?.nameSpace === "System") throw new Error(`CrossChex ${nameSpace}.${nameAction} failed: ${JSON.stringify(j.payload ?? res.status).slice(0, 200)}`);
  return j.payload ?? {};
}

async function pollAnviz(cfg: Cfg, since: Date) {
  const base = cfg.baseUrl!.replace(/\/$/, "") + "/";
  const { token } = await anvizCall(base, "authorize.token", "token", { api_key: cfg.apiKey, api_secret: cfg.apiSecret });
  if (!token) throw new Error("CrossChex did not return a token; check the API key and secret.");
  const now = new Date();
  const punches: RawPunch[] = [];
  for (let page = 1; page <= 20; page++) {
    const p = await anvizCall(base, "attendance.record", "getrecord", { begin_time: since.toISOString(), end_time: now.toISOString(), order: "asc", page, per_page: 100 }, token);
    const list = (p.list ?? []) as { checktime: string; checktype?: number; employee?: { workno?: string } }[];
    for (const r of list) {
      if (!r.employee?.workno) continue;
      punches.push({ employeeCode: String(r.employee.workno), timestamp: new Date(r.checktime), direction: r.checktype === 1 ? "OUT" : r.checktype === 0 ? "IN" : null, verifyMode: "ANVIZ" });
    }
    if (page >= Number(p.pageCount ?? 1)) break;
  }
  return { punches, cursor: now };
}
