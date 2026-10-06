import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/client";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { decryptJson } from "@/lib/crypto";
import { isOnline, VENDOR_LABEL } from "@/lib/device-meta";
import { HR, requireRole } from "@/lib/session";
import { deleteDevice, deviceCommand, regenerateToken, updateDevice } from "../actions";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireRole(HR);
  const d = await ctx.db.device.findFirst({ where: { id }, include: { branch: true } });
  if (!d) notFound();
  const [branches, commands, punches] = await Promise.all([
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
    ctx.db.deviceCommand.findMany({ where: { deviceId: id }, orderBy: { seq: "desc" }, take: 25 }),
    ctx.db.punch.findMany({ where: { deviceId: id }, include: { employee: true }, orderBy: { timestamp: "desc" }, take: 25 }),
  ]);
  const cfg = decryptJson(ctx.orgId, d.config);
  const flash = (await cookies()).get("device_token")?.value;
  const token = flash?.startsWith(`${id}:`) ? flash.slice(id.length + 1) : null;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-server";
  const proto = h.get("x-forwarded-proto") ?? "https";

  return (
    <>
      <PageHeader
        title={d.name}
        description={`${VENDOR_LABEL[d.vendor]}${d.serial ? ` · SN ${d.serial}` : ""}`}
        actions={d.status === "ACTIVE" ? <Badge tone={isOnline(d) ? "online" : "offline"}>{isOnline(d) ? "online" : "offline"}</Badge> : <Badge>{d.status}</Badge>}
      />

      {token && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-semibold text-amber-900">Device token (shown once, copy it now)</div>
          <code className="mt-2 block break-all rounded bg-white p-2">{token}</code>
          {d.vendor === "HIKVISION" && (
            <p className="mt-2">Event push URL: <code>{`${proto}://${host}/api/ingest/hikvision/${token}`}</code></p>
          )}
          {d.vendor === "AGENT" && <p className="mt-2">Put this in the agent&apos;s <code>appsettings.json</code> as <code>DeviceToken</code>.</p>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Setup">
            <SetupHelp vendor={d.vendor} host={host} proto={proto} />
          </Card>

          {d.vendor === "ZKTECO_ADMS" && (
            <Card title="Remote commands">
              <div className="flex flex-wrap gap-2">
                {[
                  ["sync", "Sync employees & fingerprints"],
                  ["check", "Re-upload logs"],
                  ["info", "Refresh device info"],
                  ["reboot", "Reboot"],
                ].map(([a, l]) => (
                  <form key={a} action={deviceCommand}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="action" value={a} />
                    <Button variant="secondary">{l}</Button>
                  </form>
                ))}
                <form action={deviceCommand}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="action" value="clear" />
                  <ConfirmButton message="Delete all attendance logs stored on the terminal? Already-uploaded punches are kept.">Clear device logs</ConfirmButton>
                </form>
              </div>
              <div className="mt-4">
                <Table head={["#", "Command", "Status", "Result", "Queued"]} empty="No commands sent yet.">
                  {commands.map((c) => (
                    <tr key={c.id}>
                      <td>{c.seq}</td>
                      <td className="max-w-xs truncate font-mono text-xs">{c.command.replace(/TMP=\S+/, "TMP=…")}</td>
                      <td><Badge>{c.status}</Badge></td>
                      <td className="text-xs">{c.result}</td>
                      <td className="text-xs">{c.createdAt.toLocaleString()}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Card>
          )}

          <Card title="Recent punches">
            <Table head={["Time", "Employee", "Verify", "Direction"]} empty="No punches from this device yet.">
              {punches.map((p) => (
                <tr key={p.id}>
                  <td className="text-xs">{p.timestamp.toLocaleString()}</td>
                  <td>{p.employee?.name ?? <span className="text-amber-700">Unknown #{p.employeeCode}</span>}</td>
                  <td className="text-xs">{p.verifyMode}</td>
                  <td>{p.direction && <Badge>{p.direction}</Badge>}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Settings">
            <form action={updateDevice} className="space-y-3">
              <input type="hidden" name="id" value={d.id} />
              <Field label="Name"><Input name="name" defaultValue={d.name} /></Field>
              <Field label="Branch">
                <Select name="branchId" defaultValue={d.branchId ?? ""}>
                  <option value="">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue={d.status}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></Select>
              </Field>
              {(d.vendor === "ZKTECO_ADMS" || d.vendor === "HIKVISION") && (
                <Field label="Allowed source IPs" hint="Optional. Your office's public IP(s); others are rejected.">
                  <Input name="allowedIps" defaultValue={d.allowedIps.join(", ")} />
                </Field>
              )}
              {d.vendor === "ZK_PULL" && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="IP" className="col-span-2"><Input name="ip" defaultValue={cfg.ip} /></Field>
                  <Field label="Port"><Input name="port" defaultValue={cfg.port ?? 4370} /></Field>
                </div>
              )}
              {(d.vendor === "SUPREMA_BIOSTAR" || d.vendor === "ANVIZ_CLOUD") && (
                <>
                  <Field label="API base URL"><Input name="baseUrl" defaultValue={cfg.baseUrl} /></Field>
                  {d.vendor === "SUPREMA_BIOSTAR" ? (
                    <>
                      <Field label="Username"><Input name="username" defaultValue={cfg.username} /></Field>
                      <Field label="Password" hint="Leave blank to keep"><Input name="password" type="password" /></Field>
                    </>
                  ) : (
                    <>
                      <Field label="API key"><Input name="apiKey" defaultValue={cfg.apiKey} /></Field>
                      <Field label="API secret" hint="Leave blank to keep"><Input name="apiSecret" type="password" /></Field>
                    </>
                  )}
                  {cfg.lastError && <p className="text-xs text-red-600">Last error: {cfg.lastError}</p>}
                </>
              )}
              <Button className="w-full">Save</Button>
            </form>
          </Card>
          <Card title="Details">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Last seen</dt><dd>{d.lastSeenAt?.toLocaleString() ?? "never"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">IP</dt><dd>{d.ip ?? "-"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Firmware</dt><dd className="truncate">{d.firmware ?? "-"}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {(d.vendor === "HIKVISION" || d.vendor === "AGENT") && (
                <form action={regenerateToken}><input type="hidden" name="id" value={d.id} /><Button variant="secondary">New token</Button></form>
              )}
              <form action={deleteDevice}>
                <input type="hidden" name="id" value={d.id} />
                <ConfirmButton message="Remove this device? Its punches are kept.">Remove</ConfirmButton>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function SetupHelp({ vendor, host, proto }: { vendor: string; host: string; proto: string }) {
  const hostname = host.split(":")[0];
  const steps: Record<string, React.ReactNode> = {
    ZKTECO_ADMS: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>On the terminal open <b>Menu &gt; Comm. &gt; Cloud Server Setting</b> (or ADMS).</li>
        <li>Server address: <code>{hostname}</code>, port <code>8081</code> (or 80). Disable HTTPS and proxy.</li>
        <li>The terminal appears online within a minute. Use <b>Sync employees &amp; fingerprints</b> to push your staff list.</li>
      </ol>
    ),
    HIKVISION: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>In the device web UI open <b>Configuration &gt; Network &gt; Advanced &gt; HTTP Listening</b>.</li>
        <li>Paste the event push URL shown when the token was generated (generate a new token if you lost it).</li>
        <li>Make sure employee numbers on the device match employee codes here.</li>
      </ol>
    ),
    SUPREMA_BIOSTAR: <p>Enter your BioStar 2 server URL and an operator account. Events are pulled every minute; BioStar user IDs must match employee codes.</p>,
    ANVIZ_CLOUD: <p>Create an API key in CrossChex Cloud (Settings &gt; API) and enter it here. Records are pulled every minute by employee work number.</p>,
    ZK_PULL: <p>For terminals without ADMS. A bridge agent in the same branch polls this device on the LAN (TCP 4370) every minute and uploads new logs.</p>,
    AGENT: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>Install the bridge agent on the PC that has the USB scanner (Windows service).</li>
        <li>Set <code>ServerUrl</code> to <code>{`${proto}://${host}`}</code> and <code>DeviceToken</code> to this device&apos;s token.</li>
        <li>Open <code>/kiosk</code> on that PC for the check-in screen; enroll fingers from <b>Fingerprint enrollment</b>.</li>
      </ol>
    ),
  };
  return <div className="text-sm text-slate-700">{steps[vendor]}</div>;
}
