import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/client";
import { Badge, Button, Card, Field, Input, LinkButton, PageHeader, Select, Table } from "@/components/ui";
import { prisma } from "@/lib/db";
import { FINGERS } from "@/lib/device-meta";
import { HR, requireRole, ROLES } from "@/lib/session";
import { fmtDuration, fromDbDate, localTime } from "@/lib/time";
import { deleteBiometrics, grantAccess, recordConsent, revokeAccess, setActive, syncToDevices, updateEmployee } from "../actions";
import { EmployeeFields } from "../fields";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireRole(HR);
  const e = await ctx.db.employee.findFirst({ where: { id }, include: { branch: true, user: true } });
  if (!e) notFound();
  const [branches, departments, designations, shifts, managers, templates, consent, days, member, settings] = await Promise.all([
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ orderBy: { name: "asc" } }),
    ctx.db.designation.findMany({ orderBy: { name: "asc" } }),
    ctx.db.shift.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.biometricTemplate.findMany({ where: { employeeId: id }, select: { id: true, finger: true, format: true, createdAt: true } }),
    ctx.db.consent.findFirst({ where: { employeeId: id, revokedAt: null }, orderBy: { givenAt: "desc" } }),
    ctx.db.attendanceDay.findMany({ where: { employeeId: id }, orderBy: { date: "desc" }, take: 14 }),
    e.userId ? prisma.member.findFirst({ where: { organizationId: ctx.orgId, userId: e.userId } }) : null,
    ctx.db.orgSettings.findFirst(),
  ]);
  const tz = e.branch?.timezone ?? settings?.timezone ?? "UTC";
  const hidden = <input type="hidden" name="id" value={e.id} />;

  return (
    <>
      <PageHeader
        title={e.name}
        description={`Code ${e.code}${e.active ? "" : " · inactive"}`}
        actions={<LinkButton href={`/reports?kind=daily&employee=${e.id}`}>Attendance report</LinkButton>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Profile">
            <form action={updateEmployee} className="space-y-3">
              {hidden}
              <EmployeeFields e={e} branches={branches} departments={departments} designations={designations} shifts={shifts} managers={managers} />
              <Button>Save changes</Button>
            </form>
          </Card>
          <Card title="Recent attendance">
            <Table head={["Date", "Status", "In", "Out", "Worked", "Late", "OT"]}>
              {days.map((d) => (
                <tr key={d.id}>
                  <td>{fromDbDate(d.date)}</td>
                  <td><Badge>{d.status}</Badge>{d.missingPunch && <span className="ml-1 text-xs text-amber-700">missing punch</span>}</td>
                  <td>{localTime(d.firstIn, tz)}</td>
                  <td>{localTime(d.lastOut, tz)}</td>
                  <td>{fmtDuration(d.workedMinutes)}</td>
                  <td>{d.lateMinutes || ""}</td>
                  <td>{fmtDuration(d.otMinutes)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="App access">
            {member ? (
              <p className="mb-3 text-sm">Login <b>{e.user?.email}</b> with role <Badge>{member.role}</Badge></p>
            ) : (
              <p className="mb-3 text-sm text-slate-500">No login yet. Granting access emails a set-password link{e.email ? ` to ${e.email}` : " (add an email first)"}.</p>
            )}
            <form action={grantAccess} className="flex gap-2">
              {hidden}
              <Select name="role" defaultValue={member?.role ?? "employee"}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
              <Button disabled={!e.email}>{member ? "Change role" : "Grant access"}</Button>
            </form>
            {member && (
              <form action={revokeAccess} className="mt-2">{hidden}<ConfirmButton message="Remove this person's access to the app?" className="text-sm text-red-600 hover:underline">Revoke access</ConfirmButton></form>
            )}
          </Card>

          <Card title="Biometrics">
            {consent ? (
              <p className="text-sm">Consent signed by <b>{consent.signedName}</b> on {consent.givenAt.toLocaleDateString()}.</p>
            ) : (
              <form action={recordConsent} className="space-y-2">
                <input type="hidden" name="employeeId" value={e.id} />
                <p className="text-sm text-slate-600">Record the employee&apos;s written consent before enrolling fingerprints.</p>
                <Field label="Employee's full name as signature"><Input name="signedName" required /></Field>
                <Button variant="secondary">Record consent</Button>
              </form>
            )}
            <ul className="mt-3 space-y-1 text-sm">
              {templates.map((t) => (
                <li key={t.id} className="flex justify-between"><span>{FINGERS[t.finger] ?? `Finger ${t.finger}`}</span><span className="text-xs text-slate-500">{t.format}</span></li>
              ))}
              {!templates.length && <li className="text-slate-400">No fingerprints stored.</li>}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton href={`/enroll?employee=${e.id}`}>Manage fingerprints</LinkButton>
              <form action={syncToDevices}>{hidden}<Button variant="secondary">Push to terminals</Button></form>
              {(templates.length > 0 || consent) && (
                <form action={deleteBiometrics}>
                  <input type="hidden" name="employeeId" value={e.id} />
                  <ConfirmButton message="Delete all stored fingerprints, revoke consent, and remove fingers from terminals?">Erase biometrics</ConfirmButton>
                </form>
              )}
            </div>
          </Card>

          <Card title="Status">
            <form action={setActive}>
              {hidden}
              <input type="hidden" name="active" value={String(!e.active)} />
              {e.active ? (
                <ConfirmButton message="Deactivate this employee? They will be removed from terminals.">Deactivate employee</ConfirmButton>
              ) : (
                <Button>Reactivate employee</Button>
              )}
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
