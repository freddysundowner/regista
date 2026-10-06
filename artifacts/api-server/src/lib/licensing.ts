import { randomUUID } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import { ApiError, type Tx, type Identity } from "./core";
import { platformAudit } from "./platform";

export const DAY_MS = 86400000;
type SchoolLicence = Prisma.SchoolLicenceGetPayload<{}>;
export const orderInclude = { invoice: { include: { payments: true } } } as const;
type Order = Prisma.LicenceOrderGetPayload<{ include: typeof orderInclude }>;
export function licenceView(row: SchoolLicence, now = new Date()) {
  return { ...row, price: row.price.toFixed(2), status: row.revokedAt ? "revoked" : row.startsAt > now ? "scheduled" : row.expiresAt <= now ? "expired" : "active" };
}
export function planView(row: { price: Prisma.Decimal; subscriptionPrice: Prisma.Decimal } & Record<string, unknown>) {
  return { ...row, price: row.price.toFixed(2), subscriptionPrice: row.subscriptionPrice.toFixed(2), currency: "KES" };
}
export function orderView(row: Order) {
  const paid = row.invoice.payments.filter(p => !p.reversedAt).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const balance = row.invoice.voidedAt ? new Prisma.Decimal(0) : row.price.minus(paid);
  return { id: row.id, invoiceId: row.invoiceId, invoiceNumber: row.invoice.number, planName: row.planName,
    durationDays: row.durationDays, price: row.price.toFixed(2), paid: paid.toFixed(2), balance: balance.toFixed(2),
    status: row.invoice.voidedAt ? "cancelled" : balance.lessThanOrEqualTo(0) ? "paid" : paid.greaterThan(0) ? "partial" : "pending", createdAt: row.createdAt };
}
export function coverage(managed: boolean, licences: Pick<SchoolLicence, "startsAt" | "expiresAt" | "revokedAt">[], now = new Date()) {
  const valid = licences.filter(l => !l.revokedAt).sort((a, b) => +a.startsAt - +b.startsAt);
  let end: Date | null = null;
  for (const item of valid) {
    if (item.startsAt <= (end ?? now) && item.expiresAt > (end ?? now)) end = item.expiresAt;
  }
  return { managed, accessAllowed: !managed || !!end,
    status: !managed ? "unmanaged" : end ? "active" : valid.some(l => l.startsAt > now) ? "scheduled" : "expired",
    currentEndsAt: end };
}
export async function subscriptionView(schoolId: string, platform = false, includeOrders = true) {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) throw new ApiError(404, "School not found.");
  const [plans, licences, orders] = await Promise.all([
    db.licencePlan.findMany({ where: platform ? {} : { isActive: true }, orderBy: [{ durationDays: "asc" }, { name: "asc" }] }),
    db.schoolLicence.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" } }),
    includeOrders ? db.licenceOrder.findMany({ where: { schoolId }, include: orderInclude, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const now = new Date();
  return { ...coverage(school.licenceManaged, licences, now), plans: plans.map(planView),
    licences: licences.map(l => licenceView(l, now)), orders: orders.map(orderView),
    paymentMethods: [
      { id: "manual", name: "Admin-recorded payment", available: true, reason: "Request an invoice, arrange payment with the platform administrator, then wait for payment to be recorded." },
      { id: "mpesa", name: "M-Pesa", available: false, reason: "Online M-Pesa payments are not configured." },
      { id: "stripe", name: "Card via Stripe", available: false, reason: "Stripe is not connected." },
      { id: "paystack", name: "Paystack", available: false, reason: "Online Paystack payments are not configured." },
    ] };
}
/** Called only while holding the school advisory lock. Early renewals preserve all purchased time. */
export async function nextLicenceStart(tx: Tx, schoolId: string, now = new Date()) {
  const last = await tx.schoolLicence.findFirst({ where: { schoolId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: "desc" } });
  return last?.expiresAt ?? now;
}
/** Invoice settlement and entitlement changes commit atomically under the same school lock. */
export async function syncLicencePayment(tx: Tx, invoiceId: string, identity: Identity) {
  const order = await tx.licenceOrder.findUnique({ where: { invoiceId }, include: { ...orderInclude, licence: true } });
  if (!order) return; // Ordinary manual invoices do not alter access.
  const fullyPaid = orderView(order).status === "paid";
  const existing = order.licence;
  if (!fullyPaid) {
    if (existing && !existing.revokedAt) {
      const updated = await tx.schoolLicence.update({ where: { id: existing.id }, data: { revokedAt: new Date(), revocationType: "payment" } });
      await platformAudit(tx, identity, "licence.payment_revoked", "Licence suspended because its invoice is no longer fully paid", order.schoolId, existing.id, licenceView(existing), licenceView(updated));
    }
    return;
  }
  if (existing) {
    if (existing.revocationType === "payment") {
      const updated = await tx.schoolLicence.update({ where: { id: existing.id }, data: { revokedAt: null, revocationType: null } });
      await platformAudit(tx, identity, "licence.payment_activated", "Payment restored the original licence dates", order.schoolId, existing.id, licenceView(existing), licenceView(updated));
    }
    return;
  }
  const startsAt = await nextLicenceStart(tx, order.schoolId);
  const licence = await tx.schoolLicence.create({ data: {
    id: randomUUID(), schoolId: order.schoolId, planId: order.planId, planName: order.planName,
    durationDays: order.durationDays, price: order.price, startsAt,
    expiresAt: new Date(+startsAt + order.durationDays * DAY_MS), source: "payment",
  } });
  await tx.licenceOrder.update({ where: { id: order.id }, data: { licenceId: licence.id } });
  await tx.school.update({ where: { id: order.schoolId }, data: { licenceManaged: true } });
  await platformAudit(tx, identity, "licence.payment_activated", "Fully paid renewal activated the school licence", order.schoolId, licence.id, undefined, licenceView(licence));
}
