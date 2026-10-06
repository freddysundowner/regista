import { Router } from "express";
import { db, type Prisma } from "@workspace/db";
import { GetPlatformSubscriptionsQueryParams } from "@workspace/api-zod";
import { parse, send } from "../lib/core";
import { platformInvoiceView } from "./platform-billing";

// Mounted behind the same platform-owner boundary as per-school billing.
export const platformSubscriptions = Router();
platformSubscriptions.get("/platform/subscriptions", async (req, res) => {
  const input = parse(GetPlatformSubscriptionsQueryParams, req.query);
  const search = input.search?.trim();
  const invoicePage = input.invoicePage ?? 1;
  const paymentPage = input.paymentPage ?? 1;
  const pageSize = 25;
  const text = { contains: search, mode: "insensitive" as const };
  const invoiceWhere: Prisma.PlatformBillingInvoiceWhereInput = search ? {
    OR: [
      { number: text }, { description: text },
      { school: { name: text } }, { school: { code: text } },
      { payments: { some: { reference: text } } },
    ],
  } : {};
  const paymentWhere: Prisma.PlatformBillingPaymentWhereInput = search ? {
    OR: [{ reference: text }, { invoice: invoiceWhere }],
  } : {};
  const [invoices, invoiceTotal, payments, paymentTotal] = await db.$transaction([
    db.platformBillingInvoice.findMany({
      where: invoiceWhere,
      include: { school: { select: { name: true, code: true } }, payments: { orderBy: { createdAt: "desc" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (invoicePage - 1) * pageSize, take: pageSize,
    }),
    db.platformBillingInvoice.count({ where: invoiceWhere }),
    db.platformBillingPayment.findMany({
      where: paymentWhere,
      include: { invoice: { include: { school: { select: { name: true, code: true } } } } },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (paymentPage - 1) * pageSize, take: pageSize,
    }),
    db.platformBillingPayment.count({ where: paymentWhere }),
  ]);
  send(res, "GetPlatformSubscriptions", {
    invoices: invoices.map(invoice => ({
      ...platformInvoiceView(invoice), schoolName: invoice.school.name, schoolCode: invoice.school.code,
    })),
    payments: payments.map(payment => ({
      id: payment.id, amount: payment.amount.toFixed(2), paidOn: payment.paidOn,
      method: payment.method, reference: payment.reference, reversedAt: payment.reversedAt,
      createdAt: payment.createdAt, schoolId: payment.invoice.schoolId,
      schoolName: payment.invoice.school.name, schoolCode: payment.invoice.school.code,
      invoiceId: payment.invoiceId, invoiceNumber: payment.invoice.number,
      description: payment.invoice.description,
    })),
    invoiceTotal, paymentTotal, pageSize,
  });
});
