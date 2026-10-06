import type { Employee } from "@prisma/client";
import { Field, Input, Select } from "@/components/ui";

type Opt = { id: string; name: string };

export function EmployeeFields({ e, branches, departments, designations, shifts, managers }: {
  e?: Employee; branches: Opt[]; departments: Opt[]; designations: Opt[]; shifts: Opt[]; managers: Opt[];
}) {
  const sel = (name: string, label: string, opts: Opt[], value?: string | null, empty = "None") => (
    <Field label={label}>
      <Select name={name} defaultValue={value ?? ""}>
        <option value="">{empty}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    </Field>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Employee code" hint="Same as the user ID on terminals"><Input name="code" defaultValue={e?.code} required /></Field>
      <Field label="Full name"><Input name="name" defaultValue={e?.name} required /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={e?.email ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={e?.phone ?? ""} /></Field>
      {sel("branchId", "Branch", branches, e?.branchId)}
      {sel("departmentId", "Department", departments, e?.departmentId)}
      {sel("designationId", "Designation", designations, e?.designationId)}
      {sel("managerId", "Reports to", managers.filter((m) => m.id !== e?.id), e?.managerId)}
      {sel("defaultShiftId", "Default shift", shifts, e?.defaultShiftId)}
      <Field label="Join date"><Input name="joinDate" type="date" defaultValue={e?.joinDate?.toISOString().slice(0, 10) ?? ""} /></Field>
      <Field label="Date of birth" hint="Shown to HR as a birthday reminder; the year is never displayed"><Input name="birthDate" type="date" defaultValue={e?.birthDate?.toISOString().slice(0, 10) ?? ""} /></Field>
      <Field label="Photo URL"><Input name="photoUrl" type="url" defaultValue={e?.photoUrl ?? ""} /></Field>
    </div>
  );
}
