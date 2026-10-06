import { liveBus } from "@/lib/live";
import { getCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!["admin", "hr", "manager", "security"].includes(ctx.role)) return new Response("Forbidden", { status: 403 });

  const bus = liveBus();
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: { orgId?: string }) => {
        if (e.orgId === ctx.orgId) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      bus.on("event", send);
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", send);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
