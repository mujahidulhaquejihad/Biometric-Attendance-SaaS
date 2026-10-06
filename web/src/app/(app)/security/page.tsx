import { IdCard } from "lucide-react";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LiveFeed, PrintButton, type LiveEvent } from "@/components/client";
import { Button, Card, Field, Input, PageHeader, Select, Stat, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertRole, requireRole, type Role } from "@/lib/session";
import { localDate, localTime, zonedToUtc } from "@/lib/time";

export const metadata = { title: "Security desk" };
const DESK: Role[] = ["admin", "hr", "security"];
const opt = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional());

async function checkIn(fd: FormData) {
  "use server";
  const ctx = await assertRole(DESK);
  const p = z.object({ name: z.string().trim().min(1).max(100), phone: opt, company: opt, purpose: opt, badge: opt, hostId: opt }).parse(Object.fromEntries(fd));
  const host = p.hostId ? await ctx.db.employee.findFirstOrThrow({ where: { id: p.hostId } }) : null;
  const v = await ctx.db.visitor.create({ data: { ...p, hostId: host?.id ?? null } });
  await audit(ctx, "visitor_in", "Visitor", v.id, { name: p.name });
  if (host?.userId) await notify(ctx.orgId, [host.userId], `Visitor at reception: ${p.name}`, [p.company, p.purpose].filter(Boolean).join(" · ") || undefined);
  revalidatePath("/security");
}

async function checkOut(fd: FormData) {
  "use server";
  const ctx = await assertRole(DESK);
  const id = String(fd.get("id"));
  await ctx.db.visitor.updateMany({ where: { id, checkOut: null }, data: { checkOut: new Date() } });
  await audit(ctx, "visitor_out", "Visitor", id);
  revalidatePath("/security");
}

export default async function Security() {
  const ctx = await requireRole(DESK);
  const tz = (await ctx.db.orgSettings.findFirst())?.timezone ?? "UTC";
  const since = zonedToUtc(localDate(new Date(), tz), "00:00", tz);
  const [punches, visitors, hosts, total] = await Promise.all([
    ctx.db.punch.findMany({ where: { timestamp: { gte: since } }, include: { employee: { include: { department: true } }, device: true }, orderBy: { timestamp: "asc" } }),
    ctx.db.visitor.findMany({ where: { OR: [{ checkOut: null }, { checkIn: { gte: since } }] }, include: { host: true }, orderBy: { checkIn: "desc" } }),
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.employee.count({ where: { active: true } }),
  ]);

  // ponytail: "inside" = last punch today is IN, or an odd number of punches when terminals don't send direction.
  // Night-shift staff who arrived yesterday are missed; widen the window if that matters.
  const byEmp = Map.groupBy(punches.filter((p) => p.employee), (p) => p.employeeId!);
  const inside = [...byEmp.values()]
    .filter((list) => {
      const last = list[list.length - 1];
      return last.direction ? last.direction === "IN" : list.length % 2 === 1;
    })
    .map((list) => ({ e: list[0].employee!, since: list[list.length - 1].timestamp }))
    .sort((a, b) => a.e.name.localeCompare(b.e.name));
  const visitorsIn = visitors.filter((v) => !v.checkOut);
  const initial: LiveEvent[] = punches.slice(-30).reverse().map((p) => ({
    orgId: ctx.orgId, type: "punch", employeeName: p.employee?.name ?? null, employeeCode: p.employeeCode, deviceId: p.deviceId,
    deviceName: p.device?.name ?? null, timestamp: p.timestamp.toISOString(), direction: p.direction, verifyMode: p.verifyMode,
  }));

  return (
    <>
      <PageHeader title="Security desk" description={`Muster roll as of ${localTime(new Date(), tz)}`} actions={<PrintButton label="Print evacuation list" />} />
      <div className="no-print mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Employees inside" value={inside.length} tone="green" />
        <Stat label="Visitors inside" value={visitorsIn.length} tone="violet" icon={IdCard} />
        <Stat label="Not in building" value={total - inside.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`In the building (${inside.length + visitorsIn.length})`}>
            <Table head={["Name", "Type", "Department / host", "Since", "Accounted for"]} empty="Nobody is checked in.">
              {inside.map(({ e, since }) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name} <span className="text-xs text-slate-400">{e.code}</span></td>
                  <td>Employee</td>
                  <td className="text-xs">{e.department?.name}</td>
                  <td>{localTime(since, tz)}</td>
                  <td><span className="inline-block h-4 w-4 border border-slate-400" /></td>
                </tr>
              ))}
              {visitorsIn.map((v) => (
                <tr key={v.id}>
                  <td className="font-medium">{v.name} {v.badge && <span className="text-xs text-slate-400">badge {v.badge}</span>}</td>
                  <td>Visitor</td>
                  <td className="text-xs">{v.host ? `Host: ${v.host.name}` : v.company}</td>
                  <td>{localTime(v.checkIn, tz)}</td>
                  <td><span className="inline-block h-4 w-4 border border-slate-400" /></td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Visitors today" className="no-print">
            <Table head={["Name", "Company", "Purpose", "Host", "In", "Out", ""]} empty="No visitors today.">
              {visitors.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}<div className="text-xs text-slate-400">{v.phone}</div></td>
                  <td className="text-xs">{v.company}</td>
                  <td className="text-xs">{v.purpose}</td>
                  <td className="text-xs">{v.host?.name}</td>
                  <td>{localTime(v.checkIn, tz)}</td>
                  <td>{localTime(v.checkOut, tz)}</td>
                  <td>{!v.checkOut && <form action={checkOut}><input type="hidden" name="id" value={v.id} /><Button variant="secondary" className="py-1 text-xs">Check out</Button></form>}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="no-print space-y-6">
          <Card title="Visitor check-in">
            <form action={checkIn} className="space-y-3">
              <Field label="Name"><Input name="name" required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Phone"><Input name="phone" type="tel" /></Field>
                <Field label="Badge no."><Input name="badge" /></Field>
              </div>
              <Field label="Company"><Input name="company" /></Field>
              <Field label="Purpose"><Input name="purpose" /></Field>
              <Field label="Host" hint="The host is notified in the app">
                <Select name="hostId" defaultValue=""><option value="">None</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select>
              </Field>
              <Button className="w-full">Check in</Button>
            </form>
          </Card>
          <Card title="Live entrances"><LiveFeed initial={initial} photos /></Card>
        </div>
      </div>
    </>
  );
}
