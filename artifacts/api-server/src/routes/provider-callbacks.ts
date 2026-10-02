import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ApiError, parse } from "../lib/core";
import { decryptCredentials, digest, systemActor, verifySignature } from "../lib/integrations/security";
import { candidates, ingest } from "../lib/payments/pipeline";
import { money } from "../lib/finance/money";
import { json, financeTransaction } from "../lib/finance/posting";
import { fullPhone } from "../lib/payments/matching";

const router = Router();
router.post("/integrations/leadsintel/events/:token", async (req, res) => {
  const config = await db.integrationConfig.findUnique({ where: { callbackTokenHash: digest(String(req.params.token)) } });
  if (!config?.enabled || config.provider !== "leadsintel") throw new ApiError(404, "Webhook configuration not found");
  const credentials = decryptCredentials(config.encryptedCredentials);
  if (!credentials.webhookSecret || !credentials.phoneNumberId) throw new ApiError(503, "LeadsIntel webhook secret and phoneNumberId required");
  const eventId = req.get("X-LeadIntel-Event-Id");
  if (!eventId) throw new ApiError(401, "Event identity required");
  verifySignature(credentials.webhookSecret, req.get("X-LeadIntel-Timestamp") ?? "", req.rawBody ?? Buffer.alloc(0), req.get("X-LeadIntel-Signature") ?? "");
  const input = parse(z.object({ metadata: z.object({ phone_number_id: z.string() }), messages: z.array(z.object({ from: z.string(), timestamp: z.string() })).optional() }), req.body);
  if (input.metadata.phone_number_id !== credentials.phoneNumberId) throw new ApiError(403, "Connection phone number identity mismatch");
  const key = { schoolId: config.schoolId, signatureHash: digest(`leadsintel:${eventId}`) };
  if (await db.botReplay.findUnique({ where: { schoolId_signatureHash: key } })) { res.sendStatus(200); return; }
  await db.$transaction(async tx => {
    await tx.botReplay.create({ data: { ...key, expiresAt: new Date(Date.now() + 86400000) } });
    for (const message of input.messages ?? []) {
      const phone = fullPhone(message.from), at = new Date(Number(message.timestamp) * 1000);
      if (!phone || !Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 300000 || at.getTime() < Date.now() - 86400000) continue;
      await tx.guardian.updateMany({ where: { schoolId: config.schoolId, phone, OR: [{ whatsappLastInboundAt: null }, { whatsappLastInboundAt: { lt: at } }] }, data: { whatsappLastInboundAt: at } });
    }
  });
  res.sendStatus(200);
});
async function callbackContext(token: string, ip?: string) {
  const config = await db.integrationConfig.findUnique({ where: { callbackTokenHash: digest(token) } });
  if (!config?.enabled || config.provider !== "daraja") throw new ApiError(404, "Callback configuration not found");
  const credentials = decryptCredentials(config.encryptedCredentials);
  if (credentials.allowedIps && !credentials.allowedIps.split(",").map(i => i.trim()).includes(ip ?? "")) throw new ApiError(403, "Callback IP not allowed");
  return { config, actor: await systemActor(config.schoolId), publicConfig: config.publicConfig as Record<string, string> };
}
const c2b = z.object({ TransID: z.string().min(1), TransTime: z.string().regex(/^\d{14}$/), TransAmount: z.union([z.string(), z.number()]).transform(String), BusinessShortCode: z.union([z.string(), z.number()]).transform(String), BillRefNumber: z.string().default(""), MSISDN: z.union([z.string(), z.number()]).transform(String).optional(), FirstName: z.string().optional(), MiddleName: z.string().optional(), LastName: z.string().optional() });
function providerTime(value: string) {
  const stamp = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+03:00`;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) throw new ApiError(400, "Invalid provider transaction time");
  return date;
}
async function requireTransactionVerification(actor: Awaited<ReturnType<typeof systemActor>>, amount: string, at: Date, transactionId: string, unusual: boolean) {
  const settings = actor.school.settings as Record<string, any>;
  const threshold = money(String(settings.highValuePaymentThreshold ?? "100000"));
  if (!threshold.gt(0) || money(amount).gte(threshold) || unusual || at.getTime() > Date.now() + 300000 || Date.now() - at.getTime() > 48 * 3600000) {
    // Transaction Status is asynchronous and requires an entitled initiator,
    // authenticated result correlation and verified amount/shortcode/receipt.
    // No approved result-authentication contract is installed: never substitute
    // STK Query success or callback possession for transaction verification.
    await db.integrationEvent.create({ data: { schoolId: actor.school.id, provider: "daraja", event: "transaction_verification_required", status: "blocked_contract_required", detail: { transactionId, amount } } });
    throw new ApiError(503, "Payment requires independent Transaction Status verification; approved provider verification contract is unavailable. No ledger posting was made");
  }
}
router.post("/payments/validation/:token", async (req, res) => {
  const { config, actor, publicConfig } = await callbackContext(String(req.params.token), req.ip);
  const input = parse(c2b, req.body);
  if (input.BusinessShortCode !== publicConfig.shortcode) { res.json({ ResultCode: "C2B00015", ResultDesc: "Rejected" }); return; }
  if (!money(input.TransAmount).gt(0)) { res.json({ ResultCode: "C2B00013", ResultDesc: "Rejected" }); return; }
  try {
    const match = await candidates(db, actor, { accountReference: input.BillRefNumber, payerPhone: input.MSISDN ?? null, payerName: null, bankAccountFrom: null, amount: money(input.TransAmount) });
    const valid = match.candidates.some(c => c.reasons.some(r => ["exact_reference", "normalized_reference", "learned_alias"].includes(r)) && !c.reasons.includes("inactive_student"));
    res.json({ ResultCode: valid ? "0" : "C2B00012", ResultDesc: valid ? "Accepted" : "Rejected" });
  } catch {
    await db.integrationEvent.create({ data: { schoolId: config.schoolId, provider: "daraja", event: "validation_lookup_failure", status: "accepted_fallback", detail: {} } }).catch(() => undefined);
    res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }
});
router.post("/payments/confirmation/:token", async (req, res) => {
  const { actor, publicConfig } = await callbackContext(String(req.params.token), req.ip);
  const input = parse(c2b, req.body);
  if (input.BusinessShortCode !== publicConfig.shortcode) throw new ApiError(400, "Shortcode does not match callback route");
  const match = await candidates(db, actor, { accountReference: input.BillRefNumber, payerPhone: input.MSISDN ?? null, payerName: null, bankAccountFrom: null, amount: money(input.TransAmount) });
  const phone = fullPhone(input.MSISDN);
  const similar = phone ? await db.incomingPayment.findFirst({ where: { schoolId: actor.school.id, providerTxnId: { not: input.TransID }, payerPhone: phone, amount: money(input.TransAmount), transactionTime: { gte: new Date(providerTime(input.TransTime).getTime() - 600000), lte: new Date(providerTime(input.TransTime).getTime() + 600000) } } }) : null;
  await requireTransactionVerification(actor, input.TransAmount, providerTime(input.TransTime), input.TransID, !match.winner || !!similar);
  await ingest(actor, { provider: "safaricom", providerTxnId: input.TransID, channel: "mpesa_c2b", amount: input.TransAmount, transactionTime: providerTime(input.TransTime), accountReference: input.BillRefNumber, payerPhone: input.MSISDN, payerName: [input.FirstName, input.MiddleName, input.LastName].filter(Boolean).join(" ") }, "callback", req.body);
  res.sendStatus(200);
});
router.post("/payments/prompt/:token", async (req, res) => {
  const { actor } = await callbackContext(String(req.params.token), req.ip);
  const callback = parse(z.object({ CheckoutRequestID: z.string(), MerchantRequestID: z.string(), ResultCode: z.number(), ResultDesc: z.string(), CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) }).optional() }), req.body?.Body?.stkCallback);
  const request = await db.stkRequest.findFirst({ where: { schoolId: actor.school.id, checkoutRequestId: callback.CheckoutRequestID, merchantRequestId: callback.MerchantRequestID } });
  if (!request) throw new ApiError(404, "Unknown checkout request");
  if (callback.ResultCode !== 0) {
    await db.stkRequest.updateMany({ where: { id: request.id, status: { in: ["submitting", "pending", "submission_unknown", "awaiting_receipt"] } }, data: { status: "failed", resultCode: String(callback.ResultCode) } });
    res.sendStatus(200); return;
  }
  const values = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map(i => [i.Name, String(i.Value ?? "")]));
  if (!values.MpesaReceiptNumber || !money(values.Amount).equals(request.amount)) throw new ApiError(400, "STK callback receipt or amount mismatch");
  if (fullPhone(values.PhoneNumber) !== request.phone) throw new ApiError(400, "STK callback payer does not match checkout");
  await requireTransactionVerification(actor, values.Amount, providerTime(values.TransactionDate), values.MpesaReceiptNumber, false);
  const incoming = await ingest(actor, { provider: "safaricom", providerTxnId: values.MpesaReceiptNumber, channel: "mpesa_stk", amount: values.Amount, transactionTime: providerTime(values.TransactionDate), payerPhone: values.PhoneNumber, knownStudentId: request.studentId }, "callback", req.body);
  await financeTransaction(actor, async tx => {
    // Preserve linkage even when the same receipt arrived through C2B first.
    const key = { schoolId: actor.school.id, kind: "stk_confirmation", uniqueKey: request.id };
    const link = await tx.financeRecord.findUnique({ where: { schoolId_kind_uniqueKey: key } });
    if (link && (link.data as any).incomingPaymentId !== incoming.id) throw new ApiError(409, "Checkout has conflicting receipt identities");
    if (!link) await tx.financeRecord.create({ data: { ...key, studentId: request.studentId, requestedBy: actor.user.id, status: "received", data: { incomingPaymentId: incoming.id, requestId: request.id } } });
    const allocation = await tx.paymentStudentAllocation.findFirst({ where: { schoolId: actor.school.id, paymentId: incoming.id, studentId: request.studentId, amount: request.amount } });
    const posted = allocation && await tx.ledgerEntry.findFirst({ where: { schoolId: actor.school.id, referenceId: allocation.postingId, type: "payment", credit: request.amount } });
    await tx.stkRequest.update({ where: { id: request.id }, data: { status: posted ? "paid" : incoming.status === "matched" ? "reconciliation_required" : "processing", resultCode: "0" } });
  });
  res.sendStatus(200);
});
export default router;