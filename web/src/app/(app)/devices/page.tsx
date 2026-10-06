import { ScanLine, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Stat, Table } from "@/components/ui";
import { isOnline, VENDOR_LABEL } from "@/lib/device-meta";
import { HR, requireRole } from "@/lib/session";
import { addDevice } from "./actions";

export const metadata = { title: "Devices" };

export default async function Devices() {
  const ctx = await requireRole(HR);
  const [devices, branches] = await Promise.all([
    ctx.db.device.findMany({ include: { branch: true, _count: { select: { commands: { where: { status: "PENDING" } } } } }, orderBy: { createdAt: "desc" } }),
    ctx.db.branch.findMany({ orderBy: { name: "asc" } }),
  ]);
  const online = devices.filter(isOnline).length;

  return (
    <>
      <PageHeader title="Devices" description="Fingerprint terminals, cloud integrations, and USB bridge agents." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Devices" value={devices.length} icon={ScanLine} />
        <Stat label="Online" value={online} tone="green" icon={Wifi} />
        <Stat label="Offline" value={devices.filter((d) => d.status === "ACTIVE" && !isOnline(d)).length} tone="red" icon={WifiOff} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="All devices" className="xl:col-span-2">
          <Table head={["Name", "Type", "Serial", "Branch", "Status", "Last seen", "Queued cmds"]}>
            {devices.map((d) => (
              <tr key={d.id}>
                <td><Link className="font-medium text-blue-700 hover:underline" href={`/devices/${d.id}`}>{d.name}</Link></td>
                <td className="text-xs">{VENDOR_LABEL[d.vendor]}</td>
                <td className="font-mono text-xs">{d.serial ?? "-"}</td>
                <td>{d.branch?.name ?? "All"}</td>
                <td>{d.status === "ACTIVE" ? <Badge tone={isOnline(d) ? "online" : "offline"}>{isOnline(d) ? "online" : "offline"}</Badge> : <Badge>{d.status}</Badge>}</td>
                <td className="text-xs">{d.lastSeenAt?.toLocaleString() ?? "never"}</td>
                <td>{d._count.commands}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add device">
          <form action={addDevice} className="space-y-3">
            <Field label="Type">
              <Select name="vendor" required>
                {Object.entries(VENDOR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Name"><Input name="name" placeholder="Front door" required /></Field>
            <Field label="Serial number" hint="Required for ZKTeco/eSSL. Shown under Menu > System info on the terminal."><Input name="serial" /></Field>
            <Field label="Branch">
              <Select name="branchId"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            </Field>
            <details className="rounded-md border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer text-slate-600">Connection settings (LAN pull, BioStar, Anviz)</summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Device IP" className="col-span-2"><Input name="ip" placeholder="192.168.1.201" /></Field>
                  <Field label="Port"><Input name="port" placeholder="4370" /></Field>
                </div>
                <Field label="API base URL"><Input name="baseUrl" placeholder="https://biostar.local" /></Field>
                <Field label="Username"><Input name="username" /></Field>
                <Field label="Password"><Input name="password" type="password" /></Field>
                <Field label="API key (Anviz)"><Input name="apiKey" /></Field>
                <Field label="API secret (Anviz)"><Input name="apiSecret" type="password" /></Field>
              </div>
            </details>
            <Button className="w-full">Add device</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
