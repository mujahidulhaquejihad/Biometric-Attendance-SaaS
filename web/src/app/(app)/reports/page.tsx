import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Button, Card, Field, FilterBar, Input, LinkButton, PageHeader, Select, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { buildReport, FORMATS, resolveReport, type Report } from "@/lib/reports";
import { REPORTS } from "@/lib/reports-meta";
import { APPROVERS, assertRole, HR, requireRole } from "@/lib/session";

export const metadata = { title: "Reports" };

async function addSchedule(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({
    kind: z.enum(Object.keys(REPORTS) as [keyof typeof REPORTS]),
    format: z.enum(FORMATS),
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    hour: z.coerce.number().int().min(0).max(23),
    recipients: z.string().transform((s) => s.split(/[\s,;]+/).filter(Boolean)).pipe(z.array(z.string().email()).min(1).max(20)),
  }).parse(Object.fromEntries(fd));
  const s = await ctx.db.reportSchedule.create({ data: p });
  await audit(ctx, "create", "ReportSchedule", s.id, p);
  revalidatePath("/reports");
}

async function deleteSchedule(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  await ctx.db.reportSchedule.deleteMany({ where: { id } });
  await audit(ctx, "delete", "ReportSchedule", id);
  revalidatePath("/reports");
}

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireRole(APPROVERS);
  const q = await searchParams;
  const isHr = HR.includes(ctx.role);
  const scope = ctx.role === "manager" ? { managerId: ctx.employee?.id ?? "-" } : {};
  const [branches, departments, employees, schedules] = await Promise.all([
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { active: true, ...scope }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    isHr ? ctx.db.reportSchedule.findMany({ orderBy: { createdAt: "asc" } }) : [],
  ]);

  let report: Report | null = null;
  let error = "";
  let query = "";
  try {
    const { kind, params } = await resolveReport(ctx, q);
    report = await buildReport(ctx.db, kind, params);
    query = new URLSearchParams(Object.entries({ from: params.from, to: params.to, employee: q.employee, dept: q.dept, branch: q.branch }).filter((e): e is [string, string] => !!e[1])).toString();
  } catch (e) {
    error = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Report failed";
  }
  const kind = q.kind && q.kind in REPORTS ? q.kind : "daily";

  return (
    <>
      <PageHeader
        title="Reports"
        description={report ? `${report.title} · ${report.subtitle}` : undefined}
        actions={report && FORMATS.map((f) => <LinkButton key={f} href={`/api/reports/${kind}?format=${f}&${query}`} prefetch={false}>{f.toUpperCase()}</LinkButton>)}
      />
      <FilterBar>
        <Field label="Report">
          <Select name="kind" defaultValue={kind}>{Object.entries(REPORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        <Field label="From"><Input type="date" name="from" defaultValue={q.from} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={q.to} /></Field>
        <Field label="Branch">
          <Select name="branch" defaultValue={q.branch ?? ""}><option value="">All</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </Field>
        <Field label="Department">
          <Select name="dept" defaultValue={q.dept ?? ""}><option value="">All</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
        <Field label="Employee">
          <Select name="employee" defaultValue={q.employee ?? ""}><option value="">All</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}</Select>
        </Field>
      </FilterBar>

      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {report && (
        <Card title={`${report.rows.length} row(s)${report.rows.length > 200 ? " · showing first 200, download for all" : ""}`} className="mb-6">
          <Table head={report.columns}>
            {report.rows.slice(0, 200).map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-nowrap">{c}</td>)}</tr>
            ))}
          </Table>
        </Card>
      )}

      {isHr && (
        <Card title="Scheduled emails">
          <Table head={["Report", "Format", "Frequency", "Hour", "Recipients", "Last sent", ""]} empty="No scheduled reports.">
            {schedules.map((s) => (
              <tr key={s.id}>
                <td>{REPORTS[s.kind as keyof typeof REPORTS] ?? s.kind}</td>
                <td>{s.format.toUpperCase()}</td>
                <td>{s.frequency.toLowerCase()}</td>
                <td>{String(s.hour).padStart(2, "0")}:00</td>
                <td className="text-xs">{s.recipients.join(", ")}</td>
                <td className="text-xs">{s.lastSentAt?.toLocaleString() ?? "never"}</td>
                <td><form action={deleteSchedule}><input type="hidden" name="id" value={s.id} /><ConfirmButton className="text-xs text-red-600 hover:underline">Delete</ConfirmButton></form></td>
              </tr>
            ))}
          </Table>
          <form action={addSchedule} className="mt-4 grid gap-3 sm:grid-cols-6">
            <Field label="Report" className="sm:col-span-2">
              <Select name="kind">{Object.entries(REPORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            </Field>
            <Field label="Format"><Select name="format">{FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</Select></Field>
            <Field label="Frequency" hint="Weekly runs Monday, monthly on the 1st (previous period)">
              <Select name="frequency"><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select>
            </Field>
            <Field label="Hour (0-23)"><Input name="hour" type="number" min={0} max={23} defaultValue={8} required /></Field>
            <Field label="Recipients" className="sm:col-span-6" hint="Comma-separated emails">
              <Input name="recipients" required placeholder="hr@example.com, payroll@example.com" />
            </Field>
            <div><Button>Add schedule</Button></div>
          </form>
        </Card>
      )}
    </>
  );
}
