import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDateTime, parseDirection, parsePunchRows, readTable, records } from "./migrate.ts";

const enc = (s: string) => new TextEncoder().encode(s);

test("date formats", () => {
  assert.deepEqual(parseDateTime("2024-01-15 09:05:07"), { date: "2024-01-15", time: "09:05:07" });
  assert.deepEqual(parseDateTime("15/01/2024 9:05 PM", "dmy"), { date: "2024-01-15", time: "21:05:00" });
  assert.deepEqual(parseDateTime("01/15/24 12:30 am", "mdy"), { date: "2024-01-15", time: "00:30:00" });
  assert.deepEqual(parseDateTime("15-Jan-2024 09:05"), { date: "2024-01-15", time: "09:05:00" });
  assert.deepEqual(parseDateTime("2024-02-29"), { date: "2024-02-29", time: null });
  assert.equal(parseDateTime("2023-02-29"), null);
  assert.equal(parseDateTime("31/12/2024", "mdy"), null);
  assert.equal(parseDateTime("garbage"), null);
});

test("directions", () => {
  assert.equal(parseDirection("Check In"), "IN");
  assert.equal(parseDirection("C/Out"), "OUT");
  assert.equal(parseDirection("0"), "IN");
  assert.equal(parseDirection("5"), "OUT");
  assert.equal(parseDirection(""), null);
});

test("BioTime-style headers with separate date and time", () => {
  const t = [["Employee ID", "First Name", "Date", "Time", "Punch State"], ["7", "Rahim", "15/01/2024", "09:01", "Check In"], ["7", "Rahim", "bad", "", ""]];
  const { rows, errors } = parsePunchRows(t, "dmy");
  assert.deepEqual(rows, [{ line: 2, code: "7", date: "2024-01-15", time: "09:01:00", direction: "IN" }]);
  assert.equal(errors.length, 1);
});

test("ZKTime-style single Time column holding the full datetime", () => {
  const { rows } = parsePunchRows([["AC-No.", "Name", "Time", "State"], ["12", "Karim", "2024-01-15 18:02:00", "C/Out"]], "ymd");
  assert.equal(rows[0].time, "18:02:00");
  assert.equal(rows[0].direction, "OUT");
});

test("readTable: semicolon CSV, attlog.dat, missing columns", async () => {
  assert.deepEqual(await readTable("a.csv", enc("\uFEFFcode;name\n1;A\n")), [["code", "name"], ["1", "A"]]);
  assert.deepEqual(await readTable("attlog.dat", enc("    3\t2024-01-15 09:00:00\t1\t0\t1\t0\r\n    3\t2024-01-15 18:00:00\t1\t1\t1\t0\r\n")), [
    ["code", "datetime"], ["3", "2024-01-15 09:00:00"], ["3", "2024-01-15 18:00:00"],
  ]);
  assert.throws(() => records([["foo"]], ["code", "name"], ["code", "name"]), /Missing column\(s\): code, name/);
});
