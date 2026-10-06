<div align="center">

<img src="web/public/icon.svg" width="72" alt="" />

# Attendance

**Biometric attendance for companies of any size, with the fingerprint scanners you already own.**

Multi-tenant SaaS · ZKTeco / eSSL · Hikvision · Suprema · Anviz · USB readers · Live punches · Shifts, leave and overtime · Reports and payroll export

![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169e1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2d3748?logo=prisma)
![.NET](https://img.shields.io/badge/.NET-8-512bd4?logo=dotnet)
![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)

<img src="docs/screenshots/today.png" alt="Today dashboard" width="900" />

</div>

---

## Contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Supported devices](#supported-devices)
- [Quick start (local)](#quick-start-local)
- [Demo company and logins](#demo-company-and-logins)
- [Deploy with Docker](#deploy-with-docker)
- [Connecting devices](#connecting-devices)
- [Enrolling and updating fingerprints](#enrolling-and-updating-fingerprints)
- [Bridge agent (USB scanners and LAN terminals)](#bridge-agent-usb-scanners-and-lan-terminals)
- [Migrating from another system](#migrating-from-another-system)
- [Using the app day to day](#using-the-app-day-to-day)
- [REST API and webhooks](#rest-api-and-webhooks)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Development](#development)
- [Security and privacy](#security-and-privacy)

---

## What it does

| Area | Highlights |
| --- | --- |
| **Devices** | ZKTeco/eSSL push (ADMS), Hikvision ISAPI, Suprema BioStar 2, Anviz CrossChex Cloud, legacy ZK terminals over LAN, and any USB fingerprint reader through a small Windows agent. Remote reboot, log pull and user sync. |
| **Attendance engine** | Shifts (including night shifts that cross midnight), grace periods, late / early / half-day rules, overtime, weekly offs, branch holidays and rosters. Days are recalculated automatically whenever a punch, leave or rule changes. |
| **Fingerprints** | Visual two-hand enrollment page, enrollment from a USB reader or straight on a wall terminal, replace or remove a single finger, coverage filters ("missing", "only one finger"), written consent and one-click erasure. |
| **HR** | Live "Today" dashboard, employees, branches and departments, roster, holidays, leave types and balances, approvals inbox, notice board, birthdays and work anniversaries. |
| **Employees (self-service)** | Monthly calendar, punch history, leave balance, leave / correction / overtime / comp-off requests, clock-in from phone with GPS geofence. |
| **Security desk** | Live muster roll of who is inside, visitor check-in and check-out, printable evacuation list. |
| **Reports** | Daily attendance, monthly muster roll, late, early exits, absentees, overtime, leave register, department hours, device punch log, payroll export. CSV, Excel and PDF, plus scheduled email delivery. |
| **SaaS** | Many organizations on one install, plans with employee and device limits, platform admin, REST API keys, signed webhooks, audit log, two-factor sign-in. |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/login.png" alt="Sign-in page" /><br /><b>Sign in</b>: split-screen with an animated fingerprint scan</td>
    <td width="50%"><img src="docs/screenshots/today.png" alt="Today dashboard" /><br /><b>Today</b>: live attendance ring, who is late or absent, devices offline</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/enroll.png" alt="Fingerprint enrollment" /><br /><b>Fingerprint enrollment</b>: tap a finger on the hand, scan, done</td>
    <td><img src="docs/screenshots/approvals.png" alt="Approvals" /><br /><b>Approvals</b>: leave, corrections, overtime and comp-off in one inbox</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/me.png" alt="My attendance" /><br /><b>My attendance</b>: each employee's calendar, totals and notices</td>
    <td><img src="docs/screenshots/requests.png" alt="My requests" /><br /><b>My requests</b>: leave, attendance correction, overtime, comp-off</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/security.png" alt="Security desk" /><br /><b>Security desk</b>: who is in the building right now, visitors</td>
    <td><img src="docs/screenshots/reports.png" alt="Reports" /><br /><b>Reports</b>: 11 report types, CSV / XLSX / PDF, scheduled emails</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/devices.png" alt="Devices" /><br /><b>Devices</b>: terminals, cloud integrations and USB agents</td>
    <td><img src="docs/screenshots/import.png" alt="Data migration" /><br /><b>Data migration</b>: import from ZKTime, BioTime, eTimeTrackLite and more</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/notices.png" alt="Notice board" /><br /><b>Notices</b>: pinned announcements with optional email</td>
    <td><img src="docs/screenshots/kiosk.png" alt="Kiosk" /><br /><b>Kiosk</b>: full-screen clock for a PC with a USB reader</td>
  </tr>
</table>

## Supported devices

| Device family | How it connects | Fingerprint sync |
| --- | --- | --- |
| **ZKTeco / eSSL** with ADMS ("Cloud Server") | Terminal pushes punches to `/iclock` over HTTP | Yes: users and fingerprints are pushed to every terminal in the branch; enrollment can start on the terminal |
| **ZKTeco legacy** (no ADMS) | Bridge agent polls the terminal on the LAN (TCP 4370) | Punches only |
| **Hikvision** access control / face terminals | Terminal pushes events to a per-device URL (ISAPI HTTP listening) | Punches only |
| **Suprema BioStar 2** | Server pulls events from the BioStar API every minute | Punches only |
| **Anviz CrossChex Cloud** | Server pulls records from the CrossChex API every minute | Punches only |
| **USB readers**: SecuGen, DigitalPersona U.are.U, ZKTeco ZK4500/ZK9500, any Windows Hello reader | Bridge agent on a Windows PC; kiosk page for check-in | Yes, matched locally with SourceAFIS |
| **Anything else** | REST API (`POST /api/v1/punches`) or CSV import | n/a |

Employee codes are the glue: the code on a terminal, in an old system's export and in this app must be the same.

## Quick start (local)

**You need:** Node.js 22.18 or newer (24 LTS recommended) and PostgreSQL 15 or newer. Docker is optional.

```bash
git clone <your-repo-url> attendance
cd attendance/web
cp .env.example .env
```

Edit `web/.env`:

```bash
DATABASE_URL=postgresql://attendance:attendance@localhost:5432/attendance
BETTER_AUTH_SECRET=<any long random string>
BETTER_AUTH_URL=http://localhost:3000
MASTER_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

Then:

```bash
npm install
npx prisma migrate deploy     # create the tables
npm run demo                  # optional: a demo company with 50 employees
npm run build && npm start    # production server on http://localhost:3000
```

For development with hot reload use `npm run dev` instead of `build && start`. The first visit to each page compiles it, so dev mode feels slower than production.

## Demo company and logins

`npm run demo` creates **Acme Textiles Ltd**: two branches (head office and a factory), nine departments, day, factory and night shifts, 50 employees with 30 days of realistic punches, leave, pending approvals, notices, birthdays, comp-off claims and fingerprints. It is safe to run again; it only adds what is missing.

Every demo login uses the password **`Demo@1234`**:

| Login | Role | What to try |
| --- | --- | --- |
| `admin@acme.test` | Admin | Everything, including settings, API keys and the audit log |
| `hr@acme.test` | HR | Today dashboard, employees, fingerprints, approvals, reports |
| `manager@acme.test` | Manager | "My team" and approving their team's requests |
| `employee@acme.test` | Employee | Own calendar, requests, claiming comp-off for last Friday |
| `security@acme.test` | Security | Security desk, visitors, evacuation list |

## Deploy with Docker

The repo includes a `docker-compose.yml` with PostgreSQL 17, the web app (which runs migrations on start) and Caddy for automatic HTTPS.

```bash
cp web/.env.example web/.env      # fill BETTER_AUTH_SECRET and MASTER_KEY at least
export DOMAIN=attendance.example.com
export POSTGRES_PASSWORD=<strong password>
docker compose up -d --build
```

| Port | Used for |
| --- | --- |
| 443 | The app over HTTPS (certificate issued automatically by Caddy) |
| 80 | Redirects to HTTPS, except `/iclock/*`: old ZKTeco firmware speaks plain HTTP only |
| 8081 | ZKTeco/eSSL ADMS default port, for terminals configured by IP |

The first account that signs up creates its organization. Emails listed in `SUPER_ADMIN_EMAILS` become platform admins and can manage every organization from `/admin`.

## Connecting devices

Add each device under **Setup → Devices → Add device**. The device page shows step-by-step instructions for its type; the short version:

**ZKTeco / eSSL (ADMS)**
1. Enter the terminal's serial number (Menu → System info) when adding it.
2. On the terminal: **Menu → Comm. → Cloud Server Setting** (or ADMS). Server address = your domain or server IP, port `8081` (or `80`). HTTPS and proxy off.
3. The terminal shows as online within a minute. Click **Sync employees & fingerprints** to push your staff list.

**Hikvision**
1. Add the device; copy the event push URL shown once (`/api/ingest/hikvision/<token>`).
2. In the device web UI: **Configuration → Network → Advanced → HTTP Listening**, paste the URL.
3. Employee numbers on the device must match employee codes.

**Suprema BioStar 2 / Anviz CrossChex Cloud.** Enter the API URL and an operator account (BioStar) or an API key and secret (Anviz). Events are pulled every minute.

**Legacy ZK terminals and USB readers.** Install the [bridge agent](#bridge-agent-usb-scanners-and-lan-terminals).

Devices that stop reporting for 15 minutes are flagged on the Today dashboard and can trigger a `device.offline` webhook.

## Enrolling and updating fingerprints

Open **People → Fingerprint enrollment**.

<img src="docs/screenshots/enroll.png" alt="Fingerprint enrollment page" width="800" />

1. **Find the person.** Search by name or code, or use the filters: **Missing** lists everyone who can't punch with a finger yet, **One finger** lists people with no backup finger. The cards at the top show company-wide coverage.
2. **Record consent** (first time only). The employee types their name as a signature. Consent is stored with date, time, IP address and who recorded it.
3. **Tap a finger on the hand.** Green fingers are already enrolled; dashed ones are empty. The page pre-selects the next most useful missing finger (index fingers first, then thumbs and middles).
4. **Scan** with the USB reader on this PC, or click **Start on terminal** to make a ZKTeco wall terminal show its own enrollment screen. After a successful USB scan the page jumps to the next missing finger automatically.
5. **To update a finger**, select it and scan again: the new template replaces the old one here and on every terminal in the employee's branch. **To remove one finger** (injury, worn print), select it and click **Remove finger**; only that finger is deleted from the server and the terminals.

Enroll at least one finger on each hand so a cut or bandage never locks anyone out. **Erase biometrics** on the employee's profile (or **Delete my biometric data** on the employee's own page) deletes every template, revokes consent and wipes the fingers from all terminals.

## Bridge agent (USB scanners and LAN terminals)

A small .NET 8 Windows service in [`agent/`](agent). It:

- reads a USB fingerprint scanner and serves the **kiosk** (`/kiosk`) and **enrollment** pages over `ws://localhost:47800`;
- matches fingers locally with [SourceAFIS](https://sourceafis.machinezoo.com/), so check-in works even if the internet drops (punches are queued in SQLite and uploaded later);
- polls legacy ZKTeco terminals on the LAN (TCP 4370) and uploads new logs every minute.

**Install**

1. In the app, add a device of type **USB scanner bridge agent** and copy the token (shown once).
2. Edit `agent/appsettings.json`:
   ```json
   { "Agent": { "ServerUrl": "https://attendance.example.com", "DeviceToken": "<token>", "Scanner": "auto" } }
   ```
3. Build and install as a Windows service (run as administrator):
   ```powershell
   cd agent
   dotnet publish -c Release -o C:\AttendanceAgent
   sc.exe create "Attendance Bridge Agent" binPath= "C:\AttendanceAgent\BridgeAgent.exe" start= auto
   sc.exe start "Attendance Bridge Agent"
   ```
4. Open `http://localhost:47800` on that PC to check status, then open `/kiosk` in a browser for the check-in screen.

**Scanner support.** Windows Hello compatible readers work out of the box. For SecuGen, DigitalPersona or ZKTeco readers, copy the vendor's .NET wrapper DLL into `agent/lib/` (`SecuGen.FDxSDKPro.Windows.dll`, `DPUruNet.dll` or `libzkfpcsharp.dll`) and rebuild; the matching driver is compiled in automatically. Vendor SDKs are licensed by the vendor and are not included.

## Migrating from another system

**Setup → Data migration** imports CSV, Excel or tab-separated files and always shows a preview before saving anything. Column names are matched loosely (Employee ID, Emp Code, PIN, Badge No… all work), and day / month / year order is selectable.

1. Create branches, shifts and leave types (missing branches and departments are created during import).
2. Import **employees**, keeping the codes used on the terminals. Re-importing updates existing codes.
3. Import **past attendance logs**: one row per punch. Days are recalculated with your shift rules; duplicates are skipped.
4. Import **opening leave balances** and **holidays**.
5. Point terminals at the new server, then **Pull stored logs** to fetch anything recorded since the export.

The page explains where to find the export in ZKTime 5 / ZKTime.Net, ZKBioTime / BioTime 8, eSSL eTimeTrackLite, Suprema BioStar 2, Hikvision iVMS-4200 / HikCentral, and terminal USB downloads (`attlog.dat`).

## Using the app day to day

**HR and admins**
- **Today**: attendance ring, present / late / leave / absent / not-yet-in, offline devices, 14-day trend, department heat map, live punch feed, birthdays and anniversaries.
- **Approvals**: approve or reject with an optional note; the employee is notified and the day is recalculated.
- **Notices**: post announcements, pin them, set an expiry date, optionally notify everyone by email.
- **Roster**: override someone's shift for specific days or mark a day off.
- **Reports**: filter by date, branch, department or employee; download, or schedule daily / weekly / monthly emails.

**Managers** see **My team** (today's status and a month calendar of their direct reports) and approve their team's requests.

**Employees** see their month calendar, totals, leave balance and notices, and can:
- apply for leave (full or half day);
- correct a missed punch;
- claim overtime;
- claim **comp-off** for work on a holiday or weekly off. Once approved, the earned day is added to a "Comp-off" leave balance;
- clock in from a phone, if allowed. The server checks GPS against the branch geofence.

**Security** sees the live muster roll, checks visitors in and out, and prints the evacuation list.

## REST API and webhooks

Create an API key under **Setup → API & webhooks** (admins only). Keys start with `ak_`, are stored hashed, and are limited to 600 requests per minute. List endpoints return up to 500 rows plus a `next_cursor`.

```bash
# Employees
curl -H "Authorization: Bearer ak_..." https://attendance.example.com/api/v1/employees?active=true

# Raw punches in a time range
curl -H "Authorization: Bearer ak_..." "https://attendance.example.com/api/v1/punches?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z"

# Calculated attendance days
curl -H "Authorization: Bearer ak_..." "https://attendance.example.com/api/v1/attendance?from=2026-10-01&to=2026-10-31&employee_code=5"

# Send punches from another system (up to 1000 per call)
curl -X POST -H "Authorization: Bearer ak_..." -H "Content-Type: application/json" \
  -d '{"punches":[{"employee_code":"5","timestamp":"2026-10-06T08:57:00+06:00","direction":"IN"}]}' \
  https://attendance.example.com/api/v1/punches
```

**Webhooks** fire on `punch.created`, `request.decided`, `employee.updated` and `device.offline`. Each request carries an `X-Signature: sha256=<hex>` header: the HMAC-SHA256 of the raw body with the webhook's secret. Failed deliveries are retried.

## Configuration

All settings live in `web/.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Signs sessions; any long random string |
| `BETTER_AUTH_URL` | yes | Public URL of the app, e.g. `https://attendance.example.com` |
| `MASTER_KEY` | yes | 32 random bytes (base64). Derives a separate AES-256-GCM key per organization for fingerprint templates and device secrets. **Back it up; without it stored fingerprints can't be decrypted.** |
| `SMTP_URL`, `MAIL_FROM` | no | Outgoing email. Without them, emails are printed to the server log. |
| `SUPER_ADMIN_EMAILS` | no | Comma-separated emails that become platform admins on sign-up |
| `JOBS` | no | `off` runs a web-only instance without background jobs (for scaling out) |

Per-organization settings (time zone, weekly offs, missing-punch rule, repeat-punch window, daily HR digest, late alerts, payroll export columns) are under **Setup → Settings**. Each branch's time zone and phone clock-in geofence are under **People → Branches & departments**.

## Project structure

```
.
├── web/                     Next.js app (UI, server actions, device endpoints, jobs)
│   ├── prisma/              schema.prisma, migrations, demo.ts (demo company)
│   └── src/
│       ├── app/(app)/       signed-in pages: today, enroll, approvals, reports, …
│       ├── app/iclock/      ZKTeco/eSSL ADMS push protocol
│       ├── app/api/         REST API v1, agent, Hikvision ingest, live feed (SSE), reports
│       ├── components/      shared UI (cards, stats, charts, live feed, enrollment)
│       └── lib/             attendance engine, adapters, tenancy, crypto, jobs, webhooks
├── agent/                   .NET 8 Windows bridge agent (USB scanners, kiosk, LAN polling)
├── docs/screenshots/        images used in this README
├── docker-compose.yml       PostgreSQL + web + Caddy
└── Caddyfile                HTTPS, plain-HTTP /iclock for old terminals, port 8081
```

**Stack:** Next.js 15 (App Router, server actions), React 19, Tailwind CSS 4, Prisma 6 on PostgreSQL 17, Better Auth (organizations, two-factor), pg-boss for background jobs, Recharts, ExcelJS and React-PDF for exports, lucide icons. Live updates use PostgreSQL `LISTEN/NOTIFY` streamed to the browser over Server-Sent Events.

## Development

```bash
cd web
npm run dev          # dev server with hot reload
npm test             # attendance engine, migration parser, date helpers (node --test)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # create a migration after editing prisma/schema.prisma
```

Stop a running `npm start` before `prisma migrate` or `prisma generate` on Windows; the server holds a lock on Prisma's engine file.

## Security and privacy

- **Tenant isolation**: every query is scoped to the signed-in organization by a Prisma extension, and PostgreSQL defaults new rows to the current organization.
- **Fingerprints** are stored only as mathematical templates, encrypted with a per-organization AES-256-GCM key, never as images. Enrollment requires recorded consent; employees can erase their own biometric data at any time, and deactivated employees are removed from terminals.
- **Accounts**: email and password with optional two-factor authentication (authenticator app), role-based access (admin, HR, manager, employee, security), and platform admin impersonation that is clearly bannered and audited.
- **Audit log** of every create, update, approval, enrollment and erasure.
- **API keys and device tokens** are stored hashed; webhooks are HMAC-signed; the API is rate limited.
