import test from "node:test";
import assert from "node:assert/strict";
import { netPaymentCredits, planWindowCredits, termInvoiceBilling, nairobiStatementRange, type CashEntry } from "./finance/review-invariants";
import { money } from "./finance/money";

const entry = (id: string, type: string, debit: string, credit: string, reversesId: string | null = null): CashEntry => ({ id, type, debit: money(debit), credit: money(credit), reversesId });
test("plans ignore invoice cancellation, concessions and reversed concessions", () => {
  const entries = [
    entry("invoice", "invoice", "100", "0"),
    entry("cancel", "reversal", "0", "100", "invoice"),
    entry("waiver", "adjustment", "0", "30"),
    entry("unwaive", "reversal", "30", "0", "waiver"),
  ];
  assert.equal(netPaymentCredits(entries).toFixed(2), "0.00");
});
test("plans count only exact net payments, subtracting cash reversal and refund", () => {
  assert.equal(netPaymentCredits([
    entry("cash", "payment", "0", "100.10"),
    entry("bank", "payment", "0", "50.20"),
    entry("reverse", "reversal", "50.20", "0", "bank"),
    entry("refund", "refund", "20.05", "0"),
  ]).toFixed(2), "80.05");
});
test("inclusive Nairobi statement end includes evening and excludes next midnight", () => {
  const { from, until } = nairobiStatementRange("2026-10-02", "2026-10-02");
  assert.equal(from.toISOString(), "2026-10-01T21:00:00.000Z");
  assert.equal(until.toISOString(), "2026-10-02T21:00:00.000Z");
  for (const value of ["2026-10-02T00:00:00+03:00", "2026-10-02T23:59:59.999+03:00"]) {
    assert.ok(new Date(value) >= from && new Date(value) < until);
  }
  assert.equal(new Date("2026-10-03T00:00:00+03:00") < until, false);
});
test("successive or legacy overlapping plans cannot consume the same payment; late reversal reduces its original window", () => {
  const first = new Date("2026-01-01"), next = new Date("2026-02-01");
  const entries = [
    { ...entry("first", "payment", "0", "100"), createdAt: new Date("2026-01-10") },
    { ...entry("second", "payment", "0", "40"), createdAt: next },
    { ...entry("late-reversal", "reversal", "100", "0", "first"), createdAt: new Date("2026-03-01") },
  ];
  assert.equal(planWindowCredits(entries, first, next).toFixed(2), "0.00");
  assert.equal(planWindowCredits(entries, next).toFixed(2), "40.00");
});
test("billing follows invoice term identity and compensations regardless of posting date", () => {
  const entries = [
    { ...entry("first", "invoice", "100", "0"), termId: "term-one" },
    { ...entry("second", "invoice", "50", "0"), termId: "term-two" },
    { ...entry("cancel", "reversal", "0", "100", "first"), termId: null },
  ];
  assert.equal(termInvoiceBilling(entries, "term-one").toFixed(2), "0.00");
  assert.equal(termInvoiceBilling(entries, "term-two").toFixed(2), "50.00");
});
test("period collections deduct reversals whose original payment was in an earlier period", () => {
  const entries = [
    { ...entry("original", "payment", "0", "100"), createdAt: new Date("2026-01-01") },
    { ...entry("reverse", "reversal", "100", "0", "original"), createdAt: new Date("2026-02-01") },
  ];
  assert.equal(netPaymentCredits(entries, e => e.createdAt >= new Date("2026-02-01")).toFixed(2), "-100.00");
});