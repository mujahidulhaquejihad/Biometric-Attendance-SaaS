import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Badge, Button, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { audit } from "@/lib/audit";
import { notify, usersWithRoles } from "@/lib/notify";
import { orgTimezone } from "@/lib/punches";
import { assertRole, getCtx, HR, ROLES } from "@/lib/session";
import { fromDbDate, localDate, toDbDate } from "@/lib/time";

export const metadata = { title: "Notices" };

async function postNotice(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const p = z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(5000),
    expiresOn: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  }).parse(Object.fromEntries(fd));
  const n = await ctx.db.notice.create({
    data: { title: p.title, body: p.body, pinned: fd.get("pinned") === "on", expiresOn: p.expiresOn ? toDbDate(p.expiresOn) : null, createdById: ctx.user.id },
  });
  await audit(ctx, "create", "Notice", n.id, { title: p.title });
  // ponytail: one email per member, sent together; past a few thousand users this belongs on the job queue.
  if (fd.get("notify") === "on") await notify(ctx.orgId, await usersWithRoles(ctx.orgId, [...ROLES]), `Notice: ${p.title}`, p.body.slice(0, 500), "/notices");
  revalidatePath("/notices");
}

async function deleteNotice(fd: FormData) {
  "use server";
  const ctx = await assertRole(HR);
  const id = String(fd.get("id"));
  await ctx.db.notice.deleteMany({ where: { id } });
  await audit(ctx, "delete", "Notice", id);
  revalidatePath("/notices");
}

export default async function Notices() {
  const ctx = await getCtx();
  const isHr = HR.includes(ctx.role);
  const today = localDate(new Date(), await orgTimezone(ctx.orgId));
  const notices = await ctx.db.notice.findMany({
    where: isHr ? {} : { OR: [{ expiresOn: null }, { expiresOn: { gte: toDbDate(today) } }] },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <>
      <PageHeader title="Notices" description="Announcements from HR and management." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className={isHr ? "space-y-4 xl:col-span-2" : "space-y-4 xl:col-span-3"}>
          {notices.map((n) => {
            const expired = n.expiresOn && fromDbDate(n.expiresOn) < today;
            return (
              <Card key={n.id} title={n.title} actions={
                <div className="flex items-center gap-2">
                  {n.pinned && <Badge tone="PENDING">Pinned</Badge>}
                  {expired && <Badge>Expired</Badge>}
                  {isHr && <form action={deleteNotice}><input type="hidden" name="id" value={n.id} /><ConfirmButton className="text-xs text-red-600 hover:underline">Delete</ConfirmButton></form>}
                </div>
              }>
                <p className="whitespace-pre-line text-sm text-slate-700">{n.body}</p>
                <p className="mt-3 text-xs text-slate-400">
                  Posted {n.createdAt.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}
                  {n.expiresOn && ` · ${expired ? "expired" : "until"} ${fromDbDate(n.expiresOn)}`}
                </p>
              </Card>
            );
          })}
          {!notices.length && <Card><p className="text-sm text-slate-400">No notices right now.</p></Card>}
        </div>
        {isHr && (
          <Card title="Post a notice" className="self-start">
            <form action={postNotice} className="space-y-3">
              <Field label="Title"><Input name="title" required maxLength={120} /></Field>
              <Field label="Message"><Textarea name="body" rows={6} required maxLength={5000} /></Field>
              <Field label="Show until" hint="Optional; hidden from employees after this date"><Input type="date" name="expiresOn" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" /> Pin to the top</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked /> Notify everyone (in-app and email)</label>
              <Button className="w-full">Post notice</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
