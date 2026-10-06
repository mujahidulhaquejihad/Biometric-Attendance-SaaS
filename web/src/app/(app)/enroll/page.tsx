import { Fingerprint, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AgentEnroll, ConfirmButton } from "@/components/client";
import { Button, Card, Field, FingerprintArt, Input, LinkButton, PageHeader, Select, Stat } from "@/components/ui";
import { FINGERS } from "@/lib/device-meta";
import { HR, requireRole } from "@/lib/session";
import { enrollOnTerminal, recordConsent, removeFinger } from "../employees/actions";

export const metadata = { title: "Fingerprint enrollment" };

/** Order the page suggests fingers in: indexes, thumbs and middles read most reliably on terminals. */
const SUGGESTED = [6, 3, 5, 4, 7, 2, 8, 1, 9, 0];
/** Finger heights (px) for the hand drawing, in FID order: left little → right little. */
const HEIGHT = [52, 72, 84, 74, 46, 46, 74, 84, 72, 52];

type SP = { employee?: string; finger?: string; q?: string; show?: string };

export default async function EnrollPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireRole(HR);
  // ponytail: loads every active employee and template row (metadata only) for the list and counts; fine to a few thousand staff, paginate beyond that.
  const [employees, prints] = await Promise.all([
    ctx.db.employee.findMany({ where: { active: true }, select: { id: true, code: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
    ctx.db.biometricTemplate.findMany({ where: { employee: { active: true } }, select: { employeeId: true, finger: true, format: true, createdAt: true } }),
  ]);
  const byEmp = new Map<string, Set<number>>();
  for (const p of prints) byEmp.set(p.employeeId, (byEmp.get(p.employeeId) ?? new Set()).add(p.finger));
  const count = (id: string) => byEmp.get(id)?.size ?? 0;
  const missing = employees.filter((x) => !count(x.id)).length;
  const single = employees.filter((x) => count(x.id) === 1).length;

  const q = sp.q?.trim().toLowerCase() ?? "";
  const show = sp.show === "missing" || sp.show === "one" ? sp.show : "all";
  const list = employees.filter(
    (x) => (!q || x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q)) && (show === "all" || (show === "missing" ? !count(x.id) : count(x.id) === 1)),
  );
  const href = (p: SP) => `/enroll?${new URLSearchParams(Object.entries({ q: sp.q, show: sp.show, employee: sp.employee, ...p }).filter((kv): kv is [string, string] => !!kv[1]))}`;

  const e = sp.employee ? employees.find((x) => x.id === sp.employee) : undefined;
  const have = (e && byEmp.get(e.id)) || new Set<number>();
  const finger = sp.finger && /^\d$/.test(sp.finger) ? +sp.finger : SUGGESTED.find((f) => !have.has(f)) ?? 6;
  const current = e ? prints.filter((p) => p.employeeId === e.id && p.finger === finger) : [];
  const [consent, terminals] = e
    ? await Promise.all([
        ctx.db.consent.findFirst({ where: { employeeId: e.id, revokedAt: null } }),
        ctx.db.device.findMany({ where: { vendor: "ZKTECO_ADMS", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
    : [null, []];

  return (
    <>
      <PageHeader
        title="Fingerprint enrollment"
        description="Pick a person, tap a finger, scan. Scanning a finger again replaces it everywhere."
        actions={<LinkButton href="/kiosk" target="_blank">Open kiosk</LinkButton>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Enrolled" value={employees.length - missing} tone="green" of={employees.length} icon={Fingerprint} href={href({ show: undefined })} />
        <Stat label="Only one finger" value={single} tone="amber" icon={TriangleAlert} href={href({ show: "one" })} />
        <Stat label="No fingerprints" value={missing} tone="red" href={href({ show: "missing" })} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="Employees" className="lg:sticky lg:top-6 lg:self-start">
          <form className="mb-3 flex gap-2">
            {show !== "all" && <input type="hidden" name="show" value={show} />}
            <Input name="q" defaultValue={sp.q} placeholder="Search name or code" aria-label="Search employees" />
            <Button variant="secondary" aria-label="Search"><Search aria-hidden className="h-4 w-4" /></Button>
          </form>
          <nav aria-label="Filter" className="mb-3 flex gap-1 text-xs font-medium">
            {([["all", `All (${employees.length})`], ["missing", `Missing (${missing})`], ["one", `One finger (${single})`]] as const).map(([k, label]) => (
              <Link
                key={k}
                href={href({ show: k === "all" ? undefined : k })}
                aria-current={show === k ? "page" : undefined}
                className={`rounded-full px-2.5 py-1 transition ${show === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <ul className="-mx-2 max-h-[60vh] space-y-0.5 overflow-y-auto">
            {list.map((x) => {
              const n = count(x.id);
              return (
                <li key={x.id}>
                  <Link
                    href={href({ employee: x.id })}
                    aria-current={x.id === e?.id ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${x.id === e?.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : "hover:bg-slate-50"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.name}</span>
                      <span className="block truncate text-xs text-slate-500">{x.code}{x.department && ` · ${x.department.name}`}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${n === 0 ? "bg-rose-50 text-rose-700" : n === 1 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {n === 0 ? "None" : `${n} finger${n > 1 ? "s" : ""}`}
                    </span>
                  </Link>
                </li>
              );
            })}
            {!list.length && <li className="py-6 text-center text-sm text-slate-400">No matches.</li>}
          </ul>
        </Card>

        <div className="space-y-6">
          {!e ? (
            <Card>
              <div className="flex flex-col items-center py-12 text-center">
                <FingerprintArt className="h-32 w-28 text-blue-200" />
                <p className="mt-4 font-medium">Choose an employee</p>
                <p className="mt-1 text-sm text-slate-500">Tip: the &quot;Missing&quot; filter lists everyone who can&apos;t punch with a finger yet.</p>
              </div>
            </Card>
          ) : !consent ? (
            <Card title={`${e.name}: consent first`} className="max-w-lg">
              <form action={recordConsent} className="space-y-3">
                <input type="hidden" name="employeeId" value={e.id} />
                <p className="text-sm text-slate-600">
                  {e.name} agrees that a mathematical template of their fingerprint is stored to record attendance, kept encrypted,
                  never shared, and deleted when they leave or ask for erasure.
                </p>
                <Field label="Employee's full name as signature"><Input name="signedName" required /></Field>
                <Button>Record consent</Button>
              </form>
            </Card>
          ) : (
            <>
              <Card title={`${e.name} (${e.code})`} actions={<Link href={`/employees/${e.id}`} className="text-sm text-blue-600 hover:underline">Open profile</Link>}>
                <p className="mb-6 text-sm text-slate-500">
                  {have.size ? `${have.size} of 10 fingers enrolled.` : "No fingers enrolled yet."} Tap a finger to scan, re-scan or remove it.
                  Enroll at least one finger on each hand.
                </p>
                <div className="flex flex-wrap justify-center gap-x-14 gap-y-8 pb-2">
                  <Hand label="Left hand" fids={[0, 1, 2, 3, 4]} have={have} selected={finger} href={(f) => href({ finger: String(f) })} />
                  <Hand label="Right hand" fids={[5, 6, 7, 8, 9]} have={have} selected={finger} href={(f) => href({ finger: String(f) })} />
                </div>
              </Card>
              <div className="grid gap-6 md:grid-cols-2">
                <Card title={`USB reader · ${FINGERS[finger]}`}>
                  <AgentEnroll code={e.code} finger={finger} />
                </Card>
                <Card title={`Wall terminal · ${FINGERS[finger]}`}>
                  {terminals.length ? (
                    <form action={enrollOnTerminal} className="space-y-3">
                      <input type="hidden" name="employeeId" value={e.id} />
                      <input type="hidden" name="finger" value={finger} />
                      <Field label="Terminal" hint="The terminal shows its enrollment screen within a minute; the finger syncs to other branch terminals automatically.">
                        <Select name="deviceId">{terminals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                      </Field>
                      <Button>Start on terminal</Button>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-500">No active push (ADMS) terminals.</p>
                  )}
                </Card>
              </div>
              {current.length > 0 && (
                <Card title={`${FINGERS[finger]} is enrolled`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">
                      Saved {current[0].createdAt.toLocaleDateString()} ({current.map((c) => c.format).join(", ")}). Scanning again replaces it.
                      If the finger is injured or keeps failing, remove it and enroll another.
                    </p>
                    <form action={removeFinger}>
                      <input type="hidden" name="employeeId" value={e.id} />
                      <input type="hidden" name="finger" value={finger} />
                      <ConfirmButton message={`Remove ${e.name}'s ${FINGERS[finger].toLowerCase()} finger from the system and all terminals?`}>Remove finger</ConfirmButton>
                    </form>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Hand({ label, fids, have, selected, href }: { label: string; fids: number[]; have: Set<number>; selected: number; href: (f: number) => string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-2">
        {fids.map((f) => {
          const on = have.has(f);
          const thumb = f === 4 || f === 5;
          return (
            <Link
              key={f}
              href={href(f)}
              title={FINGERS[f]}
              aria-label={`${FINGERS[f]}, ${on ? "enrolled" : "not enrolled"}`}
              aria-current={f === selected ? "true" : undefined}
              style={{ height: HEIGHT[f] }}
              className={[
                "relative z-10 flex w-10 items-start justify-center rounded-b-md rounded-t-full pt-2.5 transition hover:-translate-y-1",
                on
                  ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-500/30"
                  : "border-2 border-dashed border-slate-300 bg-white text-slate-300 hover:border-blue-400 hover:text-blue-500",
                f === selected && "ring-4 ring-blue-500/40 ring-offset-2",
                thumb && (f === 4 ? "translate-y-5 rotate-[24deg]" : "translate-y-5 -rotate-[24deg]"),
              ].filter(Boolean).join(" ")}
            >
              <Fingerprint aria-hidden className="h-5 w-5" />
            </Link>
          );
        })}
      </div>
      <div className="mt-1 flex h-16 w-60 items-center justify-center rounded-b-[2.5rem] rounded-t-xl bg-gradient-to-b from-slate-100 to-slate-200/70 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
