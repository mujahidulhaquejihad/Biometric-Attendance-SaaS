import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Button, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getCtx } from "@/lib/session";

export const metadata = { title: "Notifications" };

async function markRead(fd: FormData) {
  "use server";
  const ctx = await getCtx();
  const id = fd.get("id");
  await prisma.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(id ? { id: String(id) } : {}) }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export default async function Notifications() {
  const ctx = await getCtx();
  // Notifications belong to the user across organizations, so this skips tenant scoping on purpose.
  const items = await prisma.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.some((n) => !n.readAt);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={unread && <form action={markRead}><Button variant="secondary">Mark all read</Button></form>} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 py-3 ${n.readAt ? "opacity-60" : ""}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-blue-600"}`} aria-label={n.readAt ? undefined : "unread"} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                {n.body && <p className="whitespace-pre-line text-sm text-slate-600">{n.body}</p>}
                <div className="text-xs text-slate-400">{n.createdAt.toLocaleString()}</div>
              </div>
              {!n.readAt && (
                <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="text-xs text-blue-600 hover:underline">Mark read</button></form>
              )}
            </li>
          ))}
          {!items.length && <li className="py-8 text-center text-sm text-slate-400">You&apos;re all caught up.</li>}
        </ul>
      </Card>
    </div>
  );
}
