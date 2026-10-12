import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { z } from "zod";
import { ApiError, authenticateIdentity, body, lock, parse, send, type Tx } from "../lib/core";
import { platformAudit, requirePlatform } from "../lib/platform";
import { registerSchoolBilling } from "./billing";
import { requireHosted } from "../lib/installation";
import { DAY_MS, covers, currentLicence, licenceView, nextLicenceStart, orderInclude, orderView, planView, subscriptionView, upgradeQuote } from "../lib/licensing";

// Mounted inside platform's existing role and support-access guards.
export const platformLicensing = Router();
const ids = z.object({ schoolId: z.string().uuid(), licenceId: z.string().uuid().optional() });
async function activeSchool(tx: Tx, id: string) {
  const school = await tx.school.findUnique({ where: { id } });
  if (!school) throw new ApiError(404, "School not found.");
  if (school.status !== "active") throw new ApiError(409, "The school must be approved and active before issuing or purchasing a licence.");
  return school;
}
async function activePlan(tx: Tx, id: string) {
  const plan = await tx.licencePlan.findUnique({ where: { id } });
  if (!plan?.isActive) throw new ApiError(409, "This licence plan is no longer available. Choose an active plan.");
  return plan;
}
function planInput(input: unknown) {
  const value = body(schemas.CreateLicencePlanBody.strict(), input);
  const price = new Prisma.Decimal(value.price);
  const subscriptionPrice = new Prisma.Decimal(value.subscriptionPrice);
  if (!price.greaterThan(0)) throw new ApiError(400, "Price must be greater than zero.");
  if (!subscriptionPrice.greaterThan(0)) throw new ApiError(400, "Subscription price must be greater than zero.");
  return { ...value, description: value.description ?? "", price, subscriptionPrice, maxLearners: value.maxLearners ?? null };
}
platformLicensing.get("/platform/licence-plans", async (req, res) => {
  requirePlatform(req);
  const plans = await db.licencePlan.findMany({ orderBy: [{ durationDays: "asc" }, { name: "asc" }] });
  send(res, "ListLicencePlans", plans.map(planView));
});
platformLicensing.post("/platform/licence-plans", async (req, res) => {
  requirePlatform(req);
  const input = planInput(req.body);
  const plan = await db.$transaction(async tx => {
    const created = await tx.licencePlan.create({ data: input });
    await platformAudit(tx, req.identity, "licence.plan_created", "Timed licence plan created", null, created.id, undefined, planView(created));
    return created;
  });
  send(res, "CreateLicencePlan", planView(plan), 201);
});
platformLicensing.patch("/platform/licence-plans/:planId", async (req, res) => {
  requirePlatform(req);
  const { planId } = parse(z.object({ planId: z.string().uuid() }), req.params);
  const input = planInput(req.body);
  const plan = await db.$transaction(async tx => {
    await lock(tx, planId);
    const before = await tx.licencePlan.findUnique({ where: { id: planId } });
    if (!before) throw new ApiError(404, "Plan not found.");
    const updated = await tx.licencePlan.update({ where: { id: planId }, data: input });
    await platformAudit(tx, req.identity, "licence.plan_updated", "Licence plan updated; previous purchases retain their terms", null, planId, planView(before), planView(updated));
    return updated;
  });
  send(res, "EditLicencePlan", planView(plan));
});
platformLicensing.get("/platform/schools/:schoolId/licensing", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  send(res, "GetPlatformLicensing", await subscriptionView(schoolId, true));
});
platformLicensing.post("/platform/schools/:schoolId/licences", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  const input = body(schemas.IssueSchoolLicenceBody.strict(), req.body);
  const licence = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    await activeSchool(tx, schoolId);
    const old = await tx.schoolLicence.findUnique({ where: { id: input.requestId } });
    if (old) {
      if (old.schoolId !== schoolId || old.durationDays !== input.durationDays || old.source !== "admin" || +(old.requestedStartsAt ?? 0) !== +(input.startsAt ?? 0)) throw new ApiError(409, "Request already used for another licence.");
      return old;
    }
    const startsAt = input.startsAt ?? await nextLicenceStart(tx, schoolId);
    const expiresAt = new Date(+startsAt + input.durationDays * DAY_MS);
    if (expiresAt <= new Date()) throw new ApiError(400, "The licence must end in the future.");
    // A direct grant records no payment; bill separately with an invoice if needed.
    const created = await tx.schoolLicence.create({ data: {
      id: input.requestId, schoolId, planId: null, planName: input.label?.trim() || `Granted by Rejista · ${input.durationDays} days`,
      durationDays: input.durationDays, price: new Prisma.Decimal(0), maxLearners: input.maxLearners,
      startsAt, expiresAt, requestedStartsAt: input.startsAt, source: "admin",
    } });
    await tx.school.update({ where: { id: schoolId }, data: { licenceManaged: true } });
    await platformAudit(tx, req.identity, "licence.issued", "Timed licence issued directly by the platform owner; no payment recorded", schoolId, created.id, undefined, licenceView(created));
    return created;
  });
  send(res, "IssueSchoolLicence", licenceView(licence), 201);
});
platformLicensing.post("/platform/schools/:schoolId/licences/:licenceId/revoke", async (req, res) => {
  const { schoolId, licenceId } = parse(ids, req.params);
  const licence = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.schoolLicence.findFirst({ where: { id: licenceId!, schoolId } });
    if (!old) throw new ApiError(404, "Licence not found for this school.");
    if (old.revocationType === "admin") return old;
    const updated = await tx.schoolLicence.update({ where: { id: old.id }, data: { revokedAt: new Date(), revocationType: "admin" } });
    await platformAudit(tx, req.identity, "licence.revoked", "School licence revoked by platform owner", schoolId, old.id, licenceView(old), licenceView(updated));
    return updated;
  });
  send(res, "RevokeSchoolLicence", licenceView(licence));
});

// School identity is derived from the session, never a client-provided school id.
export const schoolSubscription = Router();
schoolSubscription.use("/school/subscription", authenticateIdentity, async (req, _res, next) => {
  try {
    requireHosted();
    if (req.identity.user.role === "super_admin" || !req.identity.user.schoolId) throw new ApiError(403, "Sign in as school staff to manage a school subscription.");
    if (req.method !== "GET" && req.identity.user.role !== "school_admin") throw new ApiError(403, "Only school administrators can renew or cancel.");
    const school = await db.school.findUnique({ where: { id: req.identity.user.schoolId } });
    if (school?.status !== "active") throw new ApiError(403, "School approval and active status are required.");
    next();
  } catch (error) { next(error); }
});
schoolSubscription.get("/school/subscription", async (req, res) => {
  send(res, "GetSchoolSubscription", await subscriptionView(req.identity.user.schoolId!, false, req.identity.user.role === "school_admin"));
});
schoolSubscription.post("/school/subscription/orders", async (req, res) => {
  const input = body(schemas.RequestLicenceRenewalBody.strict(), req.body);
  const schoolId = req.identity.user.schoolId!;
  const order = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    await activeSchool(tx, schoolId);
    const old = await tx.licenceOrder.findUnique({ where: { id: input.requestId }, include: orderInclude });
    if (old) {
      if (old.schoolId !== schoolId || (old.planId ?? undefined) !== input.planId || (old.kind === "upgrade") !== !!input.upgrade) throw new ApiError(409, "This request was already used for a different renewal.");
      return old;
    }
    const open = await tx.licenceOrder.findMany({ where: { schoolId, invoice: { voidedAt: null } }, include: orderInclude });
    if (open.some(o => ["pending", "partial"].includes(orderView(o).status))) throw new ApiError(409, "There is an outstanding renewal request. Complete its payment or cancel it first.");
    // The published single subscription price is the default; legacy plans remain supported when named.
    let terms: { planId: string | null; planName: string; durationDays: number; price: Prisma.Decimal; maxLearners: number | null; kind?: string; upgradeOfId?: string };
    const learners = await tx.student.count({ where: { schoolId, status: "active" } });
    if (input.planId) {
      const plan = await activePlan(tx, input.planId);
      // A package has to cover the learners the school has today.
      if (!covers(plan, learners)) throw new ApiError(409, `${plan.name} covers up to ${plan.maxLearners!.toLocaleString("en-KE")} learners and you have ${learners.toLocaleString("en-KE")}. Choose a bigger package.`);
      if (input.upgrade) {
        const holding = await currentLicence(tx, schoolId);
        const quote = upgradeQuote(holding, plan);
        if (!holding || !quote) throw new ApiError(409, "That package is not an upgrade from the one you are on. Choose a bigger package, or renew instead.");
        terms = { planId: plan.id, planName: `Upgrade to ${plan.name}`, durationDays: quote.daysLeft, price: quote.price, maxLearners: plan.maxLearners, kind: "upgrade", upgradeOfId: holding.id };
      } else terms = { planId: plan.id, planName: plan.name, durationDays: plan.durationDays, price: plan.subscriptionPrice, maxLearners: plan.maxLearners };
    } else {
      if (input.upgrade) throw new ApiError(400, "Choose the package to upgrade to.");
      if (await tx.licencePlan.count({ where: { isActive: true } })) throw new ApiError(400, "Choose a package for your number of learners.");
      const pricing = await tx.subscriptionSettings.findUnique({ where: { id: "default" } });
      if (!pricing) throw new ApiError(409, "Subscription pricing has not been published yet. Contact Rejista support.");
      terms = { planId: null, planName: `Subscription · 1 ${pricing.periodLabel}`, durationDays: pricing.periodDays, price: pricing.price, maxLearners: pricing.maxLearners };
    }
    const invoiceId = randomUUID();
    // Invoice issue/due dates are calendar values; entitlement starts only when payment settles.
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const invoice = await tx.platformBillingInvoice.create({ data: {
      id: invoiceId, schoolId, number: `LIC-${invoiceId.slice(0, 8).toUpperCase()}`, description: terms.kind === "upgrade" ? `${terms.planName} — for the ${terms.durationDays} days left on the current licence` : `${terms.planName} — ${terms.durationDays}-day school licence`,
      amount: terms.price, issuedOn: today, dueOn: today,
    } });
    const created = await tx.licenceOrder.create({ data: { id: input.requestId, schoolId, ...terms, invoiceId: invoice.id }, include: orderInclude });
    await platformAudit(tx, req.identity, "licence.renewal_requested", "School administrator requested a licence renewal invoice", schoolId, created.id, undefined, orderView(created));
    return created;
  });
  send(res, "RequestLicenceRenewal", orderView(order), 201);
});
schoolSubscription.post("/school/subscription/orders/:orderId/cancel", async (req, res) => {
  const { orderId } = parse(z.object({ orderId: z.string().uuid() }), req.params);
  const schoolId = req.identity.user.schoolId!;
  const order = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const current = await tx.licenceOrder.findFirst({ where: { id: orderId, schoolId }, include: orderInclude });
    if (!current) throw new ApiError(404, "Renewal request not found.");
    if (current.invoice.voidedAt) return current;
    if (current.invoice.payments.some(p => !p.reversedAt)) throw new ApiError(409, "This invoice has recorded payments. Ask the platform administrator to correct them before cancelling.");
    await tx.platformBillingInvoice.update({ where: { id: current.invoiceId }, data: { voidedAt: new Date() } });
    const updated = await tx.licenceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    await platformAudit(tx, req.identity, "licence.renewal_cancelled", "Unpaid renewal request cancelled by school administrator", schoolId, orderId, orderView(current), orderView(updated));
    return updated;
  });
  send(res, "CancelLicenceRenewal", orderView(order));
});
registerSchoolBilling(schoolSubscription);
