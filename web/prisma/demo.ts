/** Demo tenant "Acme Textiles Ltd": 50 employees, 2 branches, 4 terminals and a month of realistic history. Run: npm run demo */
import { hashPassword } from "better-auth/crypto";
import { recomputeDay } from "../src/lib/attendance";
import { encrypt } from "../src/lib/crypto";
import { prisma, tenantDb } from "../src/lib/db";
import { createOrganization } from "../src/lib/org";
import { PLANS } from "../src/lib/plans";
import { addDays, dayOfWeek, localDate, toDbDate, zonedToUtc } from "../src/lib/time";

const ORG = "Acme Textiles Ltd";
const TZ = "Asia/Dhaka";
const PASSWORD = "Demo@1234";
const HISTORY_DAYS = 30;

let seed = 20261006;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const FIRST = ["Farhana", "Mahmudul", "Sharmin", "Arif", "Taslima", "Imran", "Ayesha", "Sabbir", "Nasrin", "Shahidul", "Moushumi", "Rezaul", "Shirin", "Habibur", "Rokeya", "Jahid", "Sultana", "Mizanur", "Fatema", "Anisur", "Lipi", "Masud", "Ruma", "Shafiqul", "Parvin", "Tariq", "Shapla", "Monir", "Rahima", "Zahid", "Mitu", "Kawsar", "Nazma", "Sohel", "Jesmin", "Faruk", "Afroza", "Hasan", "Shilpi", "Robiul", "Mim", "Saiful", "Laboni", "Belal", "Popy"];
const LAST = ["Rahman", "Islam", "Hossain", "Ahmed", "Akter", "Begum", "Khan", "Chowdhury", "Uddin", "Sarker", "Miah", "Alam", "Haque", "Das", "Roy", "Sheikh", "Talukder", "Molla", "Biswas", "Karim"];

type Spec = { name?: string; email?: string; dept: string; desig: string; branch: "HO" | "GZF"; shift: "gen" | "fac" | "night"; mgr?: string };
const KEY: Spec[] = [
  { name: "Kamal Hossain", email: "admin@acme.test", dept: "Management", desig: "Managing Director", branch: "HO", shift: "gen" },
  { name: "Nusrat Jahan", email: "hr@acme.test", dept: "Human Resources", desig: "HR Manager", branch: "HO", shift: "gen", mgr: "1" },
  { name: "Rafiqul Islam", email: "manager@acme.test", dept: "Production", desig: "Production Manager", branch: "GZF", shift: "fac", mgr: "1" },
  { name: "Abdul Karim", email: "security@acme.test", dept: "Security", desig: "Security Supervisor", branch: "GZF", shift: "fac", mgr: "2" },
  { name: "Tanvir Ahmed", email: "employee@acme.test", dept: "Production", desig: "Sewing Operator", branch: "GZF", shift: "fac", mgr: "3" },
];
const GROUPS: [number, Omit<Spec, "desig"> & { desig: string[] }][] = [
  [4, { dept: "Accounts", desig: ["Accounts Manager", "Accountant", "Accountant", "Accounts Assistant"], branch: "HO", shift: "gen", mgr: "1" }],
  [2, { dept: "IT", desig: ["IT Officer", "IT Support Executive"], branch: "HO", shift: "gen", mgr: "1" }],
  [4, { dept: "Merchandising", desig: ["Senior Merchandiser", "Merchandiser", "Merchandiser", "Merchandiser"], branch: "HO", shift: "gen", mgr: "1" }],
  [2, { dept: "Human Resources", desig: ["HR Executive", "Admin Officer"], branch: "HO", shift: "gen", mgr: "2" }],
  [21, { dept: "Production", desig: ["Line Supervisor", "Line Supervisor", "Line Supervisor", ...Array(18).fill("Sewing Operator")], branch: "GZF", shift: "fac", mgr: "3" }],
  [6, { dept: "Quality Control", desig: ["QC Manager", ...Array(5).fill("QC Inspector")], branch: "GZF", shift: "fac", mgr: "3" }],
  [4, { dept: "Maintenance", desig: ["Maintenance Engineer", "Technician", "Technician", "Electrician"], branch: "GZF", shift: "fac", mgr: "3" }],
  [2, { dept: "Security", desig: ["Security Guard", "Security Guard"], branch: "GZF", shift: "night", mgr: "4" }],
];
const NIGHT_PRODUCTION = new Set(["30", "31", "32", "33"]);
const HABITUAL_LATE = new Set(["5", "12", "27", "38"]);
const SHIFT_MIN = { gen: [540, 1080], fac: [480, 1020], night: [1320, 360] } as const;

async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: ORG } });
  if (existing) {
    const added: string[] = [];
    if (!(await tenantDb(existing.id).notice.count())) {
      await extras(existing.id);
      added.push("notices, birthdays and comp-off examples");
    }
    if (!(await tenantDb(existing.id).biometricTemplate.count())) {
      await fingerprints(existing.id);
      added.push("fingerprints");
    }
    return console.log(added.length ? `Added ${added.join(" and ")} to the existing "${ORG}".` : `"${ORG}" already exists; nothing to do.`);
  }
  const now = new Date();
  const today = localDate(now, TZ);
  const start = addDays(today, -HISTORY_DAYS);
  const hash = await hashPassword(PASSWORD);
  const login = async (email: string, name: string) => {
    const user = await prisma.user.upsert({ where: { email }, create: { email, name, emailVerified: true }, update: { name } });
    await prisma.account.deleteMany({ where: { userId: user.id, providerId: "credential" } });
    await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    return user;
  };

  // --- Company, plan, settings ---
  const admin = await login("admin@acme.test", "Kamal Hossain");
  const org = await createOrganization(ORG, TZ, admin.id, admin.name);
  const db = tenantDb(org.id);
  await db.subscription.updateMany({ data: { plan: "PRO", ...PLANS.PRO } });
  await db.orgSettings.updateMany({ data: { weekOffs: [5], notifyLate: false, webPunch: true, otRequiresApproval: true } });

  // --- Structure ---
  const ho = await db.branch.findFirstOrThrow({ where: { name: "Head office" } });
  await db.branch.update({ where: { id: ho.id }, data: { code: "HO", address: "House 12, Road 7, Gulshan-1, Dhaka 1212", lat: 23.7806, lng: 90.407, radiusM: 300 } });
  const gzf = await db.branch.create({ data: { name: "Gazipur Factory", code: "GZF", address: "Plot 45, BSCIC Industrial Area, Konabari, Gazipur", lat: 23.9999, lng: 90.4203, radiusM: 500 } });
  const branchId = { HO: ho.id, GZF: gzf.id };

  const specs: Spec[] = [...KEY];
  let n = 0;
  for (const [count, g] of GROUPS)
    for (let i = 0; i < count; i++, n++) {
      const name = `${FIRST[n % FIRST.length]} ${LAST[(n * 7 + 3) % LAST.length]}`;
      specs.push({ ...g, name, desig: g.desig[i] });
    }

  const deptNames = [...new Set(specs.map((s) => s.dept))];
  const desigNames = [...new Set(specs.map((s) => s.desig))];
  await db.department.createMany({ data: deptNames.map((name) => ({ name })) });
  await db.designation.createMany({ data: desigNames.map((name) => ({ name })) });
  const deptId = new Map((await db.department.findMany()).map((d) => [d.name, d.id]));
  const desigId = new Map((await db.designation.findMany()).map((d) => [d.name, d.id]));

  const general = await db.shift.findFirstOrThrow();
  await db.shift.update({ where: { id: general.id }, data: { weekOffs: [5] } });
  const factory = await db.shift.create({ data: { name: "Factory (08:00-17:00)", color: "#059669", startMinute: 480, endMinute: 1020, weekOffs: [5], otThreshold: 30 } });
  const night = await db.shift.create({ data: { name: "Night (22:00-06:00)", color: "#7c3aed", startMinute: 1320, endMinute: 360, weekOffs: [5], breakMinutes: 30 } });
  const shiftId = { gen: general.id, fac: factory.id, night: night.id };

  // --- Employees (code 1 = owner, created by createOrganization) ---
  const emps: { id: string; code: string; spec: Spec; joinDate: string }[] = [];
  for (const [i, s] of specs.entries()) {
    const code = String(i + 1);
    if (NIGHT_PRODUCTION.has(code)) s.shift = "night";
    const joinDate = code === "50" ? addDays(today, -12) : `${int(2015, 2025)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    const data = {
      name: s.name!,
      email: s.email ?? (s.branch === "HO" ? `${s.name!.split(" ")[0].toLowerCase()}.${code}@acme.test` : null),
      phone: `+8801${int(3, 9)}${String(int(10000000, 99999999))}`,
      branchId: branchId[s.branch],
      departmentId: deptId.get(s.dept)!,
      designationId: desigId.get(s.desig)!,
      defaultShiftId: shiftId[s.shift],
      managerId: s.mgr ? emps.find((e) => e.code === s.mgr)!.id : null,
      joinDate: toDbDate(joinDate),
    };
    const e = code === "1"
      ? await db.employee.update({ where: { organizationId_code: { organizationId: org.id, code } }, data })
      : await db.employee.create({ data: { ...data, code } });
    emps.push({ id: e.id, code, spec: s, joinDate });
  }
  const byCode = new Map(emps.map((e) => [e.code, e]));

  // --- Logins for each role ---
  const users: Record<string, string> = { admin: admin.id };
  for (const [role, code] of [["hr", "2"], ["manager", "3"], ["security", "4"], ["employee", "5"]] as const) {
    const s = byCode.get(code)!.spec;
    const u = await login(s.email!, s.name!);
    users[role] = u.id;
    await prisma.member.create({ data: { organizationId: org.id, userId: u.id, role } });
    await db.employee.update({ where: { id: byCode.get(code)!.id }, data: { userId: u.id } });
  }

  // --- Devices ---
  const dev = async (name: string, vendor: "ZKTECO_ADMS" | "AGENT", serial: string, branch: string, firmware: string) =>
    db.device.create({ data: { name, vendor, serial, branchId: branch, status: "ACTIVE", firmware, ip: "203.0.113." + int(10, 60), lastSeenAt: now, offlineNotified: true } });
  const hoGate = await dev("HO main entrance (ZKTeco SpeedFace)", "ZKTECO_ADMS", "ACME-HO-001", ho.id, "ZAM180-NF-Ver6.60");
  const hrDesk = await dev("HR desk USB scanner (bridge agent)", "AGENT", "ACME-AGENT-01", ho.id, "BridgeAgent 1.0");
  const gateA = await dev("Factory gate A (eSSL X990)", "ZKTECO_ADMS", "ACME-GZ-001", gzf.id, "Ver 6.4.1");
  const gateB = await dev("Factory gate B (eSSL X990)", "ZKTECO_ADMS", "ACME-GZ-002", gzf.id, "Ver 6.4.1");

  // --- Holidays ---
  let foundation = addDays(today, -15);
  if (dayOfWeek(foundation) === 5) foundation = addDays(foundation, 1);
  const year = today.slice(0, 4);
  await db.holiday.createMany({
    data: [
      { date: toDbDate(foundation), name: "Company foundation day" },
      { date: toDbDate(`${year}-10-20`), name: "Durga Puja (Bijoya Dashami)" },
      { date: toDbDate(`${year}-12-16`), name: "Victory Day" },
      { date: toDbDate(`${year}-12-25`), name: "Christmas Day" },
    ],
  });

  // --- Leave ---
  const types = new Map((await db.leaveType.findMany()).map((t) => [t.code, t.id]));
  const leaveOn = new Set<string>();
  const leaves: [code: string, type: string, from: number, to: number, status: "APPROVED" | "PENDING" | "REJECTED", reason: string][] = [
    ["7", "CL", -12, -11, "APPROVED", "Family function"],
    ["15", "SL", -6, -6, "APPROVED", "Fever"],
    ["22", "AL", -20, -18, "APPROVED", "Visiting home village"],
    ["40", "SL", -3, -3, "APPROVED", "Doctor appointment"],
    ["9", "AL", 0, 1, "APPROVED", "Child's school admission"],
    ["5", "CL", 7, 8, "PENDING", "Sister's wedding"],
    ["18", "SL", 2, 2, "PENDING", "Dental surgery"],
    ["33", "AL", 14, 18, "PENDING", "Annual vacation"],
    ["26", "CL", 3, 3, "PENDING", "Personal work at the land office"],
    ["27", "CL", -9, -9, "REJECTED", "Personal work"],
  ];
  for (const [code, type, from, to, status, reason] of leaves) {
    const e = byCode.get(code)!;
    await db.leaveRequest.create({
      data: {
        employeeId: e.id, leaveTypeId: types.get(type)!, fromDate: toDbDate(addDays(today, from)), toDate: toDbDate(addDays(today, to)),
        days: to - from + 1, reason, status,
        ...(status !== "PENDING" && { decidedById: users.hr, decidedAt: new Date(now.getTime() - 86400_000), decisionNote: status === "REJECTED" ? "Peak production week, please reschedule." : null }),
        createdAt: toDbDate(addDays(today, Math.min(from, 0) - 3)),
      },
    });
    if (status === "APPROVED") for (let d = from; d <= to; d++) leaveOn.add(`${code}|${addDays(today, d)}`);
  }

  // --- Punches ---
  const punches: { organizationId: string; employeeId: string; employeeCode: string; deviceId: string; timestamp: Date; verifyMode: string; direction: "IN" | "OUT"; source: "DEVICE" | "AGENT" }[] = [];
  const missingOut: { code: string; date: string }[] = [];
  const lateDays: { code: string; date: string; minutes: number }[] = [];
  const otDays: { code: string; date: string; minutes: number }[] = [];
  for (const e of emps) {
    const [startMin, endMin] = SHIFT_MIN[e.spec.shift];
    const overnight = endMin < startMin;
    const ot = ["Production", "Quality Control", "Maintenance"].includes(e.spec.dept) ? 0.25 : 0.08;
    for (let date = start; date <= today; date = addDays(date, 1)) {
      if (date < e.joinDate || dayOfWeek(date) === 5 || date === foundation || leaveOn.has(`${e.code}|${date}`)) continue;
      if (chance(HABITUAL_LATE.has(e.code) ? 0.06 : 0.035)) continue; // absent
      const late = HABITUAL_LATE.has(e.code) ? chance(0.35) : chance(0.08);
      const inMin = startMin + (late ? int(12, 55) : int(-25, 8));
      if (late) lateDays.push({ code: e.code, date, minutes: inMin - startMin });
      const r = rnd();
      let outMin = (overnight ? endMin + 1440 : endMin) + int(0, 25);
      if (r < 0.05) outMin -= int(25, 90);
      else if (r < 0.05 + ot) {
        const extra = int(45, 150);
        outMin += extra;
        otDays.push({ code: e.code, date, minutes: extra });
      }
      const midnight = zonedToUtc(date, "00:00", TZ).getTime();
      const at = (m: number) => new Date(midnight + m * 60_000 + int(0, 59) * 1000);
      const device = e.spec.branch === "HO" ? (chance(0.15) ? hrDesk : hoGate) : chance(0.5) ? gateA : gateB;
      const add = (ts: Date, direction: "IN" | "OUT") => {
        if (ts <= now) punches.push({ organizationId: org.id, employeeId: e.id, employeeCode: e.code, deviceId: device.id, timestamp: ts, verifyMode: pick(["FINGERPRINT", "FINGERPRINT", "FINGERPRINT", "FINGERPRINT", "FACE", "CARD"]), direction, source: device === hrDesk ? "AGENT" : "DEVICE" });
      };
      const inTs = at(inMin);
      add(inTs, "IN");
      if (chance(0.03)) add(new Date(inTs.getTime() + 40_000), "IN"); // double tap
      if (date !== today && chance(0.03)) missingOut.push({ code: e.code, date });
      else add(at(outMin), "OUT");
    }
  }
  for (let i = 0; i < punches.length; i += 5000) await prisma.punch.createMany({ data: punches.slice(i, i + 5000), skipDuplicates: true });

  // --- Requests waiting in the approvals inbox ---
  for (const [i, m] of missingOut.slice(0, 3).entries()) {
    await db.regularization.create({
      data: { employeeId: byCode.get(m.code)!.id, date: toDbDate(m.date), outTime: byCode.get(m.code)!.spec.branch === "HO" ? "18:10" : "17:05", reason: "Forgot to punch out", status: i === 2 ? "REJECTED" : "PENDING", ...(i === 2 && { decidedById: users.hr, decidedAt: now, decisionNote: "CCTV shows exit at 15:30." }) },
    });
  }
  const tanvirLate = lateDays.filter((l) => l.code === "5").at(-1);
  if (tanvirLate) await db.regularization.create({ data: { employeeId: byCode.get("5")!.id, date: toDbDate(tanvirLate.date), inTime: "08:00", reason: "Factory bus broke down on the way" } });
  for (const [i, o] of otDays.filter((o) => o.date < today).slice(-4).entries()) {
    await db.overtimeRequest.create({
      data: { employeeId: byCode.get(o.code)!.id, date: toDbDate(o.date), minutes: o.minutes, reason: "Shipment deadline for H&M order", status: i < 2 ? "APPROVED" : "PENDING", ...(i < 2 && { decidedById: users.manager, decidedAt: now }) },
    });
  }

  // --- Security desk ---
  const hosts = emps.filter((e) => e.spec.branch === "HO").map((e) => e.id);
  const visitors: [string, string, string, number, number | null][] = [
    ["Md. Selim Reza", "Buyer QA - H&M Bangladesh", "Pre-shipment inspection", -150, null],
    ["Sarah Thompson", "Primark Sourcing", "Factory audit", -75, null],
    ["Jamal Uddin", "DHL Express", "Document pickup", -200, -185],
  ];
  for (const [name, company, purpose, inMin, outMin] of visitors)
    await db.visitor.create({ data: { name, company, purpose, phone: `+8801${int(3, 9)}${int(10000000, 99999999)}`, badge: `V-${int(100, 999)}`, hostId: pick(hosts), checkIn: new Date(now.getTime() + inMin * 60_000), checkOut: outMin === null ? null : new Date(now.getTime() + outMin * 60_000) } });
  for (let i = 0; i < 6; i++) {
    const t = zonedToUtc(addDays(today, -int(1, 14)), `${int(10, 15)}:${int(10, 59)}`, TZ);
    await db.visitor.create({ data: { name: `${pick(FIRST)} ${pick(LAST)}`, company: pick(["Grameenphone", "Pran-RFL", "Beximco", "Walton", "City Bank"]), purpose: pick(["Meeting", "Interview", "Vendor visit", "Maintenance"]), hostId: pick(hosts), checkIn: t, checkOut: new Date(t.getTime() + int(30, 120) * 60_000) } });
  }

  await db.consent.createMany({ data: emps.map((e) => ({ employeeId: e.id, signedName: e.spec.name!, recordedById: users.hr })) });
  await db.reportSchedule.createMany({
    data: [
      { kind: "late", format: "xlsx", frequency: "DAILY", hour: 10, recipients: ["hr@acme.test"] },
      { kind: "payroll", format: "xlsx", frequency: "MONTHLY", hour: 9, recipients: ["admin@acme.test", "hr@acme.test"] },
    ],
  });

  // --- Compute attendance days with the real engine ---
  console.log(`Inserted ${punches.length} punches; computing ${emps.length * (HISTORY_DAYS + 2)} employee-days…`);
  for (let i = 0; i < emps.length; i += 10)
    await Promise.all(emps.slice(i, i + 10).map(async (e) => {
      for (let d = addDays(start, -1); d <= today; d = addDays(d, 1)) await recomputeDay(e.id, d);
    }));
  await extras(org.id);
  await fingerprints(org.id);
  await db.orgSettings.updateMany({ data: { notifyLate: true } });

  console.log(`\nDone. Open http://localhost:3000/login. Every login uses the password ${PASSWORD}:`);
  for (const r of ["admin", "hr", "manager", "employee", "security"]) console.log(`  ${r.padEnd(9)} ${r}@acme.test`);
}

/** Notices, birthdays/anniversaries and comp-off claims; also tops up demos seeded before these existed. */
async function extras(orgId: string) {
  const db = tenantDb(orgId);
  const today = localDate(new Date(), TZ);
  const emps = await db.employee.findMany({ orderBy: { createdAt: "asc" } });
  const byCode = new Map(emps.map((e) => [e.code, e]));
  const hr = byCode.get("2")!.userId;

  // Three birthdays and one work anniversary fall this week, so the Today card has something to show.
  const soon: Record<string, number> = { "5": 0, "12": 2, "27": 5 };
  for (const e of emps) {
    const md = e.code in soon ? addDays(today, soon[e.code]).slice(5) : `${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    await db.employee.update({ where: { id: e.id }, data: { birthDate: toDbDate(`${int(1975, 2002)}-${md}`) } });
  }
  await db.employee.update({ where: { id: byCode.get("3")!.id }, data: { joinDate: toDbDate(`2018-${addDays(today, 1).slice(5)}`) } });

  const year = today.slice(0, 4);
  await db.notice.createMany({
    data: [
      { title: `Durga Puja holiday on ${year}-10-20`, body: "The factory and head office will be closed for Bijoya Dashami. Production lines resume at 08:00 the next day.\nNight shift: please collect your revised roster from your line supervisor.", pinned: true, expiresOn: toDbDate(`${year}-10-21`), createdById: hr },
      { title: "Fire drill on Thursday at 11:00", body: "All staff at Gazipur Factory must assemble at the main gate when the alarm sounds. Please do not use the lifts.", expiresOn: toDbDate(addDays(today, 7)), createdById: hr },
      { title: "September salary disbursed", body: "Salaries for September have been sent to your bank accounts. Payslips are available from HR. Contact accounts with any questions.", createdById: hr },
    ],
  });

  // Four production staff worked last Friday (their weekly off). Three have claimed comp-off;
  // Tanvir (employee@acme.test) hasn't, so the employee login can try claiming it.
  let friday = addDays(today, -1);
  while (dayOfWeek(friday) !== 5) friday = addDays(friday, -1);
  const gate = await db.device.findFirstOrThrow({ where: { serial: "ACME-GZ-001" } });
  const workers = ["5", "18", "19", "20"].map((c) => byCode.get(c)!);
  await prisma.punch.createMany({
    skipDuplicates: true,
    data: workers.flatMap((e) => (["IN", "OUT"] as const).map((direction) => ({
      organizationId: orgId, employeeId: e.id, employeeCode: e.code, deviceId: gate.id, verifyMode: "FINGERPRINT", direction, source: "DEVICE" as const,
      timestamp: zonedToUtc(friday, direction === "IN" ? "07:55" : "17:10", TZ),
    }))),
  });
  for (const e of workers) await recomputeDay(e.id, friday);
  await db.compOffRequest.createMany({
    data: workers.slice(1).map((e, i) => ({ employeeId: e.id, date: toDbDate(friday), days: 1, reason: i ? "Urgent H&M shipment" : "Machine maintenance shutdown support" })),
  });
}

/**
 * Consent plus two fingers for most staff; three with one finger and the three newest with none, so the enrollment
 * filters have something to show. ISO19794 placeholders are never pushed to terminals (only ZK_V10 templates are).
 */
async function fingerprints(orgId: string) {
  const db = tenantDb(orgId);
  const emps = await db.employee.findMany({ orderBy: { createdAt: "asc" } });
  const hr = emps.find((e) => e.code === "2")!.userId;
  const fingersFor = (code: string) => (["48", "49", "50"].includes(code) ? [] : ["33", "41", "47"].includes(code) ? [6] : [6, 3]);
  const enrolled = emps.filter((e) => fingersFor(e.code).length);
  await db.consent.createMany({ data: enrolled.map((e) => ({ employeeId: e.id, signedName: e.name, recordedById: hr })) });
  await db.biometricTemplate.createMany({
    data: enrolled.flatMap((e) => fingersFor(e.code).map((finger) => ({ employeeId: e.id, finger, format: "ISO19794" as const, data: encrypt(orgId, Buffer.from(`demo ${e.code}/${finger}`)) }))),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
