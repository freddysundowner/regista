import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { z } from "zod";
import { ApiError, body, lock, parse, send, type Tx } from "../lib/core";
import { platformAudit } from "../lib/platform";

// Mounted after platform identity + role + support read-only checks.
const router = Router({ mergeParams: true });
const ids = z.object({ schoolId: z.string().uuid(), invoiceId: z.string().uuid().optional(), paymentId: z.string().uuid().optional() });
const withPayments = { payments: { orderBy: { createdAt: "desc" as const } } };
type Invoice = Prisma.PlatformBillingInvoiceGetPayload<{ include: typeof withPayments }>;
const day = (value: Date) => value.toISOString().slice(0, 10);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const money = (value: string) => {
  const amount = new Prisma.Decimal(value);
  if (!amount.greaterThan(0)) throw new ApiError(400, "Amount must be greater than zero.");
  return amount;
};
const paid = (invoice: Invoice) => invoice.payments.filter(p => !p.reversedAt).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
export function platformInvoiceView(invoice: Invoice) {
  const received = paid(invoice);
  const balance = invoice.voidedAt ? new Prisma.Decimal(0) : invoice.amount.minus(received);
  const status = invoice.voidedAt ? "void" : balance.isZero() ? "paid" : day(invoice.dueOn) < today() ? "overdue" : received.greaterThan(0) ? "partial" : "unpaid";
  return { ...invoice, amount: invoice.amount.toFixed(2), paid: received.toFixed(2), balance: balance.toFixed(2), status,
    payments: invoice.payments.map(p => ({ ...p, amount: p.amount.toFixed(2) })) };
}
async function getInvoice(tx: Tx, schoolId: string, invoiceId: string) {
  const invoice = await tx.platformBillingInvoice.findFirst({ where: { id: invoiceId, schoolId }, include: withPayments });
  if (!invoice) throw new ApiError(404, "Invoice not found for this school.");
  return invoice;
}
async function schoolExists(tx: Tx | typeof db, schoolId: string) {
  if (!await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } })) throw new ApiError(404, "School not found.");
}
function correctionReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new ApiError(400, "Give a reason of at least 3 characters.");
  return trimmed;
}

router.get("/", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  await schoolExists(db, schoolId);
  const invoices = (await db.platformBillingInvoice.findMany({ where: { schoolId }, include: withPayments, orderBy: { createdAt: "desc" } })).map(platformInvoiceView);
  const active = invoices.filter(i => i.status !== "void");
  const sum = (list: typeof invoices, key: "amount" | "paid" | "balance") => list.reduce((total, i) => total.plus(i[key]), new Prisma.Decimal(0)).toFixed(2);
  send(res, "GetPlatformBilling", { currency: "KES", totalBilled: sum(active, "amount"), totalPaid: sum(active, "paid"),
    outstanding: sum(active, "balance"), overdue: sum(active.filter(i => i.status === "overdue"), "balance"), invoices });
});

router.post("/invoices", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  const input = body(schemas.CreatePlatformInvoiceBody.strict(), req.body);
  const amount = money(input.amount);
  const description = input.description.trim();
  if (description.length < 3) throw new ApiError(400, "Describe what the invoice is for.");
  if (input.dueOn < input.issuedOn) throw new ApiError(400, "Due date cannot be before the issue date.");
  if (!!input.periodStart !== !!input.periodEnd || (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd)) throw new ApiError(400, "Supply both service-period dates, with the end on or after the start.");
  const invoice = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    await schoolExists(tx, schoolId);
    const old = await tx.platformBillingInvoice.findUnique({ where: { id: input.requestId }, include: withPayments });
    if (old) {
      if (old.schoolId !== schoolId || old.description !== description || !old.amount.equals(amount) ||
        +old.issuedOn !== +input.issuedOn || +old.dueOn !== +input.dueOn ||
        +(old.periodStart ?? 0) !== +(input.periodStart ?? 0) || +(old.periodEnd ?? 0) !== +(input.periodEnd ?? 0)) throw new ApiError(409, "This request was already used for a different invoice. Start a new invoice.");
      return old;
    }
    const created = await tx.platformBillingInvoice.create({ data: {
      id: input.requestId, schoolId, number: `SUB-${input.requestId.toUpperCase()}`, description, amount,
      issuedOn: input.issuedOn, dueOn: input.dueOn, periodStart: input.periodStart, periodEnd: input.periodEnd,
    }, include: withPayments });
    await platformAudit(tx, req.identity, "billing.invoice_created", "Subscription invoice issued", schoolId, created.id, undefined, platformInvoiceView(created));
    return created;
  });
  send(res, "CreatePlatformInvoice", platformInvoiceView(invoice), 201);
});

router.post("/invoices/:invoiceId/payments", async (req, res) => {
  const { schoolId, invoiceId } = parse(ids, req.params);
  const input = body(schemas.RecordPlatformPaymentBody.strict(), req.body);
  const amount = money(input.amount);
  const reference = input.reference.trim();
  if (reference.length < 2) throw new ApiError(400, "Enter a payment or receipt reference.");
  if (day(input.paidOn) > today()) throw new ApiError(400, "A received payment cannot have a future date.");
  const invoice = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const current = await getInvoice(tx, schoolId, invoiceId!);
    const old = await tx.platformBillingPayment.findUnique({ where: { id: input.requestId } });
    if (old) {
      if (old.invoiceId !== current.id || !old.amount.equals(amount) || old.reference !== reference || old.method !== input.method || +old.paidOn !== +input.paidOn) throw new ApiError(409, "This request was already used for a different payment. Start a new payment.");
      return current;
    }
    if (current.voidedAt) throw new ApiError(409, "Cannot record a payment against a void invoice.");
    if (amount.greaterThan(current.amount.minus(paid(current)))) throw new ApiError(409, "Payment exceeds the outstanding balance.");
    // A payment reference identifies a single receipt per school, even across invoices.
    const duplicate = await tx.platformBillingPayment.findFirst({ where: { invoice: { schoolId }, method: input.method, reference, reversedAt: null } });
    if (duplicate) throw new ApiError(409, "This payment reference is already recorded for this school.");
    const payment = await tx.platformBillingPayment.create({ data: { id: input.requestId, invoiceId: current.id, amount, paidOn: input.paidOn, method: input.method, reference } });
    await platformAudit(tx, req.identity, "billing.payment_recorded", "Subscription payment received", schoolId, payment.id, undefined, { ...payment, amount: amount.toFixed(2) });
    return getInvoice(tx, schoolId, current.id);
  });
  send(res, "RecordPlatformPayment", platformInvoiceView(invoice), 201);
});

router.post("/invoices/:invoiceId/void", async (req, res) => {
  const { schoolId, invoiceId } = parse(ids, req.params);
  const reason = correctionReason(body(schemas.VoidPlatformInvoiceBody.strict(), req.body).reason);
  const invoice = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const current = await getInvoice(tx, schoolId, invoiceId!);
    if (current.voidedAt) return current;
    if (paid(current).greaterThan(0)) throw new ApiError(409, "Reverse recorded payments before voiding this invoice.");
    const updated = await tx.platformBillingInvoice.update({ where: { id: current.id }, data: { voidedAt: new Date() }, include: withPayments });
    await platformAudit(tx, req.identity, "billing.invoice_voided", reason, schoolId, current.id, platformInvoiceView(current), platformInvoiceView(updated));
    return updated;
  });
  send(res, "VoidPlatformInvoice", platformInvoiceView(invoice));
});

router.post("/invoices/:invoiceId/payments/:paymentId/reverse", async (req, res) => {
  const { schoolId, invoiceId, paymentId } = parse(ids, req.params);
  const reason = correctionReason(body(schemas.ReversePlatformPaymentBody.strict(), req.body).reason);
  const invoice = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const current = await getInvoice(tx, schoolId, invoiceId!);
    const payment = current.payments.find(p => p.id === paymentId);
    if (!payment) throw new ApiError(404, "Payment not found for this invoice.");
    if (payment.reversedAt) return current;
    const reversed = await tx.platformBillingPayment.update({ where: { id: payment.id }, data: { reversedAt: new Date() } });
    await platformAudit(tx, req.identity, "billing.payment_reversed", reason, schoolId, payment.id,
      { ...payment, amount: payment.amount.toFixed(2) }, { ...reversed, amount: reversed.amount.toFixed(2) });
    return getInvoice(tx, schoolId, current.id);
  });
  send(res, "ReversePlatformPayment", platformInvoiceView(invoice));
});
export default router;
