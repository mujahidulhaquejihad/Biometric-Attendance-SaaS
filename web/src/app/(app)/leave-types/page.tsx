import type { LeaveType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { leaveBalances } from "@/lib/leave";
import { assertRole, HR, requireRole } from "@/lib/session";

export const metadata = { title: "Leave types" };

async function saveType(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({
    id: z.string().optional(), name: z.string().trim().min(1).max(60), code: z.string().trim().min(1).max(10).toUpperCase(),
    annualQuota: z.coerce.number().min(0).max(366), accrual: z.enum(["YEARLY", "MONTHLY"]), carryForwardMax: z.coerce.number().min(0).max(366),
  }).parse(Object.fromEntries([...fd].filter(([, v]) => v !== "")));
  const { id, ...rest } = p;
  const data = { ...rest, paid: fd.get("paid") === "on", active: fd.get("active") === "on" };
  const t = id ? await ctx.db.leaveType.update({ where: { id }, data }) : await ctx.db.leaveType.create({ data });
  await audit(ctx, id ? "update" : "create", "LeaveType", t.id, data);
  revalidatePath("/leave-types");
}

async function adjust(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({ employeeId: z.string(), leaveTypeId: z.string(), year: z.coerce.number().int(), adjustment: z.coerce.number().min(-366).max(366), note: z.string().max(200).optional() }).parse(Object.fromEntries(fd));
  await ctx.db.employee.findFirstOrThrow({ where: { id: p.employeeId } });
  const where = { employeeId_leaveTypeId_year: { employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, year: p.year } };
  await ctx.db.leaveBalance.upsert({ where, create: { employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, year: p.year, adjustment: p.adjustment, note: p.note }, update: { adjustment: { increment: p.adjustment }, note: p.note } });
  await audit(ctx, "adjust_balance", "LeaveBalance", null, p);
  revalidatePath("/leave-types");
}

/** Move unused balance (up to each type's cap) from `year` into next year's adjustment. */
async function carryForward(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const year = z.coerce.number().int().parse(fd.get("year"));
  const emps = await ctx.db.employee.findMany({ where: { active: true }, select: { id: true } });
  let moved = 0;
  for (const e of emps) {
    for (const b of await leaveBalances(ctx.db, e.id, year, new Date(Date.UTC(year, 11, 31)))) {
      const carry = Math.min(Math.max(b.available, 0), b.type.carryForwardMax);
      if (carry <= 0) continue;
      const where = { employeeId_leaveTypeId_year: { employeeId: e.id, leaveTypeId: b.type.id, year: year + 1 } };
      const note = `Carried forward from ${year}`;
      const existing = await ctx.db.leaveBalance.findFirst({ where: { employeeId: e.id, leaveTypeId: b.type.id, year: year + 1, note } });
      if (existing) continue; // already carried
      await ctx.db.leaveBalance.upsert({ where, create: { employeeId: e.id, leaveTypeId: b.type.id, year: year + 1, adjustment: carry, note }, update: { adjustment: { increment: carry }, note } });
      moved++;
    }
  }
  await audit(ctx, "carry_forward", "LeaveBalance", null, { year, moved });
  revalidatePath("/leave-types");
}

export default async function LeaveTypes() {
  const ctx = await requireRole(HR);
  const [types, employees] = await Promise.all([
    ctx.db.leaveType.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const year = new Date().getUTCFullYear();
  return (
    <>
      <PageHeader title="Leave types" description="Quotas, monthly accrual, and carry-forward caps." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Table head={["Type", "Quota / year", "Accrual", "Carry max", "Paid", "Active"]}>
            {types.map((t) => (
              <tr key={t.id}>
                <td colSpan={6}>
                  <details>
                    <summary className="flex cursor-pointer justify-between">
                      <span className="font-medium">{t.name} <span className="text-xs text-slate-400">{t.code}</span></span>
                      <span className="text-xs text-slate-500">{t.annualQuota} days · {t.accrual.toLowerCase()} · carry {t.carryForwardMax} · {t.paid ? "paid" : "unpaid"}{t.active ? "" : " · inactive"}</span>
                    </summary>
                    <form action={saveType} className="mt-3"><input type="hidden" name="id" value={t.id} /><TypeFields t={t} /><Button variant="secondary" className="mt-2">Save</Button></form>
                  </details>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="New leave type"><form action={saveType}><TypeFields /><Button className="mt-3 w-full">Create</Button></form></Card>
          <Card title="Adjust a balance">
            <form action={adjust} className="space-y-3">
              <Field label="Employee"><Select name="employeeId">{employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}</Select></Field>
              <Field label="Leave type"><Select name="leaveTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Year"><Input name="year" type="number" defaultValue={year} /></Field>
                <Field label="Days (+/-)"><Input name="adjustment" type="number" step="0.5" required /></Field>
              </div>
              <Field label="Note"><Input name="note" /></Field>
              <Button variant="secondary" className="w-full">Apply adjustment</Button>
            </form>
          </Card>
          <Card title="Year-end">
            <form action={carryForward}>
              <input type="hidden" name="year" value={year - 1} />
              <p className="mb-3 text-sm text-slate-600">Carry unused {year - 1} balances into {year}, up to each type&apos;s cap. Safe to run twice.</p>
              <Button variant="secondary">Carry forward {year - 1} → {year}</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function TypeFields({ t }: { t?: LeaveType }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Name"><Input name="name" defaultValue={t?.name} required /></Field>
      <Field label="Code"><Input name="code" defaultValue={t?.code} required /></Field>
      <Field label="Days per year"><Input name="annualQuota" type="number" step="0.5" defaultValue={t?.annualQuota ?? 0} /></Field>
      <Field label="Accrual"><Select name="accrual" defaultValue={t?.accrual ?? "YEARLY"}><option value="YEARLY">All at start of year</option><option value="MONTHLY">Monthly</option></Select></Field>
      <Field label="Carry forward max"><Input name="carryForwardMax" type="number" step="0.5" defaultValue={t?.carryForwardMax ?? 0} /></Field>
      <div className="flex flex-col justify-end gap-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="paid" defaultChecked={t?.paid ?? true} /> Paid</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Active</label>
      </div>
    </div>
  );
}
