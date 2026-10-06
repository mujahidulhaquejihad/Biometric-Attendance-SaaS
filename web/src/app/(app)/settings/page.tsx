import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { PAYROLL_FIELDS } from "@/lib/reports-meta";
import { assertRole, requireRole } from "@/lib/session";

export const metadata = { title: "Settings" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function save(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const p = z.object({
    name: z.string().trim().min(2).max(100),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone"),
    missingPunchStatus: z.enum(["PRESENT", "HALF_DAY", "ABSENT"]),
    dedupeMinutes: z.coerce.number().int().min(0).max(60),
    digestHour: z.coerce.number().int().min(0).max(23),
    payrollColumns: z.string().optional(),
  }).parse(Object.fromEntries(fd));

  let payrollColumns: Record<string, string> | undefined;
  if (p.payrollColumns?.trim()) {
    const parsed = z.record(z.string(), z.enum(Object.keys(PAYROLL_FIELDS) as [string, ...string[]])).safeParse(JSON.parse(p.payrollColumns));
    if (!parsed.success) throw new Error(`Payroll mapping values must be one of: ${Object.keys(PAYROLL_FIELDS).join(", ")}`);
    payrollColumns = parsed.data;
  }
  await prisma.organization.update({ where: { id: ctx.orgId }, data: { name: p.name } });
  const data = {
    timezone: p.timezone,
    missingPunchStatus: p.missingPunchStatus,
    dedupeMinutes: p.dedupeMinutes,
    digestHour: p.digestHour,
    weekOffs: fd.getAll("weekOffs").map(Number),
    autoDeductBreak: fd.get("autoDeductBreak") === "on",
    otRequiresApproval: fd.get("otRequiresApproval") === "on",
    notifyLate: fd.get("notifyLate") === "on",
    webPunch: fd.get("webPunch") === "on",
    payrollColumns: payrollColumns ?? Prisma.DbNull,
  };
  await ctx.db.orgSettings.upsert({ where: { organizationId: ctx.orgId }, create: data, update: data });
  await audit(ctx, "update", "OrgSettings", null, { ...data, payrollColumns: payrollColumns ?? null, name: p.name });
  revalidatePath("/settings");
}

export default async function Settings() {
  const ctx = await requireRole(["admin"]);
  const [s, sub] = await Promise.all([ctx.db.orgSettings.findFirst(), ctx.db.subscription.findFirst()]);
  const check = (name: string, label: string, on?: boolean) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} /> {label}</label>
  );
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      {sub && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          Plan <b>{sub.plan}</b> · up to {sub.maxEmployees} employees and {sub.maxDevices} devices · status {sub.status}
        </div>
      )}
      <form action={save} className="space-y-6">
        <Card title="Organization">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input name="name" defaultValue={ctx.org.name} required /></Field>
            <Field label="Default time zone" hint="Branches can override"><Input name="timezone" defaultValue={s?.timezone ?? "UTC"} required /></Field>
          </div>
        </Card>
        <Card title="Attendance policy">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="A day with a missing punch counts as">
              <Select name="missingPunchStatus" defaultValue={s?.missingPunchStatus ?? "PRESENT"}>
                <option value="PRESENT">Present (fix via regularization)</option>
                <option value="HALF_DAY">Half day</option>
                <option value="ABSENT">Absent</option>
              </Select>
            </Field>
            <Field label="Ignore repeat punches within (min)"><Input name="dedupeMinutes" type="number" defaultValue={s?.dedupeMinutes ?? 2} /></Field>
            <Field label="Daily HR digest at (hour, 0-23)"><Input name="digestHour" type="number" defaultValue={s?.digestHour ?? 10} /></Field>
          </div>
          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-slate-600">Weekly off days for employees without a shift</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1"><input type="checkbox" name="weekOffs" value={i} defaultChecked={(s?.weekOffs ?? [0]).includes(i)} /> {d}</label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 space-y-2">
            {check("autoDeductBreak", "Deduct the shift break when an employee only punches in and out", s?.autoDeductBreak ?? true)}
            {check("otRequiresApproval", "Overtime counts in payroll only after approval", s?.otRequiresApproval)}
            {check("notifyLate", "Notify employees when they arrive late", s?.notifyLate ?? true)}
            {check("webPunch", "Let employees clock in/out from their phone or browser (GPS-checked against their branch location and radius)", s?.webPunch)}
          </div>
        </Card>
        <Card title="Payroll export mapping">
          <p className="mb-2 text-sm text-slate-600">
            Optional JSON mapping your payroll system&apos;s column headers to fields. Available fields:{" "}
            <code className="text-xs">{Object.keys(PAYROLL_FIELDS).join(", ")}</code>
          </p>
          <Textarea name="payrollColumns" rows={6} className="font-mono" placeholder={'{ "EmpNo": "code", "Days Worked": "presentDays", "OT Hours": "otHours" }'} defaultValue={s?.payrollColumns ? JSON.stringify(s.payrollColumns, null, 2) : ""} />
        </Card>
        <Button>Save settings</Button>
      </form>
    </div>
  );
}
