import { randomUUID } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import { ApiError, type Tx, type Identity } from "./core";
import { platformAudit } from "./platform";
import { PROVIDERS, PROVIDER_NAME, availableMethods, learnerLimit, pricingView } from "./billing";

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
export function coverage(managed: boolean, licences: Pick<SchoolLicence, "startsAt" | "expiresAt" | "revokedAt">[], now = new Date(), trialEndsAt: Date | null = null) {
  if (!managed && trialEndsAt) {
    const onTrial = trialEndsAt > now;
    return { managed, accessAllowed: onTrial, status: onTrial ? "trial" : "expired", currentEndsAt: onTrial ? trialEndsAt : null };
  }
  const valid = licences.filter(l => !l.revokedAt).sort((a, b) => +a.startsAt - +b.startsAt);
  let end: Date | null = null;
  for (const item of valid) {
    if (item.startsAt <= (end ?? now) && item.expiresAt > (end ?? now)) end = item.expiresAt;
  }
  return { managed, accessAllowed: !managed || !!end,
    status: !managed ? "unmanaged" : end ? "active" : valid.some(l => l.startsAt > now) ? "scheduled" : "expired",
    currentEndsAt: end };
}
// ---------- Packages sized by learner count ----------
type Plan = Prisma.LicencePlanGetPayload<{}>;
/** A package covers a school when its learner limit is at least the school's active learners; no limit covers anyone. */
export const covers = (plan: { maxLearners: number | null }, learners: number) => plan.maxLearners === null || plan.maxLearners >= learners;
const bigger = (a: number | null, b: number | null) => b !== null && (a === null || a > b);
/** Smallest first, the unlimited one last: the order a school reads them in. */
export const bySize = <T extends { maxLearners: number | null; subscriptionPrice: Prisma.Decimal }>(plans: T[]) =>
  [...plans].sort((a, b) => (a.maxLearners ?? Infinity) - (b.maxLearners ?? Infinity) || a.subscriptionPrice.comparedTo(b.subscriptionPrice));
/** The licence in force now that sets the school's learner limit: the one an upgrade would replace. */
export async function currentLicence(client: Tx | typeof db, schoolId: string, now = new Date()) {
  const active = await client.schoolLicence.findMany({ where: { schoolId, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } } });
  return active.sort((a, b) => (b.maxLearners ?? Infinity) - (a.maxLearners ?? Infinity) || +b.expiresAt - +a.expiresAt)[0] ?? null;
}
/**
 * What moving to a bigger package costs today: the difference between the two packages' daily rates, for the days
 * left on the current licence, rounded up to a whole shilling. Null when the plan is not a step up.
 */
export function upgradeQuote(current: { maxLearners: number | null; price: Prisma.Decimal; durationDays: number; expiresAt: Date } | null, plan: Pick<Plan, "maxLearners" | "subscriptionPrice" | "durationDays">, now = new Date()) {
  if (!current || !bigger(plan.maxLearners, current.maxLearners)) return null;
  const daysLeft = Math.ceil((+current.expiresAt - +now) / DAY_MS);
  if (daysLeft < 1) return null;
  const difference = plan.subscriptionPrice.div(plan.durationDays).minus(current.price.div(current.durationDays)).times(daysLeft);
  if (!difference.greaterThan(0)) return null;
  return { daysLeft, price: difference.toDecimalPlaces(0, Prisma.Decimal.ROUND_UP) };
}
export async function publicPackages() {
  const plans = bySize(await db.licencePlan.findMany({ where: { isActive: true } }));
  return plans.map(p => ({ name: p.name, durationDays: p.durationDays, price: p.subscriptionPrice.toFixed(2), maxLearners: p.maxLearners }));
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
  const [pricing, methods, activeLearners, maxLearners, holding] = await Promise.all([
    pricingView(), availableMethods(), db.student.count({ where: { schoolId, status: "active" } }), learnerLimit(db, schoolId, now), currentLicence(db, schoolId, now),
  ]);
  const packages = bySize(plans.filter(p => p.isActive)).map(p => ({
    id: p.id, name: p.name, description: p.description, durationDays: p.durationDays, price: p.subscriptionPrice.toFixed(2), maxLearners: p.maxLearners,
    fits: covers(p, activeLearners), current: !!holding && holding.planId === p.id,
    upgradePrice: upgradeQuote(holding, p, now)?.price.toFixed(2) ?? null,
  }));
  return { ...coverage(school.licenceManaged, licences, now, school.trialEndsAt), trialEndsAt: school.licenceManaged ? null : school.trialEndsAt,
    pricing, learners: { active: activeLearners, max: maxLearners }, plans: plans.map(planView), packages,
    licences: licences.map(l => licenceView(l, now)), orders: orders.map(orderView),
    paymentMethods: [
      ...PROVIDERS.map(id => ({ id, name: PROVIDER_NAME[id], available: methods.includes(id), reason: methods.includes(id) ? "" : "Not offered yet." })),
      { id: "manual" as const, name: "Bank transfer or cash", available: true, reason: "Pay Rejista directly and they record the payment against your invoice." },
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
  // An upgrade takes effect now and lasts exactly as long as the licence it upgrades; a renewal adds its time after.
  const upgraded = order.kind === "upgrade" && order.upgradeOfId ? await tx.schoolLicence.findFirst({ where: { id: order.upgradeOfId, schoolId: order.schoolId, revokedAt: null, expiresAt: { gt: new Date() } } }) : null;
  const startsAt = upgraded ? new Date() : await nextLicenceStart(tx, order.schoolId);
  const licence = await tx.schoolLicence.create({ data: {
    id: randomUUID(), schoolId: order.schoolId, planId: order.planId, planName: order.planName,
    durationDays: order.durationDays, price: order.price, maxLearners: order.maxLearners, startsAt,
    expiresAt: upgraded ? upgraded.expiresAt : new Date(+startsAt + order.durationDays * DAY_MS), source: "payment",
  } });
  await tx.licenceOrder.update({ where: { id: order.id }, data: { licenceId: licence.id } });
  await tx.school.update({ where: { id: order.schoolId }, data: { licenceManaged: true } });
  await platformAudit(tx, identity, "licence.payment_activated", "Fully paid renewal activated the school licence", order.schoolId, licence.id, undefined, licenceView(licence));
}
