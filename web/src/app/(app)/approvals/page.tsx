import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Badge, Card, Input, PageHeader, Table } from "@/components/ui";
import { decideRequest } from "@/lib/requests";
import { APPROVERS, HR, requireRole } from "@/lib/session";
import { fromDbDate } from "@/lib/time";

export const metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireRole(APPROVERS);
  const history = (await searchParams).tab === "history";
  // Managers see their direct reports; HR sees everyone.
  const scope: Prisma.EmployeeWhereInput = HR.includes(ctx.role) ? {} : { managerId: ctx.employee?.id ?? "__none__" };
  const status = history ? { not: "PENDING" as const } : "PENDING" as const;
  const order = { createdAt: history ? ("desc" as const) : ("asc" as const) };

  const [leaves, regs, ots, cos] = await Promise.all([
    ctx.db.leaveRequest.findMany({ where: { status, employee: scope }, include: { employee: true, leaveType: true }, orderBy: order, take: 100 }),
    ctx.db.regularization.findMany({ where: { status, employee: scope }, include: { employee: true }, orderBy: order, take: 100 }),
    ctx.db.overtimeRequest.findMany({ where: { status, employee: scope }, include: { employee: true }, orderBy: order, take: 100 }),
    ctx.db.compOffRequest.findMany({ where: { status, employee: scope }, include: { employee: true }, orderBy: order, take: 100 }),
  ]);

  const decide = (kind: string, id: string, status: string) =>
    status !== "PENDING" ? <Badge>{status}</Badge> : (
      <form action={decideRequest} className="flex items-center gap-1">
        <input type="hidden" name="kind" value={kind} />
        {/* Not name="id": it would shadow form.id and React then drops the clicked button's value. */}
        <input type="hidden" name="requestId" value={id} />
        <Input name="note" placeholder="Note (optional)" className="w-36 py-1 text-xs" />
        <button name="decision" value="approve" className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700">Approve</button>
        <button name="decision" value="reject" className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">Reject</button>
      </form>
    );
  const who = (e: { id: string; name: string; code: string }) => (
    HR.includes(ctx.role) ? <Link className="font-medium hover:underline" href={`/employees/${e.id}`}>{e.name}</Link> : <span className="font-medium">{e.name}</span>
  );

  return (
    <>
      <PageHeader
        title="Approvals"
        description={history ? "Recently decided requests" : `${leaves.length + regs.length + ots.length + cos.length} pending`}
        actions={<Link className="text-sm text-blue-600" href={history ? "/approvals" : "?tab=history"}>{history ? "Show pending" : "Show history"}</Link>}
      />
      <div className="space-y-6">
        <Card title={`Leave (${leaves.length})`}>
          <Table head={["Employee", "Type", "From", "To", "Days", "Reason", ""]} empty="No leave requests.">
            {leaves.map((l) => (
              <tr key={l.id}>
                <td>{who(l.employee)}</td><td>{l.leaveType.name}</td><td>{fromDbDate(l.fromDate)}</td><td>{fromDbDate(l.toDate)}</td>
                <td>{l.days}</td><td className="max-w-xs text-xs">{l.reason}</td><td>{decide("leave", l.id, l.status)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Attendance corrections (${regs.length})`}>
          <Table head={["Employee", "Date", "In", "Out", "Reason", ""]} empty="No corrections.">
            {regs.map((r) => (
              <tr key={r.id}>
                <td>{who(r.employee)}</td><td>{fromDbDate(r.date)}</td><td>{r.inTime}</td><td>{r.outTime}</td>
                <td className="max-w-xs text-xs">{r.reason}</td><td>{decide("regularization", r.id, r.status)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Overtime (${ots.length})`}>
          <Table head={["Employee", "Date", "Minutes", "Reason", ""]} empty="No overtime claims.">
            {ots.map((o) => (
              <tr key={o.id}>
                <td>{who(o.employee)}</td><td>{fromDbDate(o.date)}</td><td>{o.minutes}</td>
                <td className="max-w-xs text-xs">{o.reason}</td><td>{decide("overtime", o.id, o.status)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Comp-off (${cos.length})`}>
          <Table head={["Employee", "Worked on", "Days earned", "Reason", ""]} empty="No comp-off claims.">
            {cos.map((c) => (
              <tr key={c.id}>
                <td>{who(c.employee)}</td><td>{fromDbDate(c.date)}</td><td>{c.days}</td>
                <td className="max-w-xs text-xs">{c.reason}</td><td>{decide("compoff", c.id, c.status)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
