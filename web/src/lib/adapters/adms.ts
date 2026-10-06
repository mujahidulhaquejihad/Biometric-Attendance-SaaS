/**
 * ZKTeco "ADMS" / PUSH protocol, also spoken by eSSL, Biomax, Realtime, Identix and most OEM clones.
 * Devices poll /iclock/cdata (upload) and /iclock/getrequest (fetch commands) over plain HTTP.
 */
import type { Device } from "@prisma/client";
import { ingestLog } from "../audit";
import { decrypt, encrypt } from "../crypto";
import { prisma } from "../db";
import { assertLimit } from "../plans";
import { ingestPunches, linkPunches, orgTimezone, type RawPunch } from "../punches";
import { tenantDb } from "../db";
import { parseLocal } from "../time";

const VERIFY: Record<string, string> = { "0": "PASSWORD", "1": "FINGERPRINT", "2": "CARD", "3": "PASSWORD", "4": "CARD", "15": "FACE", "25": "PALM" };
const DIRECTION: Record<string, "IN" | "OUT"> = { "0": "IN", "1": "OUT", "2": "OUT", "3": "IN", "4": "IN", "5": "OUT" };

const clean = (s: string) => s.replace(/[\t\r\n]/g, " ").trim();
/** "PIN=1\tName=John" -> { pin: "1", name: "John" } (keys lower-cased; firmwares disagree on case). */
const kv = (line: string) =>
  Object.fromEntries(
    line.split("\t").map((part) => {
      const i = part.indexOf("=");
      return [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1)];
    }),
  );

// ---------- Command builders ----------

export const admsCmd = {
  user: (code: string, name: string) => `DATA UPDATE USERINFO PIN=${clean(code)}\tName=${clean(name).slice(0, 24)}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`,
  finger: (code: string, fid: number, tmp: string) => `DATA UPDATE FINGERTMP PIN=${clean(code)}\tFID=${fid}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`,
  deleteUser: (code: string) => `DATA DELETE USERINFO PIN=${clean(code)}`,
  deleteFingers: (code: string, fid?: number) => `DATA DELETE FINGERTMP PIN=${clean(code)}${fid === undefined ? "" : `\tFID=${fid}`}`,
  enroll: (code: string, fid: number) => `ENROLL_FP PIN=${clean(code)}\tFID=${fid}\tRETRY=3\tOVERWRITE=1`,
  /** Device re-uploads its stored ATTLOG for the range (dates are device-local YYYY-MM-DD). */
  queryLogs: (from: string, to: string) => `DATA QUERY ATTLOG StartTime=${from} 00:00:00\tEndTime=${to} 23:59:59`,
  reboot: () => "REBOOT",
  clearLog: () => "CLEAR LOG",
  check: () => "CHECK",
  info: () => "INFO",
};

export async function queueCommands(orgId: string, deviceId: string, commands: string[]) {
  if (commands.length) await prisma.deviceCommand.createMany({ data: commands.map((command) => ({ organizationId: orgId, deviceId, command })) });
}

/** Active ADMS terminals that should hold this employee (same branch, or terminals with no branch). */
async function terminalsFor(orgId: string, branchId: string | null) {
  return prisma.device.findMany({
    where: { organizationId: orgId, vendor: "ZKTECO_ADMS", status: "ACTIVE", OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
  });
}

async function employeeCommands(orgId: string, employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: { templates: { where: { format: "ZK_V10" } } } });
  if (!e) return { e: null, cmds: [] as string[] };
  if (!e.active) return { e, cmds: [admsCmd.deleteUser(e.code)] };
  return {
    e,
    cmds: [admsCmd.user(e.code, e.name), ...e.templates.map((t) => admsCmd.finger(e.code, t.finger, decrypt(orgId, t.data).toString()))],
  };
}

/** Push one employee (and their ZK templates) to every terminal in their branch. */
export async function syncEmployee(orgId: string, employeeId: string) {
  const { e, cmds } = await employeeCommands(orgId, employeeId);
  if (!e) return;
  for (const d of await terminalsFor(orgId, e.branchId)) await queueCommands(orgId, d.id, cmds);
}

/** Full resync of a terminal with every active employee of its branch. */
export async function syncDevice(device: Device) {
  if (!device.organizationId) return 0;
  const emps = await prisma.employee.findMany({
    where: { organizationId: device.organizationId, active: true, ...(device.branchId ? { branchId: device.branchId } : {}) },
    select: { id: true },
  });
  for (const { id } of emps) await queueCommands(device.organizationId, device.id, (await employeeCommands(device.organizationId, id)).cmds);
  return emps.length;
}

/** Wipes every finger of the employee from their terminals, or just one when `finger` is given. */
export async function removeFingersFromDevices(orgId: string, employeeId: string, finger?: number) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!e) return;
  for (const d of await terminalsFor(orgId, e.branchId)) await queueCommands(orgId, d.id, [admsCmd.deleteFingers(e.code, finger)]);
}

// ---------- Protocol handlers ----------

type Dev = Device & { branch: { timezone: string | null } | null };

export async function admsDevice(sn: string, ip: string): Promise<{ d: Dev; ok: boolean }> {
  let d: Dev | null = await prisma.device.findUnique({ where: { vendor_serial: { vendor: "ZKTECO_ADMS", serial: sn } }, include: { branch: true } });
  if (!d) {
    d = await prisma.device.create({ data: { vendor: "ZKTECO_ADMS", serial: sn, status: "PENDING", ip, name: `Terminal ${sn}` }, include: { branch: true } });
    await ingestLog("adms", "warn", `Unknown terminal ${sn} from ${ip} is waiting to be claimed`, sn);
  }
  const ipOk = !d.allowedIps.length || d.allowedIps.includes(ip);
  if (!ipOk) await ingestLog("adms", "warn", `Rejected ${sn}: IP ${ip} not in allow-list`, sn, d.organizationId);
  if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 30_000 || d.ip !== ip) {
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), ip, offlineNotified: false } });
  }
  return { d, ok: d.status === "ACTIVE" && !!d.organizationId && ipOk };
}

export function handshake(d: Dev) {
  return [
    `GET OPTION FROM: ${d.serial}`,
    `ATTLOGStamp=${d.attStamp ?? "None"}`,
    `OPERLOGStamp=${d.opStamp ?? "None"}`,
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP",
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");
}

export async function upload(d: Dev, table: string, stamp: string | null, body: Buffer): Promise<string> {
  const orgId = d.organizationId!;
  const tz = d.branch?.timezone ?? (await orgTimezone(orgId));
  const text = () => body.toString("utf8");

  if (table === "ATTLOG") {
    const punches: RawPunch[] = [];
    for (const line of text().split(/\r?\n/)) {
      const [pin, ts, status, verify] = line.split("\t");
      if (!pin || !ts) continue;
      punches.push({ employeeCode: pin.trim(), timestamp: parseLocal(ts, tz), direction: DIRECTION[status?.trim()] ?? null, verifyMode: VERIFY[verify?.trim()] ?? verify ?? null });
    }
    await ingestPunches({ orgId, deviceId: d.id, deviceName: d.name, source: "DEVICE" }, punches);
    if (stamp) await prisma.device.update({ where: { id: d.id }, data: { attStamp: stamp } });
    return `OK: ${punches.length}`;
  }

  if (table === "OPERLOG" || table === "USERINFO" || table === "FINGERTMP" || table === "BIODATA") {
    for (const raw of text().split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const [prefix] = line.split(" ", 1);
      const rest = /^(USER|FP|BIODATA|OPLOG)\s/.test(line) ? line.slice(prefix.length + 1) : line;
      const f = kv(rest);
      if (prefix === "USER" || (table === "USERINFO" && f.pin)) await deviceUser(orgId, tz, f.pin, f.name);
      else if (prefix === "FP" || (table === "FINGERTMP" && f.pin)) await deviceFinger(d, f.pin, Number(f.fid ?? 0), f.tmp);
      else if (prefix === "BIODATA" || table === "BIODATA") {
        if (f.type === "1") await deviceFinger(d, f.pin, Number(f.no ?? 0), f.tmp);
      }
    }
    if (stamp && table === "OPERLOG") await prisma.device.update({ where: { id: d.id }, data: { opStamp: stamp } });
    return "OK";
  }

  if (table === "ATTPHOTO") {
    const nul = body.indexOf(0);
    if (nul > 0) {
      const header = Object.fromEntries(body.subarray(0, nul).toString().split(/\r?\n/).map((l) => [l.split("=")[0].toLowerCase(), l.split("=").slice(1).join("=")]));
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(.+)\.jpg$/i.exec(header.pin ?? "");
      if (m) {
        await prisma.punchPhoto.create({
          data: { organizationId: orgId, deviceId: d.id, employeeCode: m[7], timestamp: parseLocal(`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, tz), data: new Uint8Array(body.subarray(nul + 1)) },
        });
      }
    }
    return "OK";
  }
  return "OK";
}

async function deviceUser(orgId: string, tz: string, pin?: string, name?: string) {
  if (!pin) return;
  const existing = await prisma.employee.findUnique({ where: { organizationId_code: { organizationId: orgId, code: pin } } });
  if (existing) return;
  try {
    const db = tenantDb(orgId);
    await assertLimit(db, "employees");
    const e = await db.employee.create({ data: { code: pin, name: name?.trim() || `Employee ${pin}` } });
    await linkPunches(orgId, e.id, pin, tz);
  } catch (err) {
    await ingestLog("adms", "warn", `Could not import device user ${pin}: ${(err as Error).message}`, null, orgId);
  }
}

async function deviceFinger(d: Dev, pin?: string, fid = 0, tmp?: string) {
  if (!pin || !tmp) return;
  const orgId = d.organizationId!;
  const e = await prisma.employee.findUnique({ where: { organizationId_code: { organizationId: orgId, code: pin } } });
  if (!e) return;
  const consent = await prisma.consent.findFirst({ where: { employeeId: e.id, revokedAt: null } });
  if (!consent) {
    await ingestLog("adms", "warn", `Fingerprint for ${pin} not stored: no biometric consent on record`, d.serial, orgId);
    return;
  }
  const data = encrypt(orgId, Buffer.from(tmp));
  await prisma.biometricTemplate.upsert({
    where: { employeeId_finger_format: { employeeId: e.id, finger: fid, format: "ZK_V10" } },
    create: { organizationId: orgId, employeeId: e.id, finger: fid, format: "ZK_V10", data },
    update: { data },
  });
  // Share the new finger with the employee's other terminals.
  const others = await terminalsFor(orgId, e.branchId);
  for (const o of others.filter((o) => o.id !== d.id)) await queueCommands(orgId, o.id, [admsCmd.finger(pin, fid, tmp)]);
}

export async function getRequest(d: Dev, info: string | null) {
  if (info) await prisma.device.update({ where: { id: d.id }, data: { firmware: info.split(",")[0]?.slice(0, 100) } });
  const cmds = await prisma.deviceCommand.findMany({ where: { deviceId: d.id, status: "PENDING" }, orderBy: { seq: "asc" }, take: 30 });
  if (!cmds.length) return "OK";
  await prisma.deviceCommand.updateMany({ where: { id: { in: cmds.map((c) => c.id) } }, data: { status: "SENT", sentAt: new Date() } });
  return cmds.map((c) => `C:${c.seq}:${c.command}`).join("\n");
}

export async function deviceCmdResult(d: Dev, body: string) {
  for (const line of body.split(/\r?\n/)) {
    if (!line.includes("ID=")) continue;
    const p = new URLSearchParams(line.trim());
    const seq = Number(p.get("ID"));
    if (!Number.isInteger(seq)) continue;
    const ret = p.get("Return") ?? "";
    await prisma.deviceCommand.updateMany({
      where: { seq, deviceId: d.id },
      data: { status: Number(ret) >= 0 ? "DONE" : "FAILED", result: `Return=${ret}`, doneAt: new Date() },
    });
  }
  return "OK";
}
