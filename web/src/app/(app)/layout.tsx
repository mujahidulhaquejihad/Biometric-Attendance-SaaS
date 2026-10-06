import {
  Bell, Building2, CalendarCheck, CalendarRange, ChartColumn, CheckCheck, ClipboardList, Clock, FileText, FileUp, Fingerprint,
  LayoutDashboard, Megaphone, PartyPopper, Plane, ScanLine, ScrollText, Settings, ShieldCheck, Sparkles, Users, Webhook, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { NavLink, SignOutButton } from "@/components/client";
import { prisma } from "@/lib/db";
import { getCtx, type Role } from "@/lib/session";

type NavItem = { href: string; label: string; icon: LucideIcon; roles: Role[] | "all" | "self" };
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/today", label: "Today", icon: LayoutDashboard, roles: ["admin", "hr"] },
      { href: "/team", label: "My team", icon: Users, roles: ["manager"] },
      { href: "/security", label: "Security desk", icon: ShieldCheck, roles: ["admin", "hr", "security"] },
      { href: "/approvals", label: "Approvals", icon: CheckCheck, roles: ["admin", "hr", "manager"] },
      { href: "/notices", label: "Notices", icon: Megaphone, roles: "all" },
    ],
  },
  {
    section: "Me",
    items: [
      { href: "/me", label: "My attendance", icon: CalendarCheck, roles: "self" },
      { href: "/me/requests", label: "My requests", icon: FileText, roles: "self" },
    ],
  },
  {
    section: "Attendance",
    items: [
      { href: "/attendance", label: "Daily attendance", icon: ClipboardList, roles: ["admin", "hr"] },
      { href: "/roster", label: "Roster", icon: CalendarRange, roles: ["admin", "hr"] },
      { href: "/reports", label: "Reports", icon: ChartColumn, roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    section: "People",
    items: [
      { href: "/employees", label: "Employees", icon: Users, roles: ["admin", "hr"] },
      { href: "/organization", label: "Branches & departments", icon: Building2, roles: ["admin", "hr"] },
      { href: "/enroll", label: "Fingerprint enrollment", icon: Fingerprint, roles: ["admin", "hr"] },
    ],
  },
  {
    section: "Setup",
    items: [
      { href: "/shifts", label: "Shifts", icon: Clock, roles: ["admin", "hr"] },
      { href: "/holidays", label: "Holidays", icon: PartyPopper, roles: ["admin", "hr"] },
      { href: "/leave-types", label: "Leave types", icon: Plane, roles: ["admin", "hr"] },
      { href: "/devices", label: "Devices", icon: ScanLine, roles: ["admin", "hr"] },
      { href: "/import", label: "Data migration", icon: FileUp, roles: ["admin", "hr"] },
      { href: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
      { href: "/developers", label: "API & webhooks", icon: Webhook, roles: ["admin"] },
      { href: "/audit", label: "Audit log", icon: ScrollText, roles: ["admin"] },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const unread = await prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } });
  const memberships = await prisma.member.count({ where: { userId: ctx.user.id } });
  const visible = (r: NavItem["roles"]) => (r === "all" ? true : r === "self" ? !!ctx.employee : r.includes(ctx.role));

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-64 shrink-0 flex-col overflow-hidden bg-gradient-to-b from-slate-900 to-[#1e1b4b] text-sm">
        <span aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-60 w-60 rounded-full bg-blue-500/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-60 w-60 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9 rounded-lg shadow-lg shadow-blue-500/30" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{ctx.org.name}</div>
            {(memberships > 1 || ctx.user.isSuperAdmin) ? (
              <Link href="/select-org" className="text-xs text-blue-300 hover:text-blue-200">Switch organization</Link>
            ) : (
              <div className="text-xs text-slate-400">Attendance</div>
            )}
          </div>
        </div>
        <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 pb-4 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
          {NAV.map((g) => {
            const items = g.items.filter((i) => visible(i.roles));
            if (!items.length) return null;
            return (
              <div key={g.section} className="space-y-0.5">
                <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.section}</div>
                {items.map((i) => <NavLink key={i.href} href={i.href}><i.icon aria-hidden />{i.label}</NavLink>)}
              </div>
            );
          })}
          {ctx.user.isSuperAdmin && (
            <Link href="/admin" className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-violet-300 transition hover:bg-violet-500/10 hover:text-violet-200">
              <Sparkles aria-hidden className="h-4 w-4" /> Platform admin
            </Link>
          )}
        </nav>
        <div className="relative space-y-0.5 border-t border-white/10 p-3">
          <NavLink href="/notifications">
            <Bell aria-hidden />Notifications {unread > 0 && <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span>}
          </NavLink>
          <Link href="/account" className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-white/5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-violet-500 text-xs font-semibold text-white shadow-md shadow-blue-500/30">
              {ctx.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-100">{ctx.user.name}</span>
              <span className="block text-xs capitalize text-slate-400">{ctx.role}</span>
            </span>
          </Link>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-7">
        {ctx.impersonating && (
          <div className="no-print mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800">
            Viewing this organization as platform admin. Actions are audited. <Link href="/admin" className="font-medium underline">Back to platform admin</Link>
          </div>
        )}
        {ctx.suspended ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
            This organization is suspended. Contact your provider to restore access.
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
