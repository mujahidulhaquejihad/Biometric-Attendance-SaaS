import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConfirmButton } from "@/components/client";
import { Badge, Button, Card, Field, Input, PageHeader, Table } from "@/components/ui";
import { audit } from "@/lib/audit";
import { encrypt, newToken, sha256 } from "@/lib/crypto";
import { getBoss } from "@/lib/jobs";
import { assertRole, requireRole } from "@/lib/session";
import { assertPublicUrl, WEBHOOK_EVENTS } from "@/lib/webhooks";

export const metadata = { title: "API & webhooks" };

async function flash(label: string, value: string) {
  (await cookies()).set("dev_secret", JSON.stringify({ label, value }), { maxAge: 120, httpOnly: true, sameSite: "strict", path: "/developers" });
}

async function createKey(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const name = z.string().trim().min(1).max(60).parse(fd.get("name"));
  const prefix = newToken(6);
  const key = `ak_${prefix}_${newToken(24)}`;
  const k = await ctx.db.apiKey.create({ data: { name, prefix, keyHash: sha256(key) } });
  await audit(ctx, "create", "ApiKey", k.id, { name, prefix });
  await flash(`API key "${name}"`, key);
  revalidatePath("/developers");
}

async function revokeKey(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const id = String(fd.get("id"));
  await ctx.db.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(ctx, "revoke", "ApiKey", id);
  revalidatePath("/developers");
}

async function createWebhook(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const url = z.string().url().max(500).parse(fd.get("url"));
  await assertPublicUrl(url);
  const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event.").parse(fd.getAll("events"));
  const secret = `whsec_${newToken(24)}`;
  const h = await ctx.db.webhook.create({ data: { url, events, secret: Buffer.from(encrypt(ctx.orgId, Buffer.from(secret))).toString("base64") } });
  await audit(ctx, "create", "Webhook", h.id, { url, events });
  await flash(`Signing secret for ${url}`, secret);
  revalidatePath("/developers");
}

async function webhookAction(fd: FormData) {
  "use server";
  const ctx = await assertRole(["admin"]);
  const h = await ctx.db.webhook.findFirstOrThrow({ where: { id: String(fd.get("webhookId")) } });
  const action = fd.get("action");
  if (action === "delete") await ctx.db.webhook.delete({ where: { id: h.id } });
  if (action === "toggle") await ctx.db.webhook.update({ where: { id: h.id }, data: { active: !h.active } });
  if (action === "test") {
    const body = JSON.stringify({ event: "ping", organizationId: ctx.orgId, createdAt: new Date().toISOString(), data: {} });
    await (await getBoss()).send("webhook", { webhookId: h.id, body });
  }
  await audit(ctx, `webhook:${action}`, "Webhook", h.id);
  revalidatePath("/developers");
}

export default async function Developers() {
  const ctx = await requireRole(["admin"]);
  const [keys, hooks] = await Promise.all([
    ctx.db.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
    ctx.db.webhook.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const raw = (await cookies()).get("dev_secret")?.value;
  const secret = raw ? (JSON.parse(raw) as { label: string; value: string }) : null;
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}/api/v1`;

  return (
    <>
      <PageHeader title="API & webhooks" description="Connect payroll, HRMS and access-control systems." />
      {secret && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-semibold text-amber-900">{secret.label} (shown once, copy it now)</div>
          <code className="mt-2 block break-all rounded bg-white p-2">{secret.value}</code>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="API keys">
          <Table head={["Name", "Key", "Last used", ""]} empty="No API keys.">
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="font-mono text-xs">ak_{k.prefix}_…</td>
                <td className="text-xs">{k.revokedAt ? <Badge tone="REJECTED">revoked</Badge> : k.lastUsedAt?.toLocaleString() ?? "never"}</td>
                <td>{!k.revokedAt && <form action={revokeKey}><input type="hidden" name="id" value={k.id} /><ConfirmButton message="Revoke this key? Integrations using it stop working." className="text-xs text-red-600 hover:underline">Revoke</ConfirmButton></form>}</td>
              </tr>
            ))}
          </Table>
          <form action={createKey} className="mt-4 flex items-end gap-2">
            <Field label="New key name" className="flex-1"><Input name="name" required placeholder="Payroll sync" /></Field>
            <Button>Create key</Button>
          </form>
          <div className="mt-6 space-y-1 text-xs text-slate-600">
            <p className="font-medium text-slate-800">Endpoints (send <code>Authorization: Bearer ak_…</code>)</p>
            <pre className="overflow-x-auto rounded bg-slate-50 p-3">{`GET  ${base}/employees?active=true&cursor=
GET  ${base}/punches?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&cursor=
GET  ${base}/attendance?from=2026-01-01&to=2026-01-31&employee_code=1001&cursor=
POST ${base}/punches   {"punches":[{"employee_code":"1001","timestamp":"2026-01-01T09:02:00+05:30","direction":"IN"}]}`}</pre>
            <p>Lists return <code>{`{ data, next_cursor }`}</code>; pass <code>cursor</code> to get the next page. Limit 600 requests/minute per key.</p>
          </div>
        </Card>

        <Card title="Webhooks">
          <Table head={["URL", "Events", "", ""]} empty="No webhooks.">
            {hooks.map((w) => (
              <tr key={w.id}>
                <td className="max-w-56 truncate text-xs" title={w.url}>{w.url}</td>
                <td className="text-xs">{w.events.join(", ")}</td>
                <td><Badge tone={w.active ? "ACTIVE" : "DISABLED"}>{w.active ? "active" : "paused"}</Badge></td>
                <td>
                  <form action={webhookAction} className="flex gap-2 text-xs">
                    {/* Not name="id": it would shadow form.id and React then drops the clicked button's value. */}
                    <input type="hidden" name="webhookId" value={w.id} />
                    <button name="action" value="test" className="text-blue-600 hover:underline">Test</button>
                    <button name="action" value="toggle" className="text-slate-600 hover:underline">{w.active ? "Pause" : "Resume"}</button>
                    <ConfirmButton name="action" value="delete" className="text-red-600 hover:underline">Delete</ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
          <form action={createWebhook} className="mt-4 space-y-3">
            <Field label="HTTPS endpoint"><Input name="url" type="url" required placeholder="https://example.com/hooks/attendance" /></Field>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1 text-xs font-medium text-slate-600">Events</legend>
              {WEBHOOK_EVENTS.map((e) => <label key={e} className="flex items-center gap-1"><input type="checkbox" name="events" value={e} defaultChecked /> {e}</label>)}
            </fieldset>
            <Button>Add webhook</Button>
          </form>
          <p className="mt-4 text-xs text-slate-600">
            Each delivery is a JSON POST signed with <code>X-Signature: sha256=HMAC(secret, body)</code>. Failed deliveries retry with backoff up to 6 times.
          </p>
        </Card>
      </div>
    </>
  );
}
