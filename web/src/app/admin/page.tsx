import type { Plan, SubStatus } from "@prisma/client";
import { Building2, Fingerprint, ScanLine, Wifi } from "lucide-react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ConfirmButton, SignOutButton } from "@/components/client";
import { Badge, Button, Card, FilterBar, Input, Select, Stat, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { VENDOR_LABEL } from "@/lib/device-meta";
import { PLANS } from "@/lib/plans";
import { requireSuperAdmin } from "@/lib/session";

export const metadata = { title: "Platform admin" };

async function enterOrg(fd: FormData) {
  "use server";
  const s = await requireSuperAdmin();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: String(fd.get("orgId")) } });
  await prisma.session.update({ where: { id: s.session.id }, data: { activeOrganizationId: org.id } });
  await audit({ orgId: org.id, user: s.user }, "impersonate", "Organization", org.id, { by: s.user.email });
  redirect("/dashboard");
}

async function setPlan(fd: FormData) {
  "use server";
  const s = await requireSuperAdmin();
  const p = z.object({
    orgId: z.string(),
    plan: z.enum(["FREE", "PRO", "ENTERPRISE"]),
    status: z.enum(["ACTIVE", "PAST_DUE", "SUSPENDED"]),
    maxEmployees: z.coerce.number().int().min(1).optional(),
    maxDevices: z.coerce.number().int().min(1).optional(),
  }).parse(Object.fromEntries([...fd].filter(([, v]) => v !== "")));
  const data = {
    plan: p.plan as Plan,
    status: p.status as SubStatus,
    maxEmployees: p.maxEmployees ?? PLANS[p.plan].maxEmployees,
    maxDevices: p.maxDevices ?? PLANS[p.plan].maxDevices,
  };
  await prisma.subscription.upsert({ where: { organizationId: p.orgId }, create: { organizationId: p.orgId, ...data }, update: data });
  await audit({ orgId: p.orgId, user: s.user }, "set_plan", "Subscription", p.orgId, data);
  revalidatePath("/admin");
}

async function deleteUnclaimed(fd: FormData) {
  "use server";
  const s = await requireSuperAdmin();
  const id = String(fd.get("id"));
  await prisma.device.deleteMany({ where: { id, organizationId: null } });
  await audit({ orgId: null, user: s.user }, "delete_unclaimed", "Device", id);
  revalidatePath("/admin");
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSuperAdmin();
  const q = (await searchParams).q?.trim();
  const online = new Date(Date.now() - 15 * 60_000);
  const [orgs, empCounts, devTotals, devOnline, unclaimed, logs, punches24h, totals] = await Promise.all([
    prisma.organization.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.employee.groupBy({ by: ["organizationId"], where: { active: true }, _count: true }),
    prisma.device.groupBy({ by: ["organizationId"], where: { organizationId: { not: null }, status: "ACTIVE" }, _count: true }),
    prisma.device.groupBy({ by: ["organizationId"], where: { organizationId: { not: null }, status: "ACTIVE", lastSeenAt: { gt: online } }, _count: true }),
    prisma.device.findMany({ where: { organizationId: null }, orderBy: { lastSeenAt: "desc" }, take: 50 }),
    prisma.ingestLog.findMany({ where: { level: { in: ["warn", "error"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.punch.count({ where: { createdAt: { gt: new Date(Date.now() - 86400_000) } } }),
    Promise.all([prisma.organization.count(), prisma.employee.count({ where: { active: true } }), prisma.device.count({ where: { status: "ACTIVE", organizationId: { not: null } } })]),
  ]);
  const subs = new Map((await prisma.subscription.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } })).map((s) => [s.organizationId, s]));
  const count = (rows: { organizationId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.organizationId, r._count]));
  const [emps, devs, devsOn] = [count(empCounts), count(devTotals), count(devOnline)];
  const onlineTotal = devOnline.reduce((s, r) => s + r._count, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-violet-800">Platform admin</h1>
        <div className="flex items-center gap-4 text-sm"><Link href="/select-org" className="text-blue-600 hover:underline">My organizations</Link><div className="w-24"><SignOutButton /></div></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Organizations" value={totals[0]} icon={Building2} />
        <Stat label="Active employees" value={totals[1]} />
        <Stat label="Devices" value={totals[2]} icon={ScanLine} />
        <Stat label="Online now" value={onlineTotal} tone={onlineTotal < totals[2] ? "amber" : "green"} icon={Wifi} />
        <Stat label="Punches (24h)" value={punches24h} tone="blue" icon={Fingerprint} />
      </div>

      <Card title="Organizations">
        <FilterBar><Input name="q" placeholder="Search by name" defaultValue={q} /></FilterBar>
        <Table head={["Organization", "Created", "Employees", "Devices online", "Subscription", ""]}>
          {orgs.map((o) => {
            const s = subs.get(o.id);
            return (
              <tr key={o.id}>
                <td className="font-medium">{o.name}<div className="text-xs text-slate-400">{o.slug}</div></td>
                <td className="text-xs">{o.createdAt.toLocaleDateString()}</td>
                <td>{emps.get(o.id) ?? 0} <span className="text-xs text-slate-400">/ {s?.maxEmployees ?? "-"}</span></td>
                <td>{devsOn.get(o.id) ?? 0} / {devs.get(o.id) ?? 0}</td>
                <td>
                  <form action={setPlan} className="flex flex-wrap items-center gap-1">
                    <input type="hidden" name="orgId" value={o.id} />
                    <Select name="plan" defaultValue={s?.plan ?? "FREE"} className="w-auto py-1 text-xs" aria-label="Plan">
                      {Object.keys(PLANS).map((p) => <option key={p}>{p}</option>)}
                    </Select>
                    <Select name="status" defaultValue={s?.status ?? "ACTIVE"} className="w-auto py-1 text-xs" aria-label="Status">
                      {["ACTIVE", "PAST_DUE", "SUSPENDED"].map((x) => <option key={x}>{x}</option>)}
                    </Select>
                    <Input name="maxEmployees" type="number" placeholder="Emp limit" className="w-24 py-1 text-xs" aria-label="Employee limit" />
                    <Button variant="secondary" className="py-1 text-xs">Save</Button>
                  </form>
                  {s && <Badge>{s.status}</Badge>}
                </td>
                <td>
                  <form action={enterOrg}><input type="hidden" name="orgId" value={o.id} /><Button variant="ghost" className="text-xs text-violet-700">Enter →</Button></form>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Unclaimed terminals">
          <p className="mb-2 text-xs text-slate-500">Terminals that contacted the server but no organization has added their serial yet.</p>
          <Table head={["Serial", "Type", "IP", "Last seen", ""]} empty="None.">
            {unclaimed.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{d.serial}</td>
                <td className="text-xs">{VENDOR_LABEL[d.vendor]}</td>
                <td className="text-xs">{d.ip}</td>
                <td className="text-xs">{d.lastSeenAt?.toLocaleString()}</td>
                <td><form action={deleteUnclaimed}><input type="hidden" name="id" value={d.id} /><ConfirmButton className="text-xs text-red-600 hover:underline">Remove</ConfirmButton></form></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Ingest warnings">
          <ul className="max-h-96 space-y-1 overflow-y-auto text-xs">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="shrink-0 text-slate-400">{l.createdAt.toLocaleString()}</span>
                <Badge tone={l.level === "error" ? "FAILED" : "PENDING"}>{l.source}</Badge>
                <span className="break-all">{l.message}</span>
              </li>
            ))}
            {!logs.length && <li className="text-slate-400">No warnings.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
