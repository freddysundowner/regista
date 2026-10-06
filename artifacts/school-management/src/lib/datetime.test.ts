import test from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtDateTime, fmtTime, localDateKey, localDay, localInputToUtc, viewerTimezone } from "./datetime";
import { displayValue } from "./audit-format";

test("viewer timezone controls timestamps, grouping and filters without shifting calendar dates", () => {
  const original = process.env.TZ;
  try {
    const instant = "2026-10-06T00:30:00Z";
    for (const [zone, date, utc] of [
      ["America/Los_Angeles", "2026-10-05", "2026-10-06T19:30:00.000Z"],
      ["Asia/Tokyo", "2026-10-06", "2026-10-06T03:30:00.000Z"],
      ["Asia/Riyadh", "2026-10-06", "2026-10-06T09:30:00.000Z"],
      ["Pacific/Kiritimati", "2026-10-06", "2026-10-05T22:30:00.000Z"],
    ]) {
      process.env.TZ = zone;
      assert.equal(viewerTimezone(), zone);
      assert.equal(localDateKey(instant), date);
      assert.equal(localInputToUtc("2026-10-06T12:30"), utc);
      assert.equal(fmtDate("2026-10-06"), new Date(2026, 9, 6, 12).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
      assert.equal(displayValue("2026-10-06T00:00:00Z", "paidOn"), fmtDate("2026-10-06"));
      assert.equal(displayValue(instant, "createdAt"), fmtDateTime(instant));
      assert.equal(localDay(instant), new Date(instant).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
      assert.equal(fmtTime(instant), new Date(instant).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    }
    process.env.TZ = "America/New_York";
    assert.equal(localInputToUtc("2026-01-15T12:30"), "2026-01-15T17:30:00.000Z");
    assert.equal(localInputToUtc("2026-07-15T12:30"), "2026-07-15T16:30:00.000Z");
    assert.throws(() => localInputToUtc("2026-03-08T02:30"), /does not exist/);
    assert.throws(() => localInputToUtc("2026-02-30T12:00"));
    assert.equal(fmtDateTime(null), "—");
    assert.equal(fmtDateTime("invalid"), "invalid");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
