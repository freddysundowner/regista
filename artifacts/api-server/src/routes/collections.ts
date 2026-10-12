import { Router } from "express";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { allow, admin, readers, writers, auditors, body, send, ApiError, audit } from "../lib/core";
import { saveIntegration } from "../lib/integrations/security";
import { registerCallbacks, startStk } from "../lib/integrations/daraja";
import { connectSunpay, disconnectSunpay, sunpayView } from "../lib/integrations/sunpay";
import { ingest, resolveException, postedStkStatus } from "../lib/payments/pipeline";
import { previewStatement, reconcileStatement } from "../lib/integrations/banks";
import { financeTransaction, record, view } from "../lib/finance/posting";
import { createRecord } from "../lib/finance/service";
import { sum, money } from "../lib/finance/money";
import { createPlan, decidePlan, planView } from "../lib/payments/plans";
import { queueMessage, messageReadiness } from "../lib/integrations/messages";
import { REMOVED_PREFIX } from "../lib/students";
import { decideUnmatchedRefund, payUnmatchedRefund, sponsorAcknowledgement, requestUnmatchedRefund } from "../lib/payments/settlements";
import { z } from "zod";

const router = Router();
router.get("/reconciliation/refunds", async (req, res) => { allow(req, readers); res.json(view(await db.collectionRefund.findMany({ where: { schoolId: req.actor.school.id }, orderBy: { createdAt: "desc" } }))); });
router.post("/reconciliation/refunds/:id/decision", async (req, res) => {
  const input = body(z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(1) }), req.body);
  res.json(view(await decideUnmatchedRefund(req.actor, String(req.params.id), input.decision, input.reason)));
});
router.post("/reconciliation/refunds/:id/paid", async (req, res) => {
  const input = body(z.object({ reference: z.string().trim().min(1).max(200) }), req.body);
  res.json(view(await payUnmatchedRefund(req.actor, String(req.params.id), input.reference)));
});
router.get("/reconciliation/sponsors/batches", async (req, res) => { allow(req, readers); res.json(view(await db.sponsorBatch.findMany({ where: { schoolId: req.actor.school.id }, orderBy: { createdAt: "desc" } }))); });
router.post("/reconciliation/sponsors/:id/refund", async (req, res) => {
  allow(req, ["bursar"]);
  const input = body(z.object({ reason: z.string().trim().min(1) }), req.body);
  res.json(view(await financeTransaction(req.actor, async tx => {
    const batch = await tx.sponsorBatch.findFirst({ where: { schoolId: req.actor.school.id, id: String(req.params.id) } });
    if (!batch) throw new ApiError(404, "Sponsor batch not found");
    let exception = await tx.matchException.findFirst({ where: { schoolId: req.actor.school.id, paymentId: batch.paymentId } });
    if (!exception) exception = await tx.matchException.create({ data: { schoolId: req.actor.school.id, paymentId: batch.paymentId, reason: "sponsor_remainder", status: "sponsor_remainder_held", candidates: [] } });
    return requestUnmatchedRefund(tx, req.actor, exception.id, input.reason);
  })));
});
router.post("/reconciliation/sponsors/:id/acknowledgement", async (req, res) => { allow(req, readers); res.json(await sponsorAcknowledgement(req.actor, String(req.params.id))); });
router.get("/integrations/config", async (req, res) => {
  allow(req, admin);
  const configs = await db.integrationConfig.findMany({ where: { schoolId: req.actor.school.id }, select: { provider: true, enabled: true, environment: true } });
  res.json(["daraja", "leadsintel", "africastalking", "bot", "bank"].map(provider => {
    const config = configs.find(c => c.provider === provider);
    return { provider, enabled: config?.enabled ?? false, environment: config?.environment ?? "sandbox", configured: !!config, status: !process.env.ENCRYPTION_KEY ? "encryption_key_missing" : config?.enabled ? "unverified" : "not_configured", reason: provider === "bank" ? "KCB signed notifications supported; KCB onboarding, public key and live acceptance required. No statement-pull or payment initiation." : provider === "daraja" ? "Sandbox adapter available; live acceptance and Pull query contract unverified" : "No live delivery or connectivity verified" };
  }));
});
router.put("/integrations/config", async (req, res) => { allow(req, admin); res.json(await saveIntegration(req.actor, body(schemas.ConfigureIntegrationBody, req.body))); });
router.get("/integrations/sunpay", async (req, res) => { allow(req, admin); send(res, "GetSunpayConnection", await sunpayView(req.actor.school.id)); });
router.post("/integrations/sunpay", async (req, res) => { allow(req, admin); send(res, "ConnectSunpay", await connectSunpay(req.actor, body(schemas.ConnectSunpayBody.strict(), req.body))); });
router.post("/integrations/sunpay/disconnect", async (req, res) => { allow(req, admin); send(res, "DisconnectSunpay", await disconnectSunpay(req.actor)); });
router.post("/integrations/daraja/register", async (req, res) => { allow(req, admin); res.json(await registerCallbacks(req.actor)); });
router.get("/payments/incoming", async (req, res) => {
  allow(req, readers);
  const query = body(z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).default(50), status: z.string().optional(), search: z.string().optional(), id: z.string().uuid().optional() }), req.query);
  const where = { schoolId: req.actor.school.id, status: query.status || undefined, id: query.id, ...(query.search ? { OR: ["providerTxnId", "accountReference", "payerName", "payerPhone"].map(key => ({ [key]: { contains: query.search, mode: "insensitive" as const } })) } : {}) };
  res.set("X-Total-Count", String(await db.incomingPayment.count({ where })));
  res.json(view(await db.incomingPayment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}), omit: { rawPayload: true } })));
});
router.get("/payments/incoming/:id", async (req, res) => {
  allow(req, readers);
  const payment = await db.incomingPayment.findFirst({ where: { schoolId: req.actor.school.id, id: String(req.params.id) }, omit: { rawPayload: true } });
  if (!payment) throw new ApiError(404, "Incoming payment not found");
  res.json(view(payment));
});
router.post("/payments/incoming", async (req, res) => {
  allow(req, ["bursar"]);
  const input = body(schemas.IngestIncomingPaymentBody, req.body);
  // This is a staff statement import, not a claim that a provider callback was verified.
  res.json(view(await ingest(req.actor, input)));
});
router.get("/reconciliation/queue", async (req, res) => { allow(req, readers); res.json(view(await db.matchException.findMany({ where: { schoolId: req.actor.school.id, status: "open" }, orderBy: { createdAt: "asc" } }))); });
router.post("/reconciliation/queue/:id/resolve", async (req, res) => { allow(req, ["bursar"]); res.json(await resolveException(req.actor, String(req.params.id), body(schemas.ResolvePaymentExceptionBody, req.body))); });
router.post("/payments/stk", async (req, res) => { allow(req, writers); res.json(view(await startStk(req.actor, body(schemas.StartStkPaymentBody, req.body)))); });
router.get("/payments/stk/:id", async (req, res) => {
  allow(req, readers);
  const request = await db.stkRequest.findFirst({ where: { schoolId: req.actor.school.id, id: String(req.params.id) } });
  if (!request) throw new ApiError(404, "STK request not found");
  res.json(view(await postedStkStatus(db, request)));
});
router.post("/reconciliation/statements/preview", async (req, res) => { allow(req, writers); res.json(view(await previewStatement(body(schemas.PreviewBankStatementBody, req.body)))); });
router.post("/reconciliation/statements", async (req, res) => { allow(req, ["bursar"]); res.json(view(await reconcileStatement(req.actor, body(schemas.ReconcileStatementBody, req.body)))); });
router.get("/reconciliation/statements", async (req, res) => { allow(req, readers); res.json(view(await db.reconciliationRun.findMany({ where: { schoolId: req.actor.school.id }, orderBy: { createdAt: "desc" }, take: 100 }))); });
router.post("/reconciliation/sponsors", async (req, res) => {
  allow(req, ["bursar"]);
  const input = body(schemas.AllocateSponsorPaymentBody, req.body);
  const result = await financeTransaction(req.actor, async tx => {
    const payment = await tx.incomingPayment.findFirst({ where: { schoolId: req.actor.school.id, id: input.paymentId } });
    if (!payment) throw new ApiError(404, "Payment not found");
    await record(tx, req.actor.school.id, input.sponsorId, "sponsor");
    if (!["received", "unmatched", "suspended", "sponsor_remainder_held"].includes(payment.status)) throw new ApiError(409, "Payment already allocated or awaiting sponsor approval");
    const priorBatch = await tx.sponsorBatch.findUnique({ where: { paymentId: payment.id } });
    if (priorBatch && priorBatch.sponsorId !== input.sponsorId) throw new ApiError(409, "Held funds belong to the original sponsor");
    const held = priorBatch ? sum((await tx.suspenseEntry.findMany({ where: { schoolId: req.actor.school.id, paymentId: payment.id } })).map(e => e.credit.minus(e.debit))) : payment.amount;
    const total = sum(input.allocations.map(a => money(a.amount)));
    if (total.gt(held) || !total.gt(0) || new Set(input.allocations.map(a => a.studentId)).size !== input.allocations.length) throw new ApiError(400, "Invalid sponsor allocations or insufficient held funds");
    if (!total.equals(held) && !input.remainderReason) throw new ApiError(400, "Unallocated remainder requires a reason");
    const batch = priorBatch ?? await tx.sponsorBatch.create({ data: { schoolId: req.actor.school.id, paymentId: payment.id, sponsorId: input.sponsorId, allocatedAmount: total, heldAmount: payment.amount, remainderReason: input.remainderReason, requestedBy: req.actor.user.id } });
    for (const split of input.allocations) {
      const oldLink = await tx.sponsorAllocation.findUnique({ where: { batchId_studentId: { batchId: batch.id, studentId: split.studentId } } });
      if (oldLink) {
        const oldCredit = await record(tx, req.actor.school.id, oldLink.financeRecordId);
        if (!["rejected", "reversed"].includes(oldCredit.status)) throw new ApiError(409, "Learner already has a pending or approved sponsor allocation");
      }
      const credit = await createRecord(tx, req.actor, {
      kind: "adjustment", idempotencyKey: `sponsor:${payment.id}:${split.studentId}:${oldLink?.financeRecordId ?? "initial"}`, studentId: split.studentId,
      amount: split.amount, reason: input.reason, adjustmentType: input.type, sponsorId: input.sponsorId, reference: payment.id,
      });
      await tx.sponsorAllocation.upsert({ where: { batchId_studentId: { batchId: batch.id, studentId: split.studentId } }, create: { schoolId: req.actor.school.id, batchId: batch.id, studentId: split.studentId, financeRecordId: credit.id, amount: money(split.amount) }, update: { financeRecordId: credit.id, amount: money(split.amount) } });
    }
    await tx.sponsorBatch.update({ where: { id: batch.id }, data: { status: "pending", heldAmount: held } });
    await tx.incomingPayment.update({ where: { id: payment.id }, data: { status: "sponsor_pending" } });
    await tx.matchException.updateMany({ where: { schoolId: req.actor.school.id, paymentId: payment.id }, data: { status: "sponsor_pending", expiresAt: null, resolution: "sponsor_batch" } });
    await audit(tx, req.actor, "sponsor_allocation_requested", "incoming_payment", payment.id, undefined, { sponsorId: input.sponsorId, remainder: held.minus(total).toFixed(2), remainderReason: input.remainderReason });
    return { id: batch.id, status: "pending", message: "Sponsor credits require independent approval in the finance inbox; unallocated/rejected amounts remain held" };
  });
  res.json(result);
});
router.get("/payment-plans", async (req, res) => {
  allow(req, readers);
  const plans = await db.paymentPlan.findMany({ where: { schoolId: req.actor.school.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  res.json(view(await Promise.all(plans.map(p => planView(db, req.actor.school.id, p.id)))));
});
router.post("/payment-plans", async (req, res) => { allow(req, ["bursar"]); res.json(view(await createPlan(req.actor, body(schemas.CreatePaymentPlanBody, req.body)))); });
router.post("/payment-plans/:id/decision", async (req, res) => {
  allow(req, auditors);
  const input = body(schemas.DecidePaymentPlanBody, req.body);
  res.json(view(await decidePlan(req.actor, String(req.params.id), input.decision, input.reason)));
});
router.get("/notifications", async (req, res) => {
  allow(req, readers);
  res.json(view(await db.messageDelivery.findMany({ where: { schoolId: req.actor.school.id, template: { not: "otp" } }, select: { id: true, guardianId: true, channel: true, template: true, status: true, attempts: true, error: true, providerMessageId: true }, orderBy: { createdAt: "desc" }, take: 500 })));
});
// Everyone a notice should reach: each parent who gets messages for at least one active learner, once each
// (a parent of three children gets one message), optionally just one grade's.
const audience = (schoolId: string, gradeId?: string) => db.guardian.findMany({
  where: { schoolId, anonymizedAt: null, students: { some: { receivesNotifications: true, student: { status: "active", NOT: { admissionNo: { startsWith: REMOVED_PREFIX } }, ...(gradeId ? { gradeId } : {}) } } } },
  select: { id: true, phone: true }, orderBy: { createdAt: "asc" },
}).then((rows) => [...new Map(rows.filter((g) => g.phone).map((g) => [g.phone, g])).values()]);
router.get("/notifications/audience", async (req, res) => {
  allow(req, admin);
  const { gradeId } = schemas.GetMessageAudienceQueryParams.parse(req.query);
  send(res, "GetMessageAudience", { parents: (await audience(req.actor.school.id, gradeId)).length });
});
router.post("/notifications/broadcast", async (req, res) => {
  allow(req, admin);
  const input = body(schemas.BroadcastSchoolMessageBody.strict(), req.body);
  const parents = await audience(req.actor.school.id, input.gradeId);
  if (!parents.length) throw new ApiError(409, "No parents to send to. Link guardians to learners first.");
  let queued = 0, skipped = 0, reason = "";
  for (const guardian of parents) {
    // A parent this channel cannot reach is skipped, not a reason to stop: the rest still get the notice.
    try {
      await messageReadiness(req.actor.school.id, input.channel, input.template, guardian.id);
      await queueMessage(db, req.actor.school.id, { guardianId: guardian.id, phone: guardian.phone, channel: input.channel, template: input.template, content: input.content.trim(), idempotencyKey: `${input.idempotencyKey}:${guardian.id}` });
      queued++;
    } catch (error) { skipped++; reason ||= error instanceof ApiError ? error.message : "Could not queue"; }
  }
  if (!queued) throw new ApiError(503, `Nothing was sent. ${reason}`);
  await db.$transaction((tx) => audit(tx, req.actor, "message_broadcast", "school", req.actor.school.id, undefined, { channel: input.channel, template: input.template, gradeId: input.gradeId ?? null, queued, skipped }));
  send(res, "BroadcastSchoolMessage", { queued, skipped });
});
router.post("/notifications", async (req, res) => {
  allow(req, admin);
  const input = body(schemas.SendSchoolMessageBody, req.body);
  const guardian = await db.guardian.findFirst({ where: { id: input.guardianId, schoolId: req.actor.school.id, anonymizedAt: null } });
  if (!guardian) throw new ApiError(404, "Guardian not found");
  await messageReadiness(req.actor.school.id, input.channel, input.template, guardian.id);
  res.json(view(await queueMessage(db, req.actor.school.id, { ...input, phone: guardian.phone })));
});
export default router;