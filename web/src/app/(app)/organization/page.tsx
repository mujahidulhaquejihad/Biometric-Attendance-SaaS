import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Button, Card, Field, Input, PageHeader, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { assertRole, HR, requireRole } from "@/lib/session";

export const metadata = { title: "Branches & departments" };

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

async function saveBranch(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().max(20).optional(),
    timezone: z.string().trim().optional().refine((v) => !v || validTz(v), "Unknown time zone"),
    address: z.string().trim().max(300).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusM: z.coerce.number().int().min(20).max(5000).optional(),
  }).parse(Object.fromEntries([...fd].filter(([, v]) => v !== "")));
  const { id, ...data } = p;
  const row = id ? await ctx.db.branch.update({ where: { id }, data }) : await ctx.db.branch.create({ data });
  await audit(ctx, id ? "update" : "create", "Branch", row.id, data);
  revalidatePath("/organization");
}

async function saveNamed(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const kind = z.enum(["department", "designation"]).parse(fd.get("kind"));
  const name = z.string().trim().min(1).max(80).parse(fd.get("name"));
  const delegate = (kind === "department" ? ctx.db.department : ctx.db.designation) as typeof ctx.db.department;
  const row = await delegate.create({ data: { name } });
  await audit(ctx, "create", kind, row.id, { name });
  revalidatePath("/organization");
}

async function remove(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const kind = z.enum(["branch", "department", "designation"]).parse(fd.get("kind"));
  const id = String(fd.get("id"));
  const delegate = (kind === "branch" ? ctx.db.branch : kind === "department" ? ctx.db.department : ctx.db.designation) as typeof ctx.db.department;
  await delegate.delete({ where: { id } });
  await audit(ctx, "delete", kind, id);
  revalidatePath("/organization");
}

export default async function Organization() {
  const ctx = await requireRole(HR);
  const [branches, departments, designations] = await Promise.all([
    ctx.db.branch.findMany({ include: { _count: { select: { employees: true, devices: true } } }, orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { name: "asc" } }),
    ctx.db.designation.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { name: "asc" } }),
  ]);
  const del = (kind: string, id: string) => (
    <form action={remove}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <ConfirmButton message="Delete? Employees keep their records but lose this assignment." className="text-xs text-red-600 hover:underline">Delete</ConfirmButton>
    </form>
  );

  return (
    <>
      <PageHeader title="Branches & departments" />
      <div className="space-y-6">
        <Card title="Branches">
          <Table head={["Name", "Code", "Time zone", "Address", "Employees", "Devices", ""]}>
            {branches.map((b) => (
              <tr key={b.id}>
                <td colSpan={4}>
                  <details>
                    <summary className="cursor-pointer font-medium">{b.name} <span className="ml-2 text-xs font-normal text-slate-500">{b.code} · {b.timezone ?? "org default"} · {b.address}</span></summary>
                    <form action={saveBranch} className="mt-2 grid gap-2 md:grid-cols-4">
                      <input type="hidden" name="id" value={b.id} />
                      <BranchFields b={b} />
                      <div><Button variant="secondary">Save</Button></div>
                    </form>
                  </details>
                </td>
                <td>{b._count.employees}</td>
                <td>{b._count.devices}</td>
                <td>{del("branch", b.id)}</td>
              </tr>
            ))}
          </Table>
          <form action={saveBranch} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 md:grid-cols-4">
            <BranchFields />
            <div className="flex items-end"><Button>Add branch</Button></div>
          </form>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {([["department", "Departments", departments], ["designation", "Designations", designations]] as const).map(([kind, title, rows]) => (
            <Card key={kind} title={title}>
              <Table head={["Name", "Employees", ""]}>
                {rows.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r._count.employees}</td><td>{del(kind, r.id)}</td></tr>
                ))}
              </Table>
              <form action={saveNamed} className="mt-4 flex gap-2">
                <input type="hidden" name="kind" value={kind} />
                <Input name="name" placeholder={`New ${kind}`} required />
                <Button>Add</Button>
              </form>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function BranchFields({ b }: { b?: { name: string; code: string | null; timezone: string | null; address: string | null; lat: number | null; lng: number | null; radiusM: number } }) {
  return (
    <>
      <Field label="Name"><Input name="name" defaultValue={b?.name} required /></Field>
      <Field label="Code"><Input name="code" defaultValue={b?.code ?? ""} /></Field>
      <Field label="Time zone" hint="e.g. Asia/Dhaka; blank = org default"><Input name="timezone" defaultValue={b?.timezone ?? ""} /></Field>
      <Field label="Address"><Input name="address" defaultValue={b?.address ?? ""} /></Field>
      <Field label="Latitude"><Input name="lat" defaultValue={b?.lat ?? ""} /></Field>
      <Field label="Longitude"><Input name="lng" defaultValue={b?.lng ?? ""} /></Field>
      <Field label="Web punch radius (m)" hint="Used when phone/browser punching is on"><Input name="radiusM" type="number" min={20} max={5000} defaultValue={b?.radiusM ?? 200} /></Field>
    </>
  );
}
