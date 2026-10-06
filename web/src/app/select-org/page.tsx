import { redirect } from "next/navigation";
import { AuthShell, Button } from "@/components/ui";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function SelectOrg() {
  const s = await getSession();
  if (!s) redirect("/login");
  const superAdmin = !!(s.user as { isSuperAdmin?: boolean }).isSuperAdmin;
  const members = await prisma.member.findMany({ where: { userId: s.user.id }, include: { organization: true } });

  async function choose(fd: FormData) {
    "use server";
    const s = await getSession();
    if (!s) redirect("/login");
    const orgId = String(fd.get("orgId"));
    const isMember = await prisma.member.findFirst({ where: { userId: s.user.id, organizationId: orgId } });
    if (!isMember) throw new Error("Not a member of that organization");
    await prisma.session.update({ where: { id: s.session.id }, data: { activeOrganizationId: orgId } });
    await audit({ orgId, user: s.user }, "switch_org", "Organization", orgId);
    redirect("/dashboard");
  }

  return (
    <AuthShell title="Choose organization">
      {members.length === 0 && (
        <p className="text-sm text-slate-600">
          Your account is not linked to any organization yet. Ask your HR team to give you access.
        </p>
      )}
      <div className="space-y-2">
        {members.map((m) => (
          <form key={m.id} action={choose}>
            <input type="hidden" name="orgId" value={m.organizationId} />
            <Button variant="secondary" className="w-full justify-between">
              {m.organization.name} <span className="text-xs text-slate-400">{m.role}</span>
            </Button>
          </form>
        ))}
      </div>
      {superAdmin && <a href="/admin" className="mt-4 block text-sm text-violet-700 hover:underline">Platform admin</a>}
    </AuthShell>
  );
}
