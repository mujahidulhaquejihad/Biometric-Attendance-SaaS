import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { STATUS_CODE } from "@/components/ui";
import { toCsv } from "./csv";
import { tenantDb, type TenantDb } from "./db";
import { sendMail } from "./mail";
import { PAYROLL_FIELDS, REPORTS, type ReportKind } from "./reports-meta";
import { APPROVERS, type Ctx } from "./session";
import { addDays, dayOfWeek, daysBetween, fromDbDate, localDate, localTime, monthRange, toDbDate, zonedToUtc } from "./time";

type Cell = string | number | null;
export type Report = { title: string; subtitle: string; columns: string[]; rows: Cell[][] };
export const FORMATS = ["csv", "xlsx", "pdf"] as const;
export type Format = (typeof FORMATS)[number];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().optional());
export const reportParams = z
  .object({ from: DATE, to: DATE, employeeId: id, departmentId: id, branchId: id, managerId: id })
  .refine((p) => p.from <= p.to && daysBetween(p.from, p.to).length <= 366, "Pick a range of at most one year.");
export type ReportParams = z.infer<typeof reportParams>;

const hours = (min: number) => Math.round((min / 60) * 100) / 100;

/** Parse a report request (query string) for the signed-in user; managers are pinned to their direct reports. */
export async function resolveReport(ctx: Ctx, q: Record<string, string | undefined>) {
  if (!APPROVERS.includes(ctx.role)) throw new Error("You do not have access to reports.");
  if (ctx.role === "manager" && !ctx.employee) throw new Error("Your login is not linked to an employee record.");
  const kind = (q.kind && q.kind in REPORTS ? q.kind : "daily") as ReportKind;
  const format: Format = FORMATS.includes(q.format as Format) ? (q.format as Format) : "csv";
  const tz = (await ctx.db.orgSettings.findFirst())?.timezone ?? "UTC";
  const today = localDate(new Date(), tz);
  const params = reportParams.parse({
    from: q.from || `${today.slice(0, 7)}-01`,
    to: q.to || today,
    employeeId: q.employee,
    departmentId: q.dept,
    branchId: q.branch,
    managerId: ctx.role === "manager" ? ctx.employee!.id : q.manager,
  });
  return { kind, format, params };
}

export async function buildReport(db: TenantDb, kind: ReportKind, p: ReportParams): Promise<Report> {
  const settings = await db.orgSettings.findFirst();
  const orgTz = settings?.timezone ?? "UTC";
  const tzOf = (e: { branch: { timezone: string | null } | null }) => e.branch?.timezone ?? orgTz;
  // Prisma ignores undefined keys, so unset filters simply drop out.
  const emp = { id: p.employeeId, departmentId: p.departmentId, branchId: p.branchId, managerId: p.managerId };
  const filtered = Object.values(emp).some(Boolean);
  const range = { gte: toDbDate(p.from), lte: toDbDate(p.to) };
  const include = { department: true, designation: true, branch: true } as const;
  const base = { title: REPORTS[kind], subtitle: p.from === p.to ? p.from : `${p.from} to ${p.to}` };

  const days = (extra: object = {}) =>
    db.attendanceDay.findMany({
      where: { date: range, employee: emp, ...extra },
      include: { employee: { include } },
      orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
    });

  switch (kind) {
    case "daily": {
      const rows = await days();
      return {
        ...base,
        columns: ["Date", "Code", "Name", "Department", "Status", "In", "Out", "Worked (h)", "Late (min)", "Early (min)", "OT (h)", "Missing punch"],
        rows: rows.map((d) => [
          fromDbDate(d.date), d.employee.code, d.employee.name, d.employee.department?.name ?? null, d.status,
          localTime(d.firstIn, tzOf(d.employee)), localTime(d.lastOut, tzOf(d.employee)),
          hours(d.workedMinutes), d.lateMinutes, d.earlyMinutes, hours(d.otMinutes), d.missingPunch ? "Yes" : "",
        ]),
      };
    }
    case "late":
    case "early": {
      const late = kind === "late";
      const rows = await days(late ? { lateMinutes: { gt: 0 } } : { earlyMinutes: { gt: 0 } });
      return {
        ...base,
        columns: ["Date", "Code", "Name", "Department", late ? "In" : "Out", late ? "Late (min)" : "Early (min)"],
        rows: rows.map((d) => [
          fromDbDate(d.date), d.employee.code, d.employee.name, d.employee.department?.name ?? null,
          localTime(late ? d.firstIn : d.lastOut, tzOf(d.employee)), late ? d.lateMinutes : d.earlyMinutes,
        ]),
      };
    }
    case "absent": {
      const rows = await days({ status: "ABSENT" });
      return {
        ...base,
        columns: ["Date", "Code", "Name", "Department", "Phone"],
        rows: rows.map((d) => [fromDbDate(d.date), d.employee.code, d.employee.name, d.employee.department?.name ?? null, d.employee.phone]),
      };
    }
    case "overtime": {
      const rows = await days({ otMinutes: { gt: 0 } });
      return {
        ...base,
        columns: ["Date", "Code", "Name", "Department", "Worked (h)", "OT (h)"],
        rows: rows.map((d) => [fromDbDate(d.date), d.employee.code, d.employee.name, d.employee.department?.name ?? null, hours(d.workedMinutes), hours(d.otMinutes)]),
      };
    }
    case "muster": {
      const dates = daysBetween(p.from, p.to);
      if (dates.length > 62) throw new Error("The muster roll covers at most 62 days.");
      const [emps, rows] = await Promise.all([
        db.employee.findMany({ where: { ...emp, OR: [{ active: true }, { days: { some: { date: range } } }] }, orderBy: { name: "asc" } }),
        db.attendanceDay.findMany({ where: { date: range, employee: emp }, select: { employeeId: true, date: true, status: true } }),
      ]);
      const cell = new Map(rows.map((r) => [`${r.employeeId}|${fromDbDate(r.date)}`, r.status]));
      return {
        ...base,
        columns: ["Code", "Name", ...dates.map((d) => d.slice(8)), "P", "HD", "A", "L"],
        rows: emps.map((e) => {
          const s = dates.map((d) => cell.get(`${e.id}|${d}`));
          const n = (x: string) => s.filter((v) => v === x).length;
          return [e.code, e.name, ...s.map((v) => (v ? STATUS_CODE[v] : "")), n("PRESENT"), n("HALF_DAY"), n("ABSENT"), n("LEAVE")];
        }),
      };
    }
    case "leave": {
      const rows = await db.leaveRequest.findMany({
        where: { fromDate: { lte: range.lte }, toDate: { gte: range.gte }, employee: emp },
        include: { employee: true, leaveType: true },
        orderBy: { fromDate: "asc" },
      });
      return {
        ...base,
        columns: ["Code", "Name", "Type", "From", "To", "Days", "Status", "Reason"],
        rows: rows.map((l) => [l.employee.code, l.employee.name, l.leaveType.name, fromDbDate(l.fromDate), fromDbDate(l.toDate), l.days, l.status, l.reason]),
      };
    }
    case "dept": {
      const rows = await days();
      const agg = new Map<string, { emps: Set<string>; present: number; absent: number; leave: number; worked: number; ot: number; late: number }>();
      for (const d of rows) {
        const k = d.employee.department?.name ?? "Unassigned";
        const a = agg.get(k) ?? { emps: new Set(), present: 0, absent: 0, leave: 0, worked: 0, ot: 0, late: 0 };
        agg.set(k, a);
        a.emps.add(d.employeeId);
        a.present += d.status === "PRESENT" ? 1 : d.status === "HALF_DAY" ? 0.5 : 0;
        a.absent += d.status === "ABSENT" ? 1 : 0;
        a.leave += d.status === "LEAVE" ? 1 : 0;
        a.worked += d.workedMinutes;
        a.ot += d.otMinutes;
        a.late += d.lateMinutes > 0 ? 1 : 0;
      }
      return {
        ...base,
        columns: ["Department", "Employees", "Present days", "Absent days", "Leave days", "Worked (h)", "OT (h)", "Late arrivals"],
        rows: [...agg.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, a]) => [k, a.emps.size, a.present, a.absent, a.leave, hours(a.worked), hours(a.ot), a.late]),
      };
    }
    case "punches": {
      // ponytail: capped at 50k rows; page through the REST API for bigger exports.
      const rows = await db.punch.findMany({
        where: { timestamp: { gte: zonedToUtc(p.from, "00:00", orgTz), lt: zonedToUtc(addDays(p.to, 1), "00:00", orgTz) }, ...(filtered ? { employee: emp } : {}) },
        include: { employee: { include }, device: true },
        orderBy: { timestamp: "asc" },
        take: 50_000,
      });
      return {
        ...base,
        columns: ["Date", "Time", "Code", "Name", "Device", "Verify", "Direction", "Source", "Note"],
        rows: rows.map((x) => {
          const tz = x.employee ? tzOf(x.employee) : orgTz;
          return [localDate(x.timestamp, tz), localTime(x.timestamp, tz), x.employeeCode, x.employee?.name ?? "Unknown", x.device?.name ?? null, x.verifyMode, x.direction, x.source, x.note];
        }),
      };
    }
    case "payroll":
      return { ...base, ...(await payroll(db, emp, range, settings)) };
    case "employees": {
      const rows = await db.employee.findMany({ where: emp, include: { ...include, manager: true, defaultShift: true }, orderBy: { name: "asc" } });
      return {
        title: REPORTS.employees,
        subtitle: `${rows.length} employees`,
        columns: ["Code", "Name", "Email", "Phone", "Department", "Designation", "Branch", "Reports to", "Shift", "Join date", "Active"],
        rows: rows.map((e) => [
          e.code, e.name, e.email, e.phone, e.department?.name ?? null, e.designation?.name ?? null, e.branch?.name ?? null,
          e.manager?.name ?? null, e.defaultShift?.name ?? null, e.joinDate ? fromDbDate(e.joinDate) : null, e.active ? "Yes" : "No",
        ]),
      };
    }
  }
}

async function payroll(
  db: TenantDb,
  emp: { id?: string; departmentId?: string; branchId?: string; managerId?: string },
  range: { gte: Date; lte: Date },
  settings: { otRequiresApproval: boolean; payrollColumns: unknown } | null,
) {
  const [emps, days, leaves, approvedOt] = await Promise.all([
    db.employee.findMany({ where: { ...emp, OR: [{ active: true }, { days: { some: { date: range } } }] }, include: { department: true, designation: true, branch: true }, orderBy: { name: "asc" } }),
    db.attendanceDay.findMany({ where: { date: range, employee: emp } }),
    db.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: range.lte }, toDate: { gte: range.gte }, employee: emp }, include: { leaveType: true } }),
    settings?.otRequiresApproval ? db.overtimeRequest.findMany({ where: { status: "APPROVED", date: range, employee: emp } }) : Promise.resolve(null),
  ]);

  const byEmp = Map.groupBy(days, (d) => d.employeeId);
  const values = emps.map((e) => {
    const v = { presentDays: 0, halfDays: 0, absentDays: 0, leaveDays: 0, paidLeaveDays: 0, holidays: 0, weekOffs: 0, payableDays: 0, worked: 0, lateCount: 0, lateMinutes: 0, earlyMinutes: 0, ot: 0 };
    for (const d of byEmp.get(e.id) ?? []) {
      const date = fromDbDate(d.date);
      const leave = leaves.find((l) => l.employeeId === e.id && fromDbDate(l.fromDate) <= date && fromDbDate(l.toDate) >= date);
      const leaveCredit = leave ? (leave.halfDay ? 0.5 : 1) : 0;
      const attendCredit = { PRESENT: 1, HALF_DAY: 0.5, HOLIDAY: 1, WEEK_OFF: 1, LEAVE: 0, ABSENT: 0 }[d.status];
      if (d.status === "PRESENT") v.presentDays++;
      if (d.status === "HALF_DAY") v.halfDays++;
      if (d.status === "ABSENT") v.absentDays++;
      if (d.status === "HOLIDAY") v.holidays++;
      if (d.status === "WEEK_OFF") v.weekOffs++;
      v.leaveDays += leaveCredit;
      if (leave?.leaveType.paid) v.paidLeaveDays += leaveCredit;
      // A half-day leave on a worked half day makes one full payable day, never more.
      v.payableDays += Math.min(1, attendCredit + (leave?.leaveType.paid ? leaveCredit : 0));
      v.worked += d.workedMinutes;
      v.lateCount += d.lateMinutes > 0 ? 1 : 0;
      v.lateMinutes += d.lateMinutes;
      v.earlyMinutes += d.earlyMinutes;
      v.ot += d.otMinutes;
    }
    if (approvedOt) v.ot = approvedOt.filter((o) => o.employeeId === e.id).reduce((s, o) => s + o.minutes, 0);
    const out: Record<keyof typeof PAYROLL_FIELDS, Cell> = {
      code: e.code, name: e.name, department: e.department?.name ?? null, designation: e.designation?.name ?? null, branch: e.branch?.name ?? null,
      presentDays: v.presentDays, halfDays: v.halfDays, absentDays: v.absentDays, leaveDays: v.leaveDays, paidLeaveDays: v.paidLeaveDays,
      holidays: v.holidays, weekOffs: v.weekOffs, payableDays: v.payableDays, workedHours: hours(v.worked), lateCount: v.lateCount,
      lateMinutes: v.lateMinutes, earlyMinutes: v.earlyMinutes, otHours: hours(v.ot),
    };
    return out;
  });

  const mapping = (settings?.payrollColumns as Record<string, keyof typeof PAYROLL_FIELDS> | null) ??
    Object.fromEntries(Object.entries(PAYROLL_FIELDS).map(([k, label]) => [label, k as keyof typeof PAYROLL_FIELDS]));
  return { columns: Object.keys(mapping), rows: values.map((v) => Object.values(mapping).map((k) => v[k] ?? null)) };
}

// ---------- Rendering ----------

const pdf = StyleSheet.create({
  page: { padding: 24, fontSize: 7, fontFamily: "Helvetica" },
  title: { fontSize: 14, marginBottom: 2 },
  sub: { fontSize: 9, color: "#64748b", marginBottom: 10 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 2 },
  head: { fontFamily: "Helvetica-Bold", backgroundColor: "#f1f5f9" },
  cell: { flex: 1, paddingHorizontal: 2 },
});

function ReportPdf({ r, org }: { r: Report; org: string }) {
  const narrow = r.columns.length > 20;
  return (
    <Document title={r.title}>
      <Page size="A4" orientation="landscape" style={pdf.page}>
        <Text style={pdf.title}>{r.title}</Text>
        <Text style={pdf.sub}>{org} · {r.subtitle}</Text>
        <View style={[pdf.row, pdf.head]} fixed>
          {r.columns.map((c, i) => <Text key={i} style={[pdf.cell, narrow && i > 1 ? { flex: 0.35 } : {}]}>{c}</Text>)}
        </View>
        {r.rows.map((row, i) => (
          <View key={i} style={pdf.row} wrap={false}>
            {row.map((c, j) => <Text key={j} style={[pdf.cell, narrow && j > 1 ? { flex: 0.35 } : {}]}>{c ?? ""}</Text>)}
          </View>
        ))}
        <Text style={{ position: "absolute", bottom: 12, right: 24, fontSize: 7, color: "#94a3b8" }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function renderReport(r: Report, format: Format, org: string) {
  const name = `${r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${r.subtitle.replace(/[^0-9a-z-]+/gi, "_")}`;
  if (format === "csv") {
    return { body: new TextEncoder().encode("\uFEFF" + toCsv(r.columns, r.rows)), type: "text/csv; charset=utf-8", filename: `${name}.csv` };
  }
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(r.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = r.columns.map((header) => ({ header, width: Math.min(40, Math.max(6, header.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(r.rows);
    return { body: new Uint8Array(await wb.xlsx.writeBuffer()), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${name}.xlsx` };
  }
  // ponytail: PDF renders in-process; very large ranges are slow. Use XLSX for anything over a few thousand rows.
  if (r.rows.length > 5000) throw new Error("Too many rows for PDF. Narrow the range or export XLSX.");
  return { body: new Uint8Array(await renderToBuffer(<ReportPdf r={r} org={org} />)), type: "application/pdf", filename: `${name}.pdf` };
}

/** Called hourly per org: emails every schedule whose hour (org-local) has come. */
export async function runScheduledReports(orgId: string, tz: string, hour: number) {
  const db = tenantDb(orgId);
  const schedules = await db.reportSchedule.findMany({ where: { hour } });
  if (!schedules.length) return;
  const org = await db.organization.findUnique({ where: { id: orgId } });
  const today = localDate(new Date(), tz);
  const yesterday = addDays(today, -1);
  for (const s of schedules) {
    if (s.frequency === "WEEKLY" && dayOfWeek(today) !== 1) continue;
    if (s.frequency === "MONTHLY" && !today.endsWith("-01")) continue;
    if (s.lastSentAt && Date.now() - s.lastSentAt.getTime() < 6 * 3600_000) continue; // pg-boss retry or DST repeat
    const range =
      s.frequency === "DAILY" ? { from: yesterday, to: yesterday }
      : s.frequency === "WEEKLY" ? { from: addDays(today, -7), to: yesterday }
      : monthRange(yesterday.slice(0, 7));
    try {
      const r = await buildReport(db, s.kind as ReportKind, reportParams.parse(range));
      const file = await renderReport(r, s.format as Format, org?.name ?? "");
      await sendMail({
        to: s.recipients,
        subject: `${r.title} · ${r.subtitle}`,
        text: `Attached: ${r.title} for ${org?.name} (${r.subtitle}), ${r.rows.length} rows.`,
        attachments: [{ filename: file.filename, content: Buffer.from(file.body) }],
      });
      await db.reportSchedule.update({ where: { id: s.id }, data: { lastSentAt: new Date() } });
    } catch (e) {
      console.error(`[reports] schedule ${s.id} failed`, e);
    }
  }
}
