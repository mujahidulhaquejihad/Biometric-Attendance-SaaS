import Link from "next/link";
import { STATUS_CELL, STATUS_CODE } from "./ui";

/** Employees x days matrix of attendance status codes (muster roll view). */
export function MonthGrid({ dates, rows }: {
  dates: string[];
  rows: { id: string; name: string; href?: string; cells: Record<string, { status: string; late: boolean } | undefined> }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="sticky left-0 bg-white px-2 py-1 text-left">Employee</th>
            {dates.map((d) => <th key={d} className="px-0.5 py-1 font-normal">{d.slice(8)}</th>)}
            <th className="px-2">P</th>
            <th className="px-2">A</th>
            <th className="px-2">L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cells = Object.values(r.cells);
            const count = (s: string) => cells.filter((c) => c?.status === s).length;
            return (
              <tr key={r.id}>
                <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-0.5">
                  {r.href ? <Link className="hover:underline" href={r.href}>{r.name}</Link> : r.name}
                </td>
                {dates.map((d) => {
                  const c = r.cells[d];
                  return (
                    <td key={d} className="p-0.5">
                      <div
                        title={c ? `${d}: ${c.status}${c.late ? " (late)" : ""}` : d}
                        className={`flex h-6 w-7 items-center justify-center rounded ${c ? STATUS_CELL[c.status] : "bg-slate-50 text-slate-300"} ${c?.late ? "ring-1 ring-amber-500" : ""}`}
                      >
                        {c ? STATUS_CODE[c.status] : "·"}
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 text-center">{count("PRESENT") + count("HALF_DAY") / 2}</td>
                <td className="px-2 text-center">{count("ABSENT")}</td>
                <td className="px-2 text-center">{count("LEAVE")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">P present · HD half day · A absent · L leave · H holiday · W week off · amber ring = late</p>
    </div>
  );
}
