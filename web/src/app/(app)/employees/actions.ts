"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { admsCmd, queueCommands, removeFingersFromDevices, syncEmployee } from "@/lib/adapters/adms";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { newToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertLimit } from "@/lib/plans";
import { assertRole, HR, ROLES } from "@/lib/session";
import { afterSave, employeeSchema, toData } from "./shared";

export async function createEmployee(fd: FormData) {
  const ctx = await assertRole(HR);
  const p = employeeSchema.parse(Object.fromEntries(fd));
  await assertLimit(ctx.db, "employees");
  if (await ctx.db.employee.findFirst({ where: { code: p.code } })) throw new Error(`Employee code ${p.code} is already used.`);
  const e = await ctx.db.employee.create({ data: toData(p) });
  await audit(ctx, "create", "Employee", e.id, { code: p.code });
  await afterSave(ctx, e.id, e.code, e.branchId);
  redirect(`/employees/${e.id}`);
}

export async function updateEmployee(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  const p = employeeSchema.parse(Object.fromEntries(fd));
  if (p.managerId === id) throw new Error("An employee cannot manage themselves.");
  const clash = await ctx.db.employee.findFirst({ where: { code: p.code, id: { not: id } } });
  if (clash) throw new Error(`Employee code ${p.code} is already used by ${clash.name}.`);
  const e = await ctx.db.employee.update({ where: { id }, data: toData(p) });
  await audit(ctx, "update", "Employee", id, toData(p) as never);
  await afterSave(ctx, id, e.code, e.branchId);
  revalidatePath(`/employees/${id}`);
}

export async function setActive(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  const active = fd.get("active") === "true";
  if (active) await assertLimit(ctx.db, "employees");
  await ctx.db.employee.update({ where: { id }, data: { active } });
  await audit(ctx, active ? "activate" : "deactivate", "Employee", id);
  await syncEmployee(ctx.orgId, id);
  revalidatePath(`/employees/${id}`);
}

/** Create (or reuse) a login for the employee, give it a role, and email a set-password link. */
export async function grantAccess(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  const role = z.enum(ROLES).parse(fd.get("role"));
  if (role === "admin" && ctx.role !== "admin") throw new Error("Only admins can grant admin access.");
  const e = await ctx.db.employee.findFirstOrThrow({ where: { id } });
  if (!e.email) throw new Error("Add an email address to this employee first.");

  let user = await prisma.user.findUnique({ where: { email: e.email } });
  const isNew = !user;
  if (!user) {
    user = await prisma.user.create({ data: { email: e.email, name: e.name } });
    const hash = await (await auth.$context).password.hash(newToken(32));
    await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
  }
  const existing = await prisma.member.findFirst({ where: { organizationId: ctx.orgId, userId: user.id } });
  if (existing?.role === "admin" && role !== "admin" && ctx.role !== "admin") throw new Error("Only admins can change an admin's role.");
  await prisma.member.upsert({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: user.id } },
    create: { organizationId: ctx.orgId, userId: user.id, role },
    update: { role },
  });
  await ctx.db.employee.update({ where: { id }, data: { userId: user.id } });
  if (isNew) await auth.api.requestPasswordReset({ body: { email: e.email, redirectTo: "/reset" }, headers: await headers() });
  await audit(ctx, "grant_access", "Employee", id, { role, userId: user.id });
  revalidatePath(`/employees/${id}`);
}

export async function revokeAccess(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  const e = await ctx.db.employee.findFirstOrThrow({ where: { id } });
  if (!e.userId) return;
  if (e.userId === ctx.user.id) throw new Error("You cannot revoke your own access.");
  await prisma.member.deleteMany({ where: { organizationId: ctx.orgId, userId: e.userId } });
  await ctx.db.employee.update({ where: { id }, data: { userId: null } });
  await audit(ctx, "revoke_access", "Employee", id);
  revalidatePath(`/employees/${id}`);
}

export async function recordConsent(fd: FormData) {
  const ctx = await assertRole(HR);
  const employeeId = String(fd.get("employeeId"));
  const signedName = z.string().trim().min(2).max(100).parse(fd.get("signedName"));
  await ctx.db.employee.findFirstOrThrow({ where: { id: employeeId } });
  const h = await headers();
  const c = await ctx.db.consent.create({
    data: { employeeId, signedName, recordedById: ctx.user.id, ip: h.get("x-forwarded-for")?.split(",")[0] ?? null },
  });
  await audit(ctx, "consent_given", "Employee", employeeId, { consentId: c.id });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/enroll");
}

/** GDPR/BIPA erasure: revoke consent, delete stored templates, and wipe fingers from terminals. */
export async function deleteBiometrics(fd: FormData) {
  const ctx = await assertRole(["admin", "hr", "manager", "employee", "security"]);
  const employeeId = String(fd.get("employeeId"));
  const isSelf = ctx.employee?.id === employeeId;
  if (!isSelf && !HR.includes(ctx.role)) throw new Error("You can only delete your own biometric data.");
  await ctx.db.employee.findFirstOrThrow({ where: { id: employeeId } });
  await ctx.db.biometricTemplate.deleteMany({ where: { employeeId } });
  await ctx.db.consent.updateMany({ where: { employeeId, revokedAt: null }, data: { revokedAt: new Date() } });
  await removeFingersFromDevices(ctx.orgId, employeeId);
  await audit(ctx, "biometrics_deleted", "Employee", employeeId, { self: isSelf });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/me");
}

/** Delete one finger (all formats) here and on the employee's terminals, e.g. before re-enrolling a worn or injured finger. */
export async function removeFinger(fd: FormData) {
  const ctx = await assertRole(HR);
  const employeeId = String(fd.get("employeeId"));
  const finger = z.coerce.number().int().min(0).max(9).parse(fd.get("finger"));
  await ctx.db.employee.findFirstOrThrow({ where: { id: employeeId } });
  await ctx.db.biometricTemplate.deleteMany({ where: { employeeId, finger } });
  await removeFingersFromDevices(ctx.orgId, employeeId, finger);
  await audit(ctx, "finger_removed", "Employee", employeeId, { finger });
  revalidatePath("/enroll");
  revalidatePath(`/employees/${employeeId}`);
}

/** Ask an ADMS terminal to start its own enrollment screen; it uploads the finger when done. */
export async function enrollOnTerminal(fd: FormData) {
  const ctx = await assertRole(HR);
  const employeeId = String(fd.get("employeeId"));
  const finger = z.coerce.number().int().min(0).max(9).parse(fd.get("finger"));
  const e = await ctx.db.employee.findFirstOrThrow({ where: { id: employeeId, active: true } });
  if (!(await ctx.db.consent.findFirst({ where: { employeeId, revokedAt: null } }))) throw new Error("Record consent first.");
  const d = await ctx.db.device.findFirstOrThrow({ where: { id: String(fd.get("deviceId")), vendor: "ZKTECO_ADMS", status: "ACTIVE" } });
  await queueCommands(ctx.orgId, d.id, [admsCmd.user(e.code, e.name), admsCmd.enroll(e.code, finger)]);
  await audit(ctx, "enroll_requested", "Employee", employeeId, { deviceId: d.id, finger });
  revalidatePath("/enroll");
}

export async function syncToDevices(fd: FormData) {
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  await ctx.db.employee.findFirstOrThrow({ where: { id } });
  await syncEmployee(ctx.orgId, id);
  revalidatePath(`/employees/${id}`);
}