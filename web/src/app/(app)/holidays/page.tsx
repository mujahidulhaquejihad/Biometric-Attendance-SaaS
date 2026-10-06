import { revalidatePath } from "next/cache";
import Link from "next/link";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { queueRecompute } from "@/lib/jobs";
import { assertRole, HR, requireRole, type Ctx } from "@/lib/session";
import { fromDbDate, toDbDate } from "@/lib/time";

export const metadata = { title: "Holidays" };

async function recomputeDate(ctx: Ctx, date: string, branchId: string | null) {
  const emps = await ctx.db.employee.findMany({ where: { active: true, ...(branchId ? { branchId } : {}) }, select: { id: true } });
  await queueRecompute(emps.map((e) => ({ employeeId: e.id, date })));
}

async function addHoliday(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(100), branchId: z.string().optional() })
    .parse(Object.fromEntries([...fd].filter(([, v]) => v !== "")));
  const h = await ctx.db.holiday.create({ data: { date: toDbDate(p.date), name: p.name, branchId: p.branchId ?? null } });
  await audit(ctx, "create", "Holiday", h.id, p);
  await recomputeDate(ctx, p.date, p.branchId ?? null);
  revalidatePath("/holidays");
}

async function deleteHoliday(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const h = await ctx.db.holiday.findFirstOrThrow({ where: { id: String(fd.get("id")) } });
  await ctx.db.holiday.delete({ where: { id: h.id } });
  await audit(ctx, "delete", "Holiday", h.id);
  await recomputeDate(ctx, fromDbDate(h.date), h.branchId);
  revalidatePath("/holidays");
}

async function copyYear(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const year = Number(fd.get("year"));
  const src = await ctx.db.holiday.findMany({ where: { date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) } } });
  const exists = new Set((await ctx.db.holiday.findMany({ where: { date: { gte: toDbDate(`${year + 1}-01-01`), lte: toDbDate(`${year + 1}-12-31`) } } })).map((h) => `${fromDbDate(h.date).slice(5)}|${h.name}`));
  const data = src
    .filter((h) => !exists.has(`${fromDbDate(h.date).slice(5)}|${h.name}`) && fromDbDate(h.date).slice(5) !== "02-29")
    .map((h) => ({ date: toDbDate(`${year + 1}${fromDbDate(h.date).slice(4)}`), name: h.name, branchId: h.branchId }));
  await ctx.db.holiday.createMany({ data });
  await audit(ctx, "copy_year", "Holiday", null, { from: year, count: data.length });
  revalidatePath("/holidays");
}

export default async function Holidays({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireRole(HR);
  const year = Number((await searchParams).year ?? new Date().getFullYear());
  const [holidays, branches] = await Promise.all([
    ctx.db.holiday.findMany({ where: { date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) } }, include: { branch: true }, orderBy: { date: "asc" } }),
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title={`Holidays ${year}`}
        actions={<><Link className="text-sm text-blue-600" href={`?year=${year - 1}`}>← {year - 1}</Link><Link className="text-sm text-blue-600" href={`?year=${year + 1}`}>{year + 1} →</Link></>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Table head={["Date", "Day", "Name", "Applies to", ""]}>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td>{fromDbDate(h.date)}</td>
                <td className="text-xs text-slate-500">{h.date.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" })}</td>
                <td>{h.name}</td>
                <td>{h.branch?.name ?? "All branches"}</td>
                <td>
                  <form action={deleteHoliday}><input type="hidden" name="id" value={h.id} /><ConfirmButton className="text-xs text-red-600 hover:underline">Delete</ConfirmButton></form>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Add holiday">
            <form action={addHoliday} className="space-y-3">
              <Field label="Date"><Input type="date" name="date" required /></Field>
              <Field label="Name"><Input name="name" required /></Field>
              <Field label="Branch">
                <Select name="branchId"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
              </Field>
              <Button className="w-full">Add holiday</Button>
            </form>
          </Card>
          <Card title="Next year">
            <form action={copyYear}>
              <input type="hidden" name="year" value={year} />
              <p className="mb-3 text-sm text-slate-600">Copy fixed-date holidays from {year} to {year + 1}. Adjust moving holidays afterwards.</p>
              <Button variant="secondary">Copy to {year + 1}</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
