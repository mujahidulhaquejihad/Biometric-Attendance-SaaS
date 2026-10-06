import { z } from "zod";
import { syncEmployee } from "@/lib/adapters/adms";
import { linkPunches, orgTimezone } from "@/lib/punches";
import type { Ctx } from "@/lib/session";
import { emitWebhook } from "@/lib/webhooks";

const opt = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().optional());
export const employeeSchema = z.object({
  code: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, - and _"),
  name: z.string().trim().min(1).max(100),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toLowerCase().email().optional()),
  phone: opt,
  photoUrl: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  branchId: opt,
  departmentId: opt,
  designationId: opt,
  managerId: opt,
  defaultShiftId: opt,
  joinDate: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  birthDate: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

export function toData(p: z.infer<typeof employeeSchema>) {
  return {
    code: p.code, name: p.name, email: p.email ?? null, phone: p.phone ?? null, photoUrl: p.photoUrl ?? null,
    branchId: p.branchId ?? null, departmentId: p.departmentId ?? null, designationId: p.designationId ?? null,
    managerId: p.managerId ?? null, defaultShiftId: p.defaultShiftId ?? null,
    joinDate: p.joinDate ? new Date(p.joinDate + "T00:00:00Z") : null,
    birthDate: p.birthDate ? new Date(p.birthDate + "T00:00:00Z") : null,
  };
}

export async function afterSave(ctx: Ctx, id: string, code: string, branchId: string | null) {
  await syncEmployee(ctx.orgId, id);
  await linkPunches(ctx.orgId, id, code, await orgTimezone(ctx.orgId, branchId));
  await emitWebhook(ctx.orgId, "employee.updated", { id, code });
}
