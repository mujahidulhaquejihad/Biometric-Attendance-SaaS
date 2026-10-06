import { admsDevice, deviceCmdResult, getRequest, handshake, upload } from "@/lib/adapters/adms";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const endpoint = (await params).path[0]?.replace(/\.aspx$/i, "").toLowerCase();
  const url = new URL(req.url);
  const sn = url.searchParams.get("SN")?.trim();
  if (endpoint === "ping") return text("OK");
  if (!sn || sn.length > 64) return text("ERROR: missing SN", 400);
  if (!rateLimit(`adms:${sn}`, 600)) return text("ERROR: rate limited", 429);

  const { d, ok } = await admsDevice(sn, clientIp(req));
  // Unclaimed/disabled terminals keep polling; uploads are refused (not acked) so logs stay on the device until claimed.
  if (!ok) {
    if (endpoint === "cdata" && req.method === "GET") return text(handshake(d));
    if (endpoint === "cdata") return text("ERROR: device not approved", 503);
    return text("OK");
  }

  try {
    if (endpoint === "cdata") {
      if (req.method === "GET") return text(handshake(d));
      const body = Buffer.from(await req.arrayBuffer());
      return text(await upload(d, (url.searchParams.get("table") ?? "").toUpperCase(), url.searchParams.get("Stamp"), body));
    }
    if (endpoint === "getrequest") return text(await getRequest(d, url.searchParams.get("INFO")));
    if (endpoint === "devicecmd") return text(await deviceCmdResult(d, await req.text()));
    return text("OK");
  } catch (e) {
    console.error("[adms]", sn, e);
    return text("ERROR", 500);
  }
}

export { handle as GET, handle as POST };
