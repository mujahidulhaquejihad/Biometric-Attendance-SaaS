import { prisma } from "./db";
import { sendMail } from "./mail";

/** In-app notification plus email for each user. */
export async function notify(orgId: string, userIds: (string | null | undefined)[], title: string, body?: string, link?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ organizationId: orgId, userId, title, body, link })) });
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true } });
  const base = process.env.BETTER_AUTH_URL ?? "";
  await Promise.all(
    users.map((u) =>
      sendMail({ to: u.email, subject: title, text: [body, link && `${base}${link}`].filter(Boolean).join("\n\n") }).catch((e) =>
        console.error("[notify] mail failed", e),
      ),
    ),
  );
}

/** Users holding any of the given roles in the org. */
export async function usersWithRoles(orgId: string, roles: string[]) {
  const m = await prisma.member.findMany({ where: { organizationId: orgId, role: { in: roles } }, select: { userId: true } });
  return m.map((x) => x.userId);
}

/** Approver for an employee: their manager's login, else HR/admins. */
export async function approversFor(orgId: string, employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: { manager: true } });
  return e?.manager?.userId ? [e.manager.userId] : usersWithRoles(orgId, ["admin", "hr"]);
}
