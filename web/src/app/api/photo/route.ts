import { getCtx } from "@/lib/session";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!["admin", "hr", "security"].includes(ctx.role)) return new Response("Forbidden", { status: 403 });
  const q = new URL(req.url).searchParams;
  const ts = new Date(q.get("ts") ?? "");
  if (!q.get("device") || !q.get("code") || Number.isNaN(ts.getTime())) return new Response("Bad request", { status: 400 });
  const photo = await ctx.db.punchPhoto.findFirst({
    where: { deviceId: q.get("device")!, employeeCode: q.get("code")!, timestamp: { gte: new Date(ts.getTime() - 5000), lte: new Date(ts.getTime() + 5000) } },
  });
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
