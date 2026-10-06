import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { prisma, tenantDb } from "./db";

export const ROLES = ["admin", "hr", "manager", "employee", "security"] as const;
export type Role = (typeof ROLES)[number];
export const HR: Role[] = ["admin", "hr"];
export const APPROVERS: Role[] = ["admin", "hr", "manager"];

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const getCtx = cache(async () => {
  const s = await getSession();
  if (!s) redirect("/login");
  const user = s.user as typeof s.user & { isSuperAdmin?: boolean };
  let orgId = s.session.activeOrganizationId ?? null;

  let member = orgId ? await prisma.member.findFirst({ where: { organizationId: orgId, userId: user.id } }) : null;
  if (!member && !(orgId && user.isSuperAdmin)) {
    member = await prisma.member.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (!member) redirect(user.isSuperAdmin ? "/admin" : "/select-org");
    orgId = member.organizationId;
    await prisma.session.update({ where: { id: s.session.id }, data: { activeOrganizationId: orgId } });
  }

  const organizationId = orgId!;
  const [org, employee, sub] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.employee.findFirst({ where: { organizationId, userId: user.id } }),
    prisma.subscription.findUnique({ where: { organizationId } }),
  ]);
  return {
    user,
    sessionId: s.session.id,
    orgId: organizationId,
    org: org!,
    role: (member?.role ?? "admin") as Role,
    impersonating: !member,
    employee,
    suspended: sub?.status === "SUSPENDED" && !user.isSuperAdmin,
    db: tenantDb(organizationId),
  };
});

export type Ctx = Awaited<ReturnType<typeof getCtx>>;

export async function requireRole(roles: readonly Role[]) {
  const ctx = await getCtx();
  if (!roles.includes(ctx.role)) redirect("/dashboard");
  if (ctx.suspended) redirect("/dashboard");
  return ctx;
}

/** For server actions: throws instead of redirecting so the error boundary can show it. */
export async function assertRole(roles: readonly Role[]) {
  const ctx = await getCtx();
  if (!roles.includes(ctx.role)) throw new Error("You do not have permission to do that.");
  if (ctx.suspended) throw new Error("This organization is suspended.");
  return ctx;
}

export async function requireSuperAdmin() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!(s.user as { isSuperAdmin?: boolean }).isSuperAdmin) redirect("/dashboard");
  return s;
}
