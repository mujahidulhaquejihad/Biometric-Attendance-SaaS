// ponytail: in-memory fixed window, per process. Fine for one container; move to Postgres/Redis when scaling out.
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    if (hits.size > 50_000) hits.clear();
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  return ++h.n <= max;
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
