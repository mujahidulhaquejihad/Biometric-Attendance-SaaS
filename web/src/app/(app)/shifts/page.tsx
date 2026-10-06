import type { Shift } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { audit } from "@/lib/audit";
import { assertRole, HR, requireRole } from "@/lib/session";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/time";

export const metadata = { title: "Shifts" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function saveShift(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const n = z.coerce.number().int().min(0).max(1440);
  const hhmm = z.string().regex(/^\d{2}:\d{2}$/).transform(hhmmToMinutes);
  const p = z.object({
    id: z.string().optional(), name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-f]{6}$/i),
    start: hhmm, end: hhmm, graceIn: n, graceOut: n, breakMinutes: n, halfDayMinutes: n, fullDayMinutes: n,
    otThreshold: n, otMax: n, windowBefore: n, windowAfter: n,
  }).parse(Object.fromEntries(fd));
  const { id, start, end, ...rest } = p;
  const data = { ...rest, startMinute: start, endMinute: end, weekOffs: fd.getAll("weekOffs").map(Number).filter((d) => d >= 0 && d <= 6) };
  const s = id ? await ctx.db.shift.update({ where: { id }, data }) : await ctx.db.shift.create({ data });
  await audit(ctx, id ? "update" : "create", "Shift", s.id, data);
  revalidatePath("/shifts");
}

async function deleteShift(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  await ctx.db.shift.delete({ where: { id } });
  await audit(ctx, "delete", "Shift", id);
  revalidatePath("/shifts");
}

export default async function Shifts() {
  const ctx = await requireRole(HR);
  const shifts = await ctx.db.shift.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { startMinute: "asc" } });
  return (
    <>
      <PageHeader title="Shifts" description="Working hours, grace, breaks, overtime, and weekly offs. Night shifts simply end earlier than they start." />
      <div className="grid gap-6 xl:grid-cols-2">
        {shifts.map((s) => (
          <Card
            key={s.id}
            title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: s.color }} />{s.name}</span>}
            actions={<span className="text-xs text-slate-500">{s._count.employees} employee(s) · {minutesToHhmm(s.startMinute)}–{minutesToHhmm(s.endMinute)}</span>}
          >
            <form action={saveShift} className="space-y-3">
              <input type="hidden" name="id" value={s.id} />
              <ShiftFields s={s} />
              <Button variant="secondary">Save</Button>
            </form>
            <form action={deleteShift} className="mt-2">
              <input type="hidden" name="id" value={s.id} />
              <ConfirmButton message="Delete this shift? Employees fall back to the default 09:00-18:00 rules." className="text-xs text-red-600 hover:underline">Delete shift</ConfirmButton>
            </form>
          </Card>
        ))}
        <Card title="New shift">
          <form action={saveShift} className="space-y-3">
            <ShiftFields />
            <Button>Create shift</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

function ShiftFields({ s }: { s?: Shift }) {
  const num = (name: keyof Shift, label: string, def: number, hint?: string) => (
    <Field label={label} hint={hint}><Input name={name} type="number" min={0} max={1440} defaultValue={(s?.[name] as number) ?? def} required /></Field>
  );
  return (
    <>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Name" className="col-span-3"><Input name="name" defaultValue={s?.name} required /></Field>
        <Field label="Color"><Input name="color" type="color" defaultValue={s?.color ?? "#3b82f6"} className="h-10 p-1" /></Field>
        <Field label="Start"><Input name="start" type="time" defaultValue={minutesToHhmm(s?.startMinute ?? 540)} required /></Field>
        <Field label="End"><Input name="end" type="time" defaultValue={minutesToHhmm(s?.endMinute ?? 1080)} required /></Field>
        {num("graceIn", "Late grace (min)", 10)}
        {num("graceOut", "Early-exit grace (min)", 10)}
        {num("breakMinutes", "Break (min)", 60)}
        {num("halfDayMinutes", "Half day after (min)", 240)}
        {num("fullDayMinutes", "Full day after (min)", 420)}
        {num("otThreshold", "OT after extra (min)", 30)}
        {num("otMax", "OT cap (min)", 0, "0 = no cap")}
        {num("windowBefore", "Accept punches before start (min)", 240)}
        {num("windowAfter", "Accept punches after end (min)", 240)}
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Weekly off days</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" name="weekOffs" value={i} defaultChecked={(s?.weekOffs ?? [0]).includes(i)} /> {d}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
