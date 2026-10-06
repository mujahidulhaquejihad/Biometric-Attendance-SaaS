const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function wallClock(d: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

const offsetMs = (d: Date, tz: string) => {
  const w = wallClock(d, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(d.getTime() / 1000) * 1000;
};

/** Local wall-clock time in tz -> UTC instant. */
export function zonedToUtc(date: string, time = "00:00:00", tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

/** "YYYY-MM-DD HH:MM:SS" in device-local time -> UTC instant. */
export const parseLocal = (s: string, tz: string) => {
  const [date, time] = s.trim().split(/[ T]/);
  return zonedToUtc(date, time ?? "00:00:00", tz);
};

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date, tz: string) => {
  const w = wallClock(d, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
};
export const localTime = (d: Date | null | undefined, tz: string) => {
  if (!d) return "";
  const w = wallClock(d, tz);
  return `${pad(w.h)}:${pad(w.mi)}`;
};

/** Minutes between local midnight of `date` and `instant`, in tz. */
export function minutesFromMidnight(instant: Date, date: string, tz: string) {
  const w = wallClock(instant, tz);
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Date.UTC(y, m - 1, d)) / 60000);
}

export const addDays = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dayOfWeek = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();
export const toDbDate = (date: string) => new Date(date + "T00:00:00Z");
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** Next yearly recurrence of `date` on or after `today`; Feb 29 falls on Feb 28 in common years. */
export function nextAnniversary(date: string, today: string) {
  for (let y = +today.slice(0, 4); ; y++) {
    const md = date.slice(5) === "02-29" && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1 ? "02-28" : date.slice(5);
    const on = `${y}-${md}`;
    if (on >= today) return { on, inDays: Math.round((toDbDate(on).getTime() - toDbDate(today).getTime()) / 86400_000), years: y - +date.slice(0, 4) };
  }
}
export const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
};

export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const minutesToHhmm = (n: number) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
export const fmtDuration = (n: number) => (n ? `${Math.floor(n / 60)}h ${pad(n % 60)}m` : "-");
