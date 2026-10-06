"use server";
import type { DeviceVendor } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { admsCmd, queueCommands, syncDevice } from "@/lib/adapters/adms";
import { audit } from "@/lib/audit";
import { decryptJson, encryptJson, newToken, sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertLimit } from "@/lib/plans";
import { assertRole, HR } from "@/lib/session";

const VENDORS = ["ZKTECO_ADMS", "ZK_PULL", "HIKVISION", "SUPREMA_BIOSTAR", "ANVIZ_CLOUD", "AGENT"] as const;
const TOKEN_VENDORS: DeviceVendor[] = ["HIKVISION", "AGENT"];

const opt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

function vendorConfig(vendor: DeviceVendor, fd: FormData, prev: Record<string, unknown> = {}) {
  const keep = (k: string) => opt(fd.get(k)) ?? (prev[k] as string | undefined);
  switch (vendor) {
    case "ZK_PULL":
      return { ip: keep("ip"), port: Number(keep("port") ?? 4370) };
    case "SUPREMA_BIOSTAR":
      return { ...prev, baseUrl: keep("baseUrl"), username: keep("username"), password: keep("password") };
    case "ANVIZ_CLOUD":
      return { ...prev, baseUrl: keep("baseUrl") ?? "https://api.us.crosschexcloud.com", apiKey: keep("apiKey"), apiSecret: keep("apiSecret") };
    default:
      return null;
  }
}

async function flashToken(deviceId: string, token: string) {
  (await cookies()).set("device_token", `${deviceId}:${token}`, { maxAge: 120, httpOnly: true, sameSite: "strict", path: "/" });
}

export async function addDevice(fd: FormData) {
  const ctx = await assertRole(HR);
  const p = z
    .object({ vendor: z.enum(VENDORS), name: z.string().trim().min(1).max(80), serial: z.string().trim().max(64).optional(), branchId: z.string().optional() })
    .parse({ vendor: fd.get("vendor"), name: fd.get("name"), serial: opt(fd.get("serial")), branchId: opt(fd.get("branchId")) });
  await assertLimit(ctx.db, "devices");
  if ((p.vendor === "ZKTECO_ADMS" || p.vendor === "ZK_PULL") && !p.serial) throw new Error("Serial number is required for this device type.");

  const cfg = vendorConfig(p.vendor, fd);
  const token = TOKEN_VENDORS.includes(p.vendor) ? newToken() : null;
  const base = {
    organizationId: ctx.orgId, name: p.name, branchId: p.branchId ?? null, status: "ACTIVE" as const,
    config: cfg ? encryptJson(ctx.orgId, cfg) : null, tokenHash: token ? sha256(token) : null,
  };

  let id: string;
  if (p.serial) {
    // ADMS terminals register themselves on first contact; claim that record if it is unowned.
    const existing = await prisma.device.findUnique({ where: { vendor_serial: { vendor: p.vendor, serial: p.serial } } });
    if (existing?.organizationId && existing.organizationId !== ctx.orgId) throw new Error("That serial number is registered to another organization.");
    if (existing?.organizationId === ctx.orgId) throw new Error("That device is already added.");
    id = existing
      ? (await prisma.device.update({ where: { id: existing.id }, data: base })).id
      : (await prisma.device.create({ data: { ...base, vendor: p.vendor, serial: p.serial } })).id;
  } else {
    id = (await prisma.device.create({ data: { ...base, vendor: p.vendor } })).id;
  }
  await audit(ctx, "create", "Device", id, { vendor: p.vendor, serial: p.serial ?? null });
  if (token) await flashToken(id, token);
  redirect(`/devices/${id}`);
}

export async function updateDevice(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  const d = await ctx.db.device.findFirstOrThrow({ where: { id } });
  const ips = String(fd.get("allowedIps") ?? "").split(/[\s,]+/).filter(Boolean);
  if (ips.some((ip) => !/^[0-9a-f.:]+$/i.test(ip))) throw new Error("Allowed IPs must be plain IPv4/IPv6 addresses.");
  const status = fd.get("status") === "DISABLED" ? "DISABLED" : "ACTIVE";
  if (status === "ACTIVE" && d.status === "DISABLED") await assertLimit(ctx.db, "devices");
  const cfg = vendorConfig(d.vendor, fd, decryptJson(ctx.orgId, d.config));
  await ctx.db.device.update({
    where: { id },
    data: {
      name: String(fd.get("name") || d.name).slice(0, 80),
      branchId: opt(fd.get("branchId")) ?? null,
      allowedIps: ips,
      status,
      ...(cfg ? { config: encryptJson(ctx.orgId, cfg) } : {}),
    },
  });
  await audit(ctx, "update", "Device", id, { status, allowedIps: ips });
  revalidatePath(`/devices/${id}`);
}

export async function deviceCommand(fd: FormData) {
  const ctx = await assertRole(HR);
  const d = await ctx.db.device.findFirstOrThrow({ where: { id: String(fd.get("id")), vendor: "ZKTECO_ADMS" } });
  const action = String(fd.get("action"));
  if (action === "sync") await syncDevice(d);
  else if (action === "reboot") await queueCommands(ctx.orgId, d.id, [admsCmd.reboot()]);
  else if (action === "clear") await queueCommands(ctx.orgId, d.id, [admsCmd.clearLog()]);
  else if (action === "check") await queueCommands(ctx.orgId, d.id, [admsCmd.check()]);
  else if (action === "info") await queueCommands(ctx.orgId, d.id, [admsCmd.info()]);
  else throw new Error("Unknown command");
  await audit(ctx, `command:${action}`, "Device", d.id);
  revalidatePath(`/devices/${d.id}`);
}

export async function regenerateToken(fd: FormData) {
  const ctx = await assertRole(HR);
  const d = await ctx.db.device.findFirstOrThrow({ where: { id: String(fd.get("id")) } });
  if (!TOKEN_VENDORS.includes(d.vendor)) throw new Error("This device type does not use a token.");
  const token = newToken();
  await ctx.db.device.update({ where: { id: d.id }, data: { tokenHash: sha256(token) } });
  await audit(ctx, "regenerate_token", "Device", d.id);
  await flashToken(d.id, token);
  revalidatePath(`/devices/${d.id}`);
}

export async function deleteDevice(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  await ctx.db.device.delete({ where: { id } });
  await audit(ctx, "delete", "Device", id);
  redirect("/devices");
}
