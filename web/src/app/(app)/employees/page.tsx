import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Badge, Button, Card, Field, FilterBar, Input, LinkButton, PageHeader, Select, Table } from "@/components/ui";
import { HR, requireRole } from "@/lib/session";
import { createEmployee } from "./actions";
import { EmployeeFields } from "./fields";

export const metadata = { title: "Employees" };
const PAGE = 100;

export default async function Employees({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireRole(HR);
  const q = await searchParams;
  const page = Math.max(1, Number(q.page ?? 1));
  const where: Prisma.EmployeeWhereInput = {
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { code: { contains: q.q } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}),
    ...(q.branch ? { branchId: q.branch } : {}),
    ...(q.dept ? { departmentId: q.dept } : {}),
    active: q.status === "inactive" ? false : q.status === "all" ? undefined : true,
  };
  const [employees, total, branches, departments, designations, shifts, managers, members] = await Promise.all([
    ctx.db.employee.findMany({
      where, include: { branch: true, department: true, defaultShift: true, manager: true, _count: { select: { templates: true } } },
      orderBy: { name: "asc" }, take: PAGE, skip: (page - 1) * PAGE,
    }),
    ctx.db.employee.count({ where }),
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ orderBy: { name: "asc" } }),
    ctx.db.designation.findMany({ orderBy: { name: "asc" } }),
    ctx.db.shift.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { userId: { not: null } }, select: { id: true, user: { select: { members: { where: { organizationId: ctx.orgId }, select: { role: true } } } } } }),
  ]);
  const roleOf = new Map(members.map((m) => [m.id, m.user?.members[0]?.role]));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Employees" description={`${total} employee(s)`} actions={<LinkButton href="/api/reports/employees?format=csv">Export CSV</LinkButton>} />
      <FilterBar>
        <Input name="q" placeholder="Search name, code, email" defaultValue={q.q} />
        <Select name="branch" defaultValue={q.branch ?? ""}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Select name="dept" defaultValue={q.dept ?? ""}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select name="status" defaultValue={q.status ?? ""}><option value="">Active</option><option value="inactive">Inactive</option><option value="all">All</option></Select>
      </FilterBar>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Table head={["Code", "Name", "Department", "Branch", "Shift", "Manager", "Access", "Fingers"]}>
            {employees.map((e) => (
              <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                <td className="font-mono text-xs">{e.code}</td>
                <td><Link href={`/employees/${e.id}`} className="font-medium text-blue-700 hover:underline">{e.name}</Link></td>
                <td>{e.department?.name}</td>
                <td>{e.branch?.name}</td>
                <td className="text-xs">{e.defaultShift?.name}</td>
                <td className="text-xs">{e.manager?.name}</td>
                <td>{roleOf.get(e.id) ? <Badge>{roleOf.get(e.id)}</Badge> : <span className="text-xs text-slate-400">none</span>}</td>
                <td>{e._count.templates}</td>
              </tr>
            ))}
          </Table>
          {total > PAGE && (
            <div className="mt-4 flex justify-between text-sm">
              {page > 1 ? <Link href={qs(page - 1)} className="text-blue-600">Previous</Link> : <span />}
              <span className="text-slate-500">Page {page} of {Math.ceil(total / PAGE)}</span>
              {page * PAGE < total ? <Link href={qs(page + 1)} className="text-blue-600">Next</Link> : <span />}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Add employee">
            <form action={createEmployee} className="space-y-3">
              <EmployeeFields branches={branches} departments={departments} designations={designations} shifts={shifts} managers={managers} />
              <Button className="w-full">Add employee</Button>
            </form>
          </Card>
          <Card title="Bulk import">
            <p className="mb-3 text-xs text-slate-500">Import employees, past attendance, leave balances and holidays from Excel/CSV or your previous attendance software.</p>
            <LinkButton href="/import" className="w-full">Open data migration</LinkButton>
          </Card>
        </div>
      </div>
    </>
  );
}
