import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ApiError, parse } from "../lib/core";
import { decryptCredentials, digest, systemActor, verifySignature } from "../lib/integrations/security";
import { candidates, ingest } from "../lib/payments/pipeline";
import { money } from "../lib/finance/money";
import { json } from "../lib/finance/posting";
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
  await ingest(actor, { provider: "safaricom", providerTxnId: input.TransID, channel: "mpesa_c2b", amount: input.TransAmount, transactionTime: providerTime(input.TransTime), accountReference: input.BillRefNumber, payerPhone: input.MSISDN, payerName: [input.FirstName, input.MiddleName, input.LastName].filter(Boolean).join(" ") }, "callback", req.body);
  res.sendStatus(200);
});
router.post("/payments/prompt/:token", async (req, res) => {
  const { actor } = await callbackContext(String(req.params.token), req.ip);
  const callback = parse(z.object({ CheckoutRequestID: z.string(), MerchantRequestID: z.string(), ResultCode: z.number(), ResultDesc: z.string(), CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) }).optional() }), req.body?.Body?.stkCallback);
  const request = await db.stkRequest.findFirst({ where: { schoolId: actor.school.id, checkoutRequestId: callback.CheckoutRequestID, merchantRequestId: callback.MerchantRequestID } });
  if (!request) throw new ApiError(404, "Unknown checkout request");
  if (callback.ResultCode !== 0) {
    if (request.status !== "paid") await db.stkRequest.update({ where: { id: request.id }, data: { status: "failed", resultCode: String(callback.ResultCode) } });
    res.sendStatus(200); return;
  }
  const values = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map(i => [i.Name, String(i.Value ?? "")]));
  if (!values.MpesaReceiptNumber || !money(values.Amount).equals(request.amount)) throw new ApiError(400, "STK callback receipt or amount mismatch");
  if (fullPhone(values.PhoneNumber) !== request.phone) throw new ApiError(400, "STK callback payer does not match checkout");
  await ingest(actor, { provider: "safaricom", providerTxnId: values.MpesaReceiptNumber, channel: "mpesa_stk", amount: values.Amount, transactionTime: providerTime(values.TransactionDate), payerPhone: values.PhoneNumber, knownStudentId: request.studentId }, "callback", req.body);
  await db.stkRequest.update({ where: { id: request.id }, data: { status: "paid", resultCode: "0" } });
  res.sendStatus(200);
});
export default router;