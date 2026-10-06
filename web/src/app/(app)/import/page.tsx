import Link from "next/link";
import { ActionForm } from "@/components/client";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { toCsv } from "@/lib/csv";
import { orgTimezone } from "@/lib/punches";
import { HR, requireRole } from "@/lib/session";
import { addDays, localDate } from "@/lib/time";
import { importEmployees, importHolidays, importLeaveBalances, importPunches, pullTerminalLogs } from "./actions";

export const metadata = { title: "Data migration" };

const template = (columns: string[], rows: unknown[][]) => `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(columns, rows))}`;
const TEMPLATES = {
  employees: template(["code", "name", "email", "phone", "branch", "department", "designation", "shift", "join_date", "date_of_birth"], [["101", "Jane Doe", "jane@example.com", "+8801700000000", "Head office", "Accounts", "Executive", "General (09:00-18:00)", "2023-04-01", "1994-07-15"]]),
  punches: template(["code", "datetime", "direction"], [["101", "2024-01-15 08:58:10", "IN"], ["101", "2024-01-15 18:04:55", "OUT"]]),
  leave: template(["code", "leave_type", "balance", "year"], [["101", "CL", "6.5", new Date().getFullYear()]]),
  holidays: template(["date", "holiday", "branch"], [[`${new Date().getFullYear()}-12-16`, "Victory Day", ""]]),
};

const SOURCES: [string, string][] = [
  ["ZKTeco ZKTime 5 / ZKTime.Net", "Report → Original records (or Attendance logs) → Export to Excel. Columns AC-No. / Name / Time are recognised."],
  ["ZKBioTime / BioTime 8", "Attendance → Transactions → Export (XLSX). Employee ID / Date / Time / Punch State are recognised."],
  ["eSSL eTimeTrackLite", "Reports → Device logs → Export, or the DeviceLogs table. UserId / LogDate / Direction are recognised."],
  ["Suprema BioStar 2", "Monitoring → Event log → filter 'Authentication success' → CSV. Map User ID → code, Date → datetime."],
  ["Hikvision iVMS-4200 / HikCentral", "Time & Attendance → Original records → Export. Employee ID / Time columns are recognised."],
  ["Terminal USB download", "Most ZKTeco/eSSL terminals: Menu → USB → Download attendance → upload the attlog.dat file here as is."],
  ["Spreadsheet or anything else", "Use the templates below. Column names are matched loosely (Employee ID, Emp Code, PIN, Badge No… all work)."],
];

function Upload({ accept = ".csv,.xlsx,.txt,.tsv", order = true, template }: { accept?: string; order?: boolean; template: string }) {
  return (
    <>
      <Field label="File" hint="CSV, Excel (.xlsx) or tab-separated text; first row must be the column names.">
        <Input type="file" name="file" accept={accept} required />
      </Field>
      {order && (
        <Field label="Dates in the file look like">
          <Select name="order" defaultValue="ymd">
            <option value="ymd">2024-01-31 (year first)</option>
            <option value="dmy">31/01/2024 (day first)</option>
            <option value="mdy">01/31/2024 (month first)</option>
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button name="mode" value="preview" variant="secondary">Preview</Button>
        <Button name="mode" value="import">Import</Button>
        <a href={template} download className="ml-auto text-xs font-medium text-blue-600 hover:underline">Download template</a>
      </div>
    </>
  );
}

export default async function ImportPage() {
  const ctx = await requireRole(HR);
  const today = localDate(new Date(), await orgTimezone(ctx.orgId));
  return (
    <>
      <PageHeader title="Data migration" description="Move employees and history from your previous attendance system. Always Preview first; nothing is saved until you click Import." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Recommended order" className="lg:col-span-1">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Create <Link className="text-blue-600 hover:underline" href="/organization">branches</Link>, <Link className="text-blue-600 hover:underline" href="/shifts">shifts</Link> and <Link className="text-blue-600 hover:underline" href="/leave-types">leave types</Link> (missing branches and departments are created during import).</li>
            <li>Import <b>employees</b>, keeping the same codes as on the terminals.</li>
            <li>Import <b>past attendance logs</b>; days are recalculated with your shift rules.</li>
            <li>Import <b>opening leave balances</b> and <b>holidays</b>.</li>
            <li>Point terminals to this server on the <Link className="text-blue-600 hover:underline" href="/devices">Devices</Link> page, then use <b>Pull stored logs</b> to fetch anything recorded since the last export.</li>
          </ol>
        </Card>

        <Card title="Where to find the export in your old system" className="lg:col-span-2">
          <dl className="divide-y divide-slate-100 text-sm">
            {SOURCES.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-3">
                <dt className="font-medium text-slate-800">{k}</dt>
                <dd className="text-slate-600 sm:col-span-2">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-400">Menu names differ between versions. Employee codes in the file must match the codes used here (and on the terminals) exactly.</p>
        </Card>

        <Card title="1 · Employees">
          <ActionForm action={importEmployees}>
            <p className="text-xs text-slate-500">Needs a code and name column. Existing codes are updated, so re-importing is safe.</p>
            <Upload template={TEMPLATES.employees} />
          </ActionForm>
        </Card>

        <Card title="2 · Past attendance logs">
          <ActionForm action={importPunches}>
            <p className="text-xs text-slate-500">One row per punch: code plus a date-time (or separate date and time columns), optional IN/OUT. Times are read in each employee&apos;s branch time zone. Duplicates are skipped.</p>
            <Upload accept=".csv,.xlsx,.txt,.tsv,.dat" template={TEMPLATES.punches} />
          </ActionForm>
        </Card>

        <Card title="3 · Opening leave balances">
          <ActionForm action={importLeaveBalances}>
            <p className="text-xs text-slate-500">Closing balance per employee and leave type (code or name). The available balance is set to exactly this number for the year.</p>
            <Upload order={false} template={TEMPLATES.leave} />
          </ActionForm>
        </Card>

        <Card title="4 · Holidays">
          <ActionForm action={importHolidays}>
            <p className="text-xs text-slate-500">Date and name; optional branch for local holidays. Past days are recalculated.</p>
            <Upload template={TEMPLATES.holidays} />
          </ActionForm>
        </Card>

        <Card title="5 · Pull stored logs from terminals" className="lg:col-span-2">
          <ActionForm action={pullTerminalLogs}>
            <p className="text-xs text-slate-500">
              ZKTeco/eSSL push terminals keep their punch memory. This asks every active push terminal to upload it again for the dates below;
              punches already received are ignored. Pull-mode terminals connected through the bridge agent are always read in full.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From"><Input type="date" name="from" defaultValue={addDays(today, -90)} max={today} required /></Field>
              <Field label="To"><Input type="date" name="to" defaultValue={today} max={today} required /></Field>
              <Button>Pull logs</Button>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
