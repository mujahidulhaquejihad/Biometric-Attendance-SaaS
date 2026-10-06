import { redirect } from "next/navigation";
import { getCtx } from "@/lib/session";

const HOME = { admin: "/today", hr: "/today", manager: "/team", employee: "/me", security: "/security" } as const;

export default async function Dashboard() {
  const ctx = await getCtx();
  redirect(HOME[ctx.role] ?? "/me");
}
