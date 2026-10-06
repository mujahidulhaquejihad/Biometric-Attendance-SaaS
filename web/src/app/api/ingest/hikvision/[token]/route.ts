import { handleHikvision } from "@/lib/adapters/hikvision";
import { deviceByToken } from "@/lib/device-auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`hik:${clientIp(req)}`, 1200)) return new Response("rate limited", { status: 429 });
  const device = await deviceByToken((await params).token, ["HIKVISION"], req);
  if (!device) return new Response("unauthorized", { status: 401 });
  try {
    await handleHikvision(device, req);
    return new Response("OK");
  } catch (e) {
    console.error("[hikvision]", device.id, e);
    return new Response("error", { status: 500 });
  }
}
