import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { leaveBalances } from "@/lib/leave";
import { cancelRequest, submitCompOff, submitLeave, submitOvertime, submitRegularization } from "@/lib/requests";
import { getCtx } from "@/lib/session";
import { fromDbDate } from "@/lib/time";

export const metadata = { title: "My requests" };

export default async function MyRequests() {
  const ctx = await getCtx();
  const emp = ctx.employee;
  if (!emp) return <Card title="No employee record">Your login is not linked to an employee record yet.</Card>;
  const [balances, leaves, regs, ots, cos] = await Promise.all([
    leaveBalances(ctx.db, emp.id, new Date().getUTCFullYear()),
    ctx.db.leaveRequest.findMany({ where: { employeeId: emp.id }, include: { leaveType: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    ctx.db.regularization.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    ctx.db.overtimeRequest.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    ctx.db.compOffRequest.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const cancel = (kind: string, id: string) => (
    <form action={cancelRequest}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-red-600 hover:underline">Cancel</button>
    </form>
  );

  return (
    <>
      <PageHeader title="My requests" description="Leave, attendance corrections, overtime and comp-off." />
      <div className="mb-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Apply for leave">
          <form action={submitLeave} className="space-y-3">
            <Field label="Leave type">
              <Select name="leaveTypeId" required>
                {balances.map((b) => <option key={b.type.id} value={b.type.id}>{b.type.name} ({b.available} available)</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><Input type="date" name="fromDate" required /></Field>
              <Field label="To"><Input type="date" name="toDate" required /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="halfDay" /> Half day</label>
            <Field label="Reason"><Textarea name="reason" rows={2} /></Field>
            <Button className="w-full">Submit leave request</Button>
          </form>
        </Card>
        <Card title="Correct attendance">
          <form action={submitRegularization} className="space-y-3">
            <p className="text-xs text-slate-500">Forgot to punch, or the device was down? Enter the actual times.</p>
            <Field label="Date"><Input type="date" name="date" required /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="In time"><Input type="time" name="inTime" /></Field>
              <Field label="Out time"><Input type="time" name="outTime" /></Field>
            </div>
            <Field label="Reason"><Textarea name="reason" rows={2} required minLength={3} /></Field>
            <Button className="w-full">Submit correction</Button>
          </form>
        </Card>
        <Card title="Claim overtime">
          <form action={submitOvertime} className="space-y-3">
            <Field label="Date"><Input type="date" name="date" required /></Field>
            <Field label="Minutes"><Input type="number" name="minutes" min={15} max={960} step={15} required /></Field>
            <Field label="Reason"><Textarea name="reason" rows={2} /></Field>
            <Button className="w-full">Submit overtime</Button>
          </form>
        </Card>
        <Card title="Claim comp-off">
          <form action={submitCompOff} className="space-y-3">
            <p className="text-xs text-slate-500">Worked on a holiday or your weekly off? Once approved, it adds a day (or half) of Comp-off leave you can apply for later.</p>
            <Field label="Date worked"><Input type="date" name="date" required /></Field>
            <Field label="Reason"><Textarea name="reason" rows={2} /></Field>
            <Button className="w-full">Submit comp-off claim</Button>
          </form>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Leave requests">
          <Table head={["Type", "From", "To", "Days", "Status", "Note", ""]}>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td>{l.leaveType.name}</td><td>{fromDbDate(l.fromDate)}</td><td>{fromDbDate(l.toDate)}</td><td>{l.days}</td>
                <td><Badge>{l.status}</Badge></td><td className="text-xs">{l.decisionNote}</td>
                <td>{l.status === "PENDING" && cancel("leave", l.id)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Corrections">
            <Table head={["Date", "In", "Out", "Status", ""]}>
              {regs.map((r) => (
                <tr key={r.id}><td>{fromDbDate(r.date)}</td><td>{r.inTime}</td><td>{r.outTime}</td><td><Badge>{r.status}</Badge></td><td>{r.status === "PENDING" && cancel("regularization", r.id)}</td></tr>
              ))}
            </Table>
          </Card>
          <Card title="Overtime">
            <Table head={["Date", "Minutes", "Status", ""]}>
              {ots.map((o) => (
                <tr key={o.id}><td>{fromDbDate(o.date)}</td><td>{o.minutes}</td><td><Badge>{o.status}</Badge></td><td>{o.status === "PENDING" && cancel("overtime", o.id)}</td></tr>
              ))}
            </Table>
          </Card>
          <Card title="Comp-off">
            <Table head={["Worked on", "Days", "Status", "Note", ""]}>
              {cos.map((c) => (
                <tr key={c.id}><td>{fromDbDate(c.date)}</td><td>{c.days}</td><td><Badge>{c.status}</Badge></td><td className="text-xs">{c.decisionNote}</td><td>{c.status === "PENDING" && cancel("compoff", c.id)}</td></tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
