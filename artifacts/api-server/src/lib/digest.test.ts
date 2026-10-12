import test from "node:test";
import assert from "node:assert/strict";
import { digestPeriod } from "./digest";

// 2026-10-12 is a Monday; times are given in UTC and judged in Nairobi (UTC+3).
test("the weekly status message goes out on Mondays, once per week", () => {
  assert.equal(digestPeriod("weekly", new Date("2026-10-12T03:00:00Z")), "2026-W42");
  assert.equal(digestPeriod(undefined, new Date("2026-10-12T03:00:00Z")), "2026-W42");
  assert.equal(digestPeriod("weekly", new Date("2026-10-13T03:00:00Z")), null);
  assert.equal(digestPeriod("weekly", new Date("2026-10-11T22:00:00Z")), "2026-W42", "Sunday 22:00 UTC is already Monday in Nairobi");
  assert.notEqual(digestPeriod("weekly", new Date("2026-10-19T03:00:00Z")), "2026-W42");
});
test("the monthly one goes out on the 1st, and off means never", () => {
  assert.equal(digestPeriod("monthly", new Date("2026-11-01T03:00:00Z")), "2026-11");
  assert.equal(digestPeriod("monthly", new Date("2026-11-02T03:00:00Z")), null);
  assert.equal(digestPeriod("off", new Date("2026-10-12T03:00:00Z")), null);
});
