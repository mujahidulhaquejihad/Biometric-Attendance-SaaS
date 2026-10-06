import { z } from "zod";
import { bearer } from "@/lib/device-auth";
import { sha256 } from "@/lib/crypto";
import { prisma, tenantDb } from "@/lib/db";
import { ingestPunches } from "@/lib/punches";
import { rateLimit } from "@/lib/ratelimit";
import { fromDbDate, toDbDate } from "@/lib/time";

export const dynamic = "force-dynamic";
const PAGE = 500;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function authenticate(req: Request) {
  const token = bearer(req);
  if (!token?.startsWith("ak_")) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: sha256(token) } });
  if (!key || key.revokedAt) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  const sub = await prisma.subscription.findUnique({ where: { organizationId: key.organizationId } });
  if (sub?.status === "SUSPENDED") return null;
  return key;
}

/** Keyset pagination on id: { data, next_cursor }. */
const page = <T extends { id: string }>(rows: T[], map: (r: T) => unknown) => ({
  data: rows.slice(0, PAGE).map(map),
  next_cursor: rows.length > PAGE ? rows[PAGE - 1].id : null,
});
const after = (cursor: string | null) => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});

async function handle(req: Request, params: Promise<{ path: string[] }>) {
  const key = await authenticate(req);
  if (!key) return json({ error: "invalid or revoked API key" }, 401);
  if (!rateLimit(`api:${key.id}`, 600)) return json({ error: "rate limit exceeded" }, 429);
  const db = tenantDb(key.organizationId);
  const resource = (await params).path.join("/");
  const q = new URL(req.url).searchParams;
  const cursor = q.get("cursor");

  try {
    if (req.method === "GET" && resource === "employees") {
      const active = q.get("active");
      const rows = await db.employee.findMany({
        where: active === null ? {} : { active: active === "true" },
        include: { department: true, designation: true, branch: true },
        orderBy: { id: "asc" },
        take: PAGE + 1,
        ...after(cursor),
      });
      return json(page(rows, (e) => ({
        id: e.id, code: e.code, name: e.name, email: e.email, phone: e.phone, active: e.active,
        department: e.department?.name ?? null, designation: e.designation?.name ?? null, branch: e.branch?.name ?? null,
        join_date: e.joinDate ? fromDbDate(e.joinDate) : null,
      })));
    }

    if (req.method === "GET" && resource === "punches") {
      const from = z.coerce.date().parse(q.get("from"));
      const to = z.coerce.date().parse(q.get("to") ?? new Date().toISOString());
      const rows = await db.punch.findMany({
        where: { timestamp: { gte: from, lt: to } },
        include: { device: { select: { name: true } } },
        orderBy: { id: "asc" },
        take: PAGE + 1,
        ...after(cursor),
      });
      return json(page(rows, (p) => ({
        id: p.id, employee_code: p.employeeCode, employee_id: p.employeeId, timestamp: p.timestamp.toISOString(),
        direction: p.direction, verify_mode: p.verifyMode, source: p.source, device: p.device?.name ?? null,
      })));
    }

    if (req.method === "GET" && resource === "attendance") {
      const from = DATE.parse(q.get("from"));
      const to = DATE.parse(q.get("to") ?? from);
      const code = q.get("employee_code");
      const rows = await db.attendanceDay.findMany({
        where: { date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(code ? { employee: { code } } : {}) },
        include: { employee: { select: { code: true } } },
        orderBy: { id: "asc" },
        take: PAGE + 1,
        ...after(cursor),
      });
      return json(page(rows, (d) => ({
        id: d.id, employee_code: d.employee.code, date: fromDbDate(d.date), status: d.status,
        first_in: d.firstIn?.toISOString() ?? null, last_out: d.lastOut?.toISOString() ?? null,
        worked_minutes: d.workedMinutes, late_minutes: d.lateMinutes, early_minutes: d.earlyMinutes, ot_minutes: d.otMinutes,
        missing_punch: d.missingPunch, locked: d.locked,
      })));
    }

    if (req.method === "POST" && resource === "punches") {
      const body = z.object({
        punches: z.array(z.object({
          employee_code: z.string().min(1).max(24),
          timestamp: z.string().datetime({ offset: true }),
          direction: z.enum(["IN", "OUT"]).optional(),
        })).min(1).max(1000),
      }).parse(await req.json());
      const accepted = await ingestPunches(
        { orgId: key.organizationId, deviceId: null, deviceName: `API: ${key.name}`, source: "API", note: `API key ${key.prefix}` },
        body.punches.map((p) => ({ employeeCode: p.employee_code, timestamp: new Date(p.timestamp), direction: p.direction ?? null, verifyMode: "API" })),
      );
      return json({ accepted, received: body.punches.length });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: e.issues[0].message, path: e.issues[0].path }, 400);
    if (e instanceof SyntaxError) return json({ error: "invalid JSON" }, 400);
    throw e;
  }
  return json({ error: "not found" }, 404);
}

export const GET = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
export const POST = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
