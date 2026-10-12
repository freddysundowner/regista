import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@workspace/db";
import { bySize, covers, upgradeQuote } from "./licensing";

const D = (n: number | string) => new Prisma.Decimal(n);
const now = new Date("2026-10-01T00:00:00Z");
const inDays = (n: number) => new Date(+now + n * 86400000);

test("a package covers a school when its limit is at least the school's learners", () => {
  assert.equal(covers({ maxLearners: 200 }, 200), true);
  assert.equal(covers({ maxLearners: 200 }, 201), false);
  assert.equal(covers({ maxLearners: null }, 5000), true);
});
test("packages list smallest first with the unlimited one last", () => {
  const sorted = bySize([{ maxLearners: null, subscriptionPrice: D(30000) }, { maxLearners: 500, subscriptionPrice: D(15000) }, { maxLearners: 200, subscriptionPrice: D(8000) }]);
  assert.deepEqual(sorted.map(p => p.maxLearners), [200, 500, null]);
});
test("an upgrade costs the difference in daily rate for the days left, rounded up", () => {
  const small = { maxLearners: 200, price: D(8000), durationDays: 120, expiresAt: inDays(60) };
  // (15000 - 8000) / 120 per day x 60 days = 3500
  assert.equal(upgradeQuote(small, { maxLearners: 500, subscriptionPrice: D(15000), durationDays: 120 }, now)?.price.toFixed(2), "3500.00");
  assert.equal(upgradeQuote(small, { maxLearners: 500, subscriptionPrice: D(15000), durationDays: 120 }, now)?.daysLeft, 60);
  // 7 days left: 7000 / 120 x 7 = 408.33 -> 409
  assert.equal(upgradeQuote({ ...small, expiresAt: inDays(7) }, { maxLearners: null, subscriptionPrice: D(15000), durationDays: 120 }, now)?.price.toFixed(2), "409.00");
});
test("only a bigger package on a running licence is an upgrade", () => {
  const medium = { maxLearners: 500, price: D(15000), durationDays: 120, expiresAt: inDays(60) };
  assert.equal(upgradeQuote(medium, { maxLearners: 200, subscriptionPrice: D(8000), durationDays: 120 }, now), null, "smaller");
  assert.equal(upgradeQuote(medium, { maxLearners: 500, subscriptionPrice: D(15000), durationDays: 120 }, now), null, "same size");
  assert.equal(upgradeQuote({ ...medium, maxLearners: null }, { maxLearners: 800, subscriptionPrice: D(20000), durationDays: 120 }, now), null, "already unlimited");
  assert.equal(upgradeQuote(null, { maxLearners: 800, subscriptionPrice: D(20000), durationDays: 120 }, now), null, "no licence yet");
  assert.equal(upgradeQuote({ ...medium, expiresAt: inDays(-1) }, { maxLearners: 800, subscriptionPrice: D(20000), durationDays: 120 }, now), null, "expired");
});
