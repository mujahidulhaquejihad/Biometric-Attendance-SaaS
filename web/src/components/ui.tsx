import { Clock, Fingerprint, Hourglass, Plane, ShieldCheck, UserCheck, Users, UserX, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-xs transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 disabled:opacity-60";

const btnVariants = {
  primary: "bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700",
  secondary: "border border-slate-200 bg-white text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white shadow-sm shadow-red-600/20 hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/25 disabled:pointer-events-none disabled:opacity-50";

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof btnVariants }) {
  return <button className={cx(btnBase, btnVariants[variant], className)} {...p} />;
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: keyof typeof btnVariants }) {
  return <Link className={cx(btnBase, btnVariants[variant], className)} {...p} />;
}

export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cx(inputCls, className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => <textarea className={cx(inputCls, className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={cx(inputCls, className)} {...p} />;

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_-8px_rgba(15,23,42,0.08)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** `of` adds a share-of-total bar; `icon` defaults to the tone's usual meaning (green = present, red = absent…). */
export function Stat({ label, value, tone = "slate", href, icon: Icon = tones[tone].icon, of }: { label: string; value: ReactNode; tone?: keyof typeof tones; href?: string; icon?: LucideIcon; of?: number }) {
  const pct = of && typeof value === "number" ? Math.round((value / of) * 100) : null;
  const body = (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-md">
      <Icon aria-hidden className={cx("absolute -bottom-4 -right-4 h-24 w-24 opacity-[0.05] transition duration-300 group-hover:scale-110 group-hover:opacity-10", tones[tone].text)} />
      <div className="flex items-start justify-between gap-2">
        <div className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", tones[tone].chip)}>
          <Icon aria-hidden className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className={cx("mt-1 text-3xl font-bold tracking-tight tabular-nums", tones[tone].text)}>{value}</div>
      {pct !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={cx("h-full rounded-full", tones[tone].bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const tones = {
  slate: { bar: "bg-slate-400", text: "text-slate-900", chip: "from-slate-500 to-slate-700 shadow-slate-500/30", icon: Users },
  green: { bar: "bg-emerald-500", text: "text-emerald-600", chip: "from-emerald-400 to-emerald-600 shadow-emerald-500/30", icon: UserCheck },
  red: { bar: "bg-rose-500", text: "text-rose-600", chip: "from-rose-400 to-rose-600 shadow-rose-500/30", icon: UserX },
  amber: { bar: "bg-amber-500", text: "text-amber-600", chip: "from-amber-400 to-orange-500 shadow-amber-500/30", icon: Clock },
  blue: { bar: "bg-blue-500", text: "text-blue-600", chip: "from-blue-400 to-blue-600 shadow-blue-500/30", icon: Hourglass },
  violet: { bar: "bg-violet-500", text: "text-violet-600", chip: "from-violet-400 to-fuchsia-600 shadow-violet-500/30", icon: Plane },
};

/** Decorative fingerprint ridges; colour comes from `currentColor`. */
export function FingerprintArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" aria-hidden className={className}>
      {Array.from({ length: 8 }, (_, i) => {
        const r = 14 + i * 12;
        return <path key={i} d={`M${100 - r} ${150 + i * 4}V122a${r} ${r * 1.15} 0 0 1 ${2 * r} 0v${20 + i * 6}`} strokeDasharray={i % 3 ? `${50 + i * 14} 12` : undefined} />;
      })}
      <path d="M100 118v56" />
    </svg>
  );
}

const good = "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
const bad = "bg-rose-50 text-rose-700 ring-rose-600/20";
const warn = "bg-amber-50 text-amber-700 ring-amber-600/20";
const muted = "bg-slate-50 text-slate-600 ring-slate-500/20";
const badgeTones: Record<string, string> = {
  PRESENT: good, ACTIVE: good, APPROVED: good, DONE: good, IN: good, online: good,
  ABSENT: bad, REJECTED: bad, FAILED: bad, SUSPENDED: bad, offline: bad,
  HALF_DAY: warn, PENDING: warn, SENT: warn, PAST_DUE: warn,
  LEAVE: "bg-violet-50 text-violet-700 ring-violet-600/20", HOLIDAY: "bg-blue-50 text-blue-700 ring-blue-600/20",
  OUT: muted, WEEK_OFF: muted, DISABLED: muted, CANCELLED: muted,
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const key = tone ?? String(children);
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[key] ?? muted)}>
      {String(children).replace("_", " ")}
    </span>
  );
}

export function Table({ head, children, empty = "Nothing here yet." }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-5 py-2.5 font-semibold first:pl-5">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&_td]:px-5 [&_td]:py-3 [&_tr]:transition-colors [&_tr:hover]:bg-slate-50/70">
          {rows.length ? children : (
            <tr><td colSpan={head.length} className="py-10 text-center text-slate-400">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Row of inline filter/search controls submitted as GET. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2 [&>*]:min-w-36">
      {children}
      <Button variant="secondary" type="submit">Apply</Button>
    </form>
  );
}

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-[#1e1b4b] to-blue-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-blue-500/30 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9 rounded-lg" />
          Attendance
        </div>
        <div className="relative">
          <div className="relative mb-12 h-56 w-48">
            <FingerprintArt className="h-full w-full text-blue-300/60" />
            <span aria-hidden className="absolute inset-x-[-12px] top-2 h-0.5 rounded-full bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_18px_3px_rgba(103,232,249,0.55)] motion-safe:animate-scan" />
            <div aria-hidden className="absolute -right-44 bottom-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 shadow-2xl backdrop-blur-md">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300"><UserCheck className="h-5 w-5" /></span>
              <span className="text-sm">
                <span className="block font-medium">Clocked in · 08:57</span>
                <span className="block text-xs text-blue-200/80">Fingerprint · Main gate</span>
              </span>
            </div>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Attendance that runs itself.</h2>
          <p className="mt-3 max-w-md text-blue-100/80">Works with the fingerprint scanners you already have. Punches arrive live; shifts, lateness and overtime are worked out for you.</p>
          <ul className="mt-7 space-y-3 text-sm text-blue-50">
            {([
              [Fingerprint, "ZKTeco, eSSL, Hikvision, Suprema, Anviz and USB readers"],
              [Zap, "Live punch feed, late alerts and one-click approvals"],
              [ShieldCheck, "Encrypted fingerprints, audit log and two-factor sign-in"],
            ] as const).map(([I, t]) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15"><I aria-hidden className="h-4 w-4 text-cyan-200" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_#e0e7ff,_#f5f6fa_60%)] p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-12 w-12 rounded-xl shadow-lg shadow-blue-600/20 lg:hidden" />
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-xl shadow-slate-900/5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export const STATUS_CODE: Record<string, string> = {
  PRESENT: "P", ABSENT: "A", HALF_DAY: "HD", LEAVE: "L", HOLIDAY: "H", WEEK_OFF: "W",
};
export const STATUS_CELL: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-800", ABSENT: "bg-red-100 text-red-800", HALF_DAY: "bg-amber-100 text-amber-800",
  LEAVE: "bg-violet-100 text-violet-800", HOLIDAY: "bg-blue-100 text-blue-800", WEEK_OFF: "bg-slate-100 text-slate-500",
};
