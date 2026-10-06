import assert from "node:assert/strict";
import test from "node:test";
import { nextAnniversary } from "./time.ts";

test("nextAnniversary", () => {
  assert.deepEqual(nextAnniversary("1990-10-06", "2026-10-06"), { on: "2026-10-06", inDays: 0, years: 36 });
  assert.deepEqual(nextAnniversary("2020-10-09", "2026-10-06"), { on: "2026-10-09", inDays: 3, years: 6 });
  assert.deepEqual(nextAnniversary("2020-01-02", "2026-12-30"), { on: "2027-01-02", inDays: 3, years: 7 });
  assert.equal(nextAnniversary("2000-02-29", "2027-02-01").on, "2027-02-28");
  assert.equal(nextAnniversary("2000-02-29", "2028-02-01").on, "2028-02-29");
});
