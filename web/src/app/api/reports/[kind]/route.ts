import { audit } from "@/lib/audit";
import { buildReport, renderReport, resolveReport } from "@/lib/reports";
import { getCtx } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (ctx.suspended) return new Response("Organization suspended", { status: 403 });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  try {
    const { kind, format, params: p } = await resolveReport(ctx, { ...q, kind: (await params).kind });
    const file = await renderReport(await buildReport(ctx.db, kind, p), format, ctx.org.name);
    await audit(ctx, "export", "Report", null, { kind, format, ...p });
    return new Response(file.body, {
      headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Report failed", { status: 400 });
  }
}
