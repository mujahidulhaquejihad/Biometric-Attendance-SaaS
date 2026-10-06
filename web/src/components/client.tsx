"use client";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

/** Sidebar link that highlights itself on its own route (and sub-routes). */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || (href !== "/me" && path.startsWith(href + "/"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${active ? "bg-gradient-to-r from-blue-500/30 to-blue-500/5 font-medium text-white ring-1 ring-inset ring-white/10 [&>svg]:text-blue-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-100 [&>svg]:text-slate-500 hover:[&>svg]:text-slate-300"}`}
    >
      {children}
    </Link>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
      }}
    >
      <LogOut aria-hidden className="h-4 w-4 text-slate-500" /> Sign out
    </button>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="no-print rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
      {label}
    </button>
  );
}

/** Submit button that asks for confirmation first. */
export function ConfirmButton({ message = "Are you sure?", className, ...p }: ComponentProps<"button"> & { message?: string }) {
  return (
    <button
      {...p}
      className={className ?? "rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    />
  );
}

export type ActionResult = { ok: boolean; message: string; details?: string[] } | null;

/** Form whose server action returns a result shown inline (instead of throwing to the error page). */
export function ActionForm({ action, children }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; children: ReactNode }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    // onSubmit instead of action={run}: React resets action forms afterwards, which would drop the chosen file between Preview and Import.
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(fd));
      }}
    >
      <fieldset disabled={pending} className="space-y-3">{children}</fieldset>
      <div role="status" aria-live="polite">
        {pending && <p className="text-sm text-slate-500">Working…</p>}
        {!pending && state && (
          <div className={`rounded-lg p-3 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            <p className="font-medium">{state.message}</p>
            {!!state.details?.length && (
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
                {state.details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

/** Clock in/out from a phone or browser; sends the device's GPS fix so the server can check the branch geofence. */
export function WebPunch({ action }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult> }) {
  const [state, run, pending] = useActionState(action, null);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState("");
  const punch = (direction: "IN" | "OUT") => {
    if (!navigator.geolocation) return setErr("This browser can't share its location.");
    setErr("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const fd = new FormData();
        fd.set("direction", direction);
        fd.set("lat", String(coords.latitude));
        fd.set("lng", String(coords.longitude));
        fd.set("accuracy", String(Math.round(coords.accuracy)));
        startTransition(() => run(fd));
      },
      (e) => {
        setLocating(false);
        setErr(e.code === e.PERMISSION_DENIED ? "Allow location access for this site to punch from this device." : "Couldn't get your location. Try again outdoors or near a window.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const busy = locating || pending;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button disabled={busy} onClick={() => punch("IN")} className="rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">Clock in</button>
        <button disabled={busy} onClick={() => punch("OUT")} className="rounded-xl bg-slate-800 py-4 text-base font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-50">Clock out</button>
      </div>
      <p role="status" aria-live="polite" className={`text-sm ${err || (state && !state.ok) ? "text-rose-700" : "text-emerald-700"}`}>
        {locating ? "Getting your location…" : pending ? "Saving…" : err || state?.message}
      </p>
    </div>
  );
}

/** The Windows bridge agent's local WebSocket (browsers allow ws://localhost from https pages). */
export const AGENT_WS = "ws://localhost:47800/ws";

/** Enroll one finger through the USB scanner attached to this PC via the bridge agent; on success, drops `?finger=` so the page moves to the next missing finger. */
export function AgentEnroll({ code, finger }: { code: string; finger: number }) {
  const router = useRouter();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [agent, setAgent] = useState<{ scanner: string; ready: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = new WebSocket(AGENT_WS);
    s.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.type === "hello") setAgent({ scanner: d.scanner, ready: d.ready });
      if (d.type === "progress") setMsg(`Place the finger on the scanner (${d.step} of ${d.of})…`);
      if (d.type === "enrolled") {
        setBusy(false);
        setMsg(d.ok ? "Fingerprint saved." : d.error ?? "Enrollment failed.");
        if (d.ok) {
          const next = new URL(location.href);
          next.searchParams.delete("finger");
          router.replace(next.pathname + next.search);
          router.refresh();
        }
      }
    };
    s.onclose = () => setAgent(null);
    setWs(s);
    return () => s.close();
  }, [router]);

  if (!agent) return <p className="text-sm text-slate-500">Bridge agent not detected on this PC. Install and start it, then reload.</p>;
  if (!agent.ready) return <p className="text-sm text-amber-700">Agent running, but no USB fingerprint scanner was found.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Scanner: {agent.scanner}</p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMsg("Starting…");
          ws?.send(JSON.stringify({ type: "enroll", code, finger }));
        }}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Scanning…" : "Scan with USB reader"}
      </button>
      <p role="status" className="text-sm">{msg}</p>
    </div>
  );
}

export type LiveEvent = {
  orgId: string;
  type: "punch";
  employeeName: string | null;
  employeeCode: string;
  deviceId: string | null;
  deviceName: string | null;
  timestamp: string;
  direction: string | null;
  verifyMode: string | null;
};

/** Live punch stream over Server-Sent Events. */
export function LiveFeed({ initial, photos = false, max = 30 }: { initial: LiveEvent[]; photos?: boolean; max?: number }) {
  const [events, setEvents] = useState(initial);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => setEvents((prev) => [JSON.parse(m.data) as LiveEvent, ...prev].slice(0, max));
    return () => es.close();
  }, [max]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-slate-300"}`} />
        {connected ? "Live" : "Connecting…"}
      </div>
      <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
        {events.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No punches yet today.</li>}
        {events.map((e, i) => (
          <li key={`${e.employeeCode}-${e.timestamp}-${i}`} className="flex items-center gap-3 py-2">
            {photos && e.deviceId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/photo?device=${e.deviceId}&code=${encodeURIComponent(e.employeeCode)}&ts=${encodeURIComponent(e.timestamp)}`}
                alt=""
                className="h-10 w-10 rounded-full bg-slate-100 object-cover"
                onError={(ev) => (ev.currentTarget.style.visibility = "hidden")}
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {(e.employeeName ?? e.employeeCode).slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{e.employeeName ?? `Unknown #${e.employeeCode}`}</div>
              <div className="text-xs text-slate-500">
                {e.deviceName ?? "Manual"} {e.verifyMode && `· ${e.verifyMode.toLowerCase()}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm tabular-nums">{new Date(e.timestamp).toLocaleTimeString()}</div>
              {e.direction && <div className={`text-xs ${e.direction === "IN" ? "text-green-600" : "text-slate-500"}`}>{e.direction}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
