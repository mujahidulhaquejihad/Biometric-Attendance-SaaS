/** Readers for exports from other attendance systems (ZKTime, ZKBioTime, eTimeTrackLite, BioStar, plain Excel). */
import type { Direction } from "@prisma/client";
import { parseCsv } from "./csv.ts";

/** Normalised header names (lowercase, letters/digits only) seen in common exports. Earlier aliases win. */
export const ALIASES = {
  code: ["code", "employeecode", "empcode", "employeeid", "empid", "employeeno", "empno", "staffid", "staffno", "pin", "userid", "enrollid", "enrollno", "enrollnumber", "badgenumber", "badgeno", "acno", "personnelid", "personid", "cardno", "id", "no"],
  name: ["name", "employeename", "empname", "fullname", "staffname", "username", "firstname"],
  lastName: ["lastname", "surname"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "mobile", "mobileno", "phoneno", "contact", "contactno", "cellphone"],
  branch: ["branch", "location", "site", "office", "area"],
  department: ["department", "dept", "deptname", "departmentname", "division", "section"],
  designation: ["designation", "position", "jobtitle", "title", "grade"],
  shift: ["shift", "shiftname", "schedule", "timetable"],
  joinDate: ["joindate", "joiningdate", "dateofjoining", "doj", "hiredate", "startdate"],
  birthDate: ["birthdate", "dateofbirth", "dob", "birthday"],
  datetime: ["datetime", "timestamp", "punchtime", "punchdatetime", "checktime", "logtime", "logdate", "verifytime", "recordtime", "attendancetime"],
  date: ["date", "punchdate", "attdate", "attendancedate", "workdate"],
  time: ["time", "clocktime"],
  direction: ["direction", "inout", "punchstate", "state", "checktype", "punchtype", "attstate", "status", "type"],
  leaveType: ["leavetype", "leavecode", "leavename", "leave", "type"],
  balance: ["balance", "available", "remaining", "closingbalance", "openingbalance", "days"],
  year: ["year"],
  holiday: ["holiday", "holidayname", "name", "description", "occasion"],
} satisfies Record<string, string[]>;
export type Field = keyof typeof ALIASES;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapColumns<F extends Field>(header: string[], fields: readonly F[]) {
  const h = header.map(norm);
  const used = new Set<number>();
  const idx = {} as Record<F, number>;
  for (const f of fields) {
    idx[f] = -1;
    for (const a of ALIASES[f]) {
      const i = h.findIndex((x, j) => x === a && !used.has(j));
      if (i >= 0) {
        idx[f] = i;
        used.add(i);
        break;
      }
    }
  }
  return idx;
}

/** Header row -> per-row getter by field name. Throws listing the columns it saw when a required one is missing. */
export function records<F extends Field>(table: string[][], fields: readonly F[], required: readonly F[]) {
  const [header = [], ...rows] = table;
  const c = mapColumns(header, fields);
  const missing = required.filter((f) => c[f] < 0);
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}. Columns found: ${header.join(", ") || "none"}.`);
  return rows.map((r, i) => ({ line: i + 2, get: (f: F) => (c[f] >= 0 ? (r[c[f]] ?? "").trim() : "") }));
}

export type DateOrder = "ymd" | "dmy" | "mdy";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "2024-01-15 09:05", "15/01/2024 9:05 PM", "15-Jan-2024 09:05:00", "2024-01-15" -> parts, or null if unreadable. */
export function parseDateTime(raw: string, order: DateOrder = "ymd"): { date: string; time: string | null } | null {
  const s = raw.trim().replace(/^(\d{1,2})[- /]([a-z]{3})[a-z]*\.?[- /,]+(\d{2,4})/i, (all, d, mon, y) => {
    const i = MONTHS.indexOf(mon.toLowerCase());
    return i < 0 ? all : `${y.length === 2 ? "20" + y : y}-${i + 1}-${d}`;
  });
  const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap])?\.?m?\.?)?$/i);
  if (!m) return null;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  let y: number, mo: number, d: number;
  if (m[1].length === 4) [y, mo, d] = [a, b, c];
  else {
    [d, mo] = order === "mdy" ? [b, a] : [a, b];
    y = c < 100 ? 2000 + c : c;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  const date = dt.toISOString().slice(0, 10);
  if (!m[4]) return { date, time: null };
  let h = +m[4];
  const ap = m[7]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "p" ? 12 : 0);
  }
  const mi = +m[5], sec = +(m[6] ?? 0);
  if (h > 23 || mi > 59 || sec > 59) return null;
  return { date, time: `${pad(h)}:${pad(mi)}:${pad(sec)}` };
}

/** ZK numeric states (0 in, 1 out, 2 break-out, 3 break-in, 4 OT-in, 5 OT-out) and words like "Check In". */
export function parseDirection(s: string): Direction | null {
  const v = norm(s);
  if (/^(0|3|4|i)$/.test(v) || v.endsWith("in") || v === "entry") return "IN";
  if (/^(1|2|5|o)$/.test(v) || v.endsWith("out") || v === "exit") return "OUT";
  return null;
}

export type PunchRow = { line: number; code: string; date: string; time: string; direction: Direction | null };

/** One datetime column, or separate date + time columns, plus an optional in/out column. */
export function parsePunchRows(table: string[][], order: DateOrder) {
  const recs = records(table, ["code", "datetime", "date", "time", "direction"], ["code"]);
  const c = mapColumns(table[0] ?? [], ["code", "datetime", "date", "time"]);
  if (c.datetime < 0 && c.date < 0 && c.time < 0) throw new Error(`No date/time column found. Columns found: ${(table[0] ?? []).join(", ")}.`);
  const rows: PunchRow[] = [];
  const errors: string[] = [];
  for (const { line, get } of recs) {
    const code = get("code");
    const dateish = get("datetime") || get("date");
    let dt = parseDateTime(dateish || get("time"), order);
    if (dt && !dt.time && dateish && get("time")) dt = parseDateTime(`${dt.date} ${get("time")}`);
    if (!code) errors.push(`Row ${line}: missing employee code`);
    else if (!dt?.time) errors.push(`Row ${line}: can't read date/time "${[dateish, get("time")].filter(Boolean).join(" ")}".`);
    else rows.push({ line, code, date: dt.date, time: dt.time, direction: parseDirection(get("direction")) });
  }
  return { rows, errors };
}

// ZKTeco USB download (attlog.dat): "PIN<TAB>YYYY-MM-DD HH:MM:SS<TAB>...". Column order after the time varies by firmware, so only code + time are used.
const ATTLOG = /^\s*(\w+)\t(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // exceljs gives wall-clock values as UTC; time-only cells sit on 1899-12-30.
    const iso = new Date(Math.round(v.getTime() / 1000) * 1000).toISOString();
    const [d, t] = [iso.slice(0, 10), iso.slice(11, 19)];
    return v.getUTCFullYear() < 1900 ? t : t === "00:00:00" ? d : `${d} ${t}`;
  }
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    return o.richText ? o.richText.map((x) => x.text).join("") : cellText(o.result ?? o.text);
  }
  return String(v).trim();
}

/** File bytes -> rows of strings. XLSX (first sheet), CSV/TSV/semicolon (auto-detected), or ZKTeco attlog.dat. */
export async function readTable(name: string, bytes: Uint8Array): Promise<string[][]> {
  if (/\.xlsx$/i.test(name)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const rows: string[][] = [];
    wb.worksheets[0]?.eachRow((r) => rows.push(Array.from((r.values as unknown[]).slice(1), cellText)));
    return rows;
  }
  if (/\.xls$/i.test(name)) throw new Error("Old .xls files aren't supported. Open it in Excel and save as .xlsx or .csv.");
  const text = new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (ATTLOG.test(first)) {
    const out = [["code", "datetime"]];
    for (const l of text.split(/\r?\n/)) {
      const m = l.match(ATTLOG);
      if (m) out.push([m[1], m[2]]);
    }
    return out;
  }
  const count = (d: string) => first.split(d).length;
  return parseCsv(text, [",", ";", "\t", "|"].reduce((a, b) => (count(b) > count(a) ? b : a)));
}
