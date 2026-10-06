import Link from "next/link";
import { Card, FilterBar, Input, PageHeader, Table } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Audit log" };
const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; page?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const q = await searchParams;
  const pageNo = Math.max(0, Number(q.page) || 0);
  const rows = await ctx.db.auditLog.findMany({
    where: {
      ...(q.action ? { action: { contains: q.action, mode: "insensitive" } } : {}),
      ...(q.entity ? { entity: { equals: q.entity, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: pageNo * PAGE,
    take: PAGE + 1,
  });
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
  );
  const link = (p: number) => `?${new URLSearchParams({ ...(q.action ? { action: q.action } : {}), ...(q.entity ? { entity: q.entity } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Every change, export, consent and platform-admin visit." />
      <FilterBar>
        <Input name="action" placeholder="Action contains…" defaultValue={q.action} />
        <Input name="entity" placeholder="Entity (e.g. Employee)" defaultValue={q.entity} />
      </FilterBar>
      <Card>
        <Table head={["When", "Who", "Action", "Entity", "Details"]} empty="No audit entries.">
          {rows.slice(0, PAGE).map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap text-xs">{r.createdAt.toLocaleString()}</td>
              <td className="text-xs">{r.userId ? users.get(r.userId)?.email ?? r.userId : "system"}</td>
              <td className="font-medium">{r.action}</td>
              <td className="text-xs">{r.entity}{r.entityId && <span className="text-slate-400"> {r.entityId.slice(-8)}</span>}</td>
              <td><code className="block max-w-md truncate text-xs text-slate-500" title={r.data ? JSON.stringify(r.data) : ""}>{r.data ? JSON.stringify(r.data) : ""}</code></td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex justify-between text-sm">
          {pageNo > 0 ? <Link className="text-blue-600" href={link(pageNo - 1)}>← Newer</Link> : <span />}
          {rows.length > PAGE && <Link className="text-blue-600" href={link(pageNo + 1)}>Older →</Link>}
        </div>
      </Card>
    </>
  );
}
