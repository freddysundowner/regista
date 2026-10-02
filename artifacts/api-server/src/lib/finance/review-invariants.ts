import type { Prisma } from "@workspace/db";
import { sum } from "./money";

export type CashEntry = { id: string; type: string; reversesId: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal };
/** Invoice cancellations and fee concessions are not installment payments. */
export function netPaymentCredits<T extends CashEntry>(entries: T[], include: (entry: T) => boolean = () => true) {
  const payments = new Set(entries.filter(e => e.type === "payment").map(e => e.id));
  return sum(entries.filter(e => include(e) && (e.type === "payment" || e.type === "refund" || (e.type === "reversal" && !!e.reversesId && payments.has(e.reversesId)))).map(e => e.credit.minus(e.debit)));
}
export function termInvoiceBilling(entries: (CashEntry & { termId: string | null })[], termId?: string) {
  const invoices = new Set(entries.filter(e => e.type === "invoice" && !!termId && e.termId === termId).map(e => e.id));
  return sum(entries.filter(e => invoices.has(e.id) || (!!e.reversesId && invoices.has(e.reversesId))).map(e => e.debit.minus(e.credit)));
}
export function planWindowCredits(entries: (CashEntry & { createdAt: Date })[], from: Date, until?: Date) {
  const inWindow = (at: Date) => at >= from && (!until || at < until);
  const payments = new Set(entries.filter(e => e.type === "payment" && inWindow(e.createdAt)).map(e => e.id));
  return netPaymentCredits(entries.filter(e => payments.has(e.id) || (e.type === "refund" && inWindow(e.createdAt)) || (!!e.reversesId && payments.has(e.reversesId))));
}

/** Date-only statement controls select complete Kenyan civil days. */
export function nairobiStatementRange(fromDate: string | Date, toDate: string | Date) {
  const day = (value: string | Date) => new Date(value).toISOString().slice(0, 10);
  return {
    from: new Date(`${day(fromDate)}T00:00:00+03:00`),
    until: new Date(new Date(`${day(toDate)}T00:00:00+03:00`).getTime() + 86400000),
  };
}