import { randomBytes } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import { ApiError, audit, owned, type Actor } from "../core";
import { money } from "../finance/money";
import { json } from "../finance/posting";
import { fullPhone } from "../payments/matching";
import { ingest, needsVerification } from "../payments/pipeline";
import { sunpayPlatform } from "../billing";
import { decryptCredentials, digest, encryptCredentials, equalSecret, systemActor } from "./security";

/**
 * SunPay (https://sunpay.co.ke/docs) for school fees. The platform holds one SunPay account; each school is
 * registered under it as a sub-merchant with the till or paybill the school already owns. Parents then pay either
 * from the M-Pesa menu (SunPay's paybill, with the school's own number as the account) or from a prompt on their
 * phone, and SunPay forwards the money, less its fee, to the school's till or paybill.
 */
const API = "https://api.sunpay.co.ke/api/v1";
const PROVIDER = "sunpay";
type Kind = "till" | "paybill";

async function request(key: string, method: "GET" | "POST", path: string, payload?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) });
  } catch { throw new ApiError(503, "SunPay could not be reached. Try again in a moment."); }
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  return { status: response.status, ok: response.ok, body };
}
function publicBase() {
  const value = process.env.APP_BASE_URL;
  if (!value || !/^https:\/\/[^/]+/.test(value)) throw new ApiError(503, "Rejista's public web address is not set up on this server yet, so SunPay can't send payments here. Contact Rejista support.");
  return value.replace(/\/$/, "");
}
async function platform() {
  const p = await sunpayPlatform();
  if (!p) throw new ApiError(409, "SunPay is not switched on for Rejista yet. Contact Rejista support.");
  return p;
}
const connection = (schoolId: string) => db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId, provider: PROVIDER } } });
const settings = (row: { publicConfig: Prisma.JsonValue }) => row.publicConfig as { type: Kind; shortcode: string; merchantRef?: string; merchantId?: string; businessName?: string };

/** What the M-Pesa tab shows: whether SunPay can be used, and how parents pay once the school is connected. */
export async function sunpayView(schoolId: string) {
  const [p, row] = await Promise.all([sunpayPlatform(), connection(schoolId)]);
  const s = row ? settings(row) : null;
  return {
    available: !!p, connected: !!row?.enabled, feePercent: "1.5",
    collectionPaybill: p?.paybill ?? null,
    type: s?.type ?? null, shortcode: s?.shortcode ?? null, merchantRef: s?.merchantRef ?? null,
    connectedAt: row?.enabled ? row.updatedAt : null,
  };
}

/** Registers the school's till or paybill with SunPay and starts listening for its payments. */
export async function connectSunpay(actor: Actor, input: { type: Kind; shortcode: string; phone?: string }) {
  const schoolId = actor.school.id, p = await platform(), base = publicBase();
  if (!/^\d{4,9}$/.test(input.shortcode)) throw new ApiError(400, "Enter the till or paybill number: 4 to 9 digits.");
  const phone = input.phone ? fullPhone(input.phone) : fullPhone(actor.school.phone ?? "");
  const existing = await connection(schoolId);
  if (existing?.enabled) throw new ApiError(409, "This school is already connected to SunPay. Disconnect it first to change the number.");
  // SunPay keeps a sub-merchant for good, so a school that reconnects with the same number reuses its registration.
  const kept = existing ? { ...settings(existing), ...decryptCredentials(existing.encryptedCredentials) } as Record<string, string> : null;
  const token = randomBytes(24).toString("base64url");
  let merchantId = kept?.merchantId, merchantRef = kept?.merchantRef, webhookSecret = kept?.webhookSecret, callbackToken = kept?.callbackToken;
  if (!kept || kept.shortcode !== input.shortcode || kept.type !== input.type || !merchantId || !webhookSecret || !callbackToken) {
    const result = await request(p.apiKey, "POST", "/merchants", {
      businessName: actor.school.name.slice(0, 255), ...(phone ? { phone } : {}),
      paybill: { type: input.type, shortcode: input.shortcode },
      webhookUrl: `${base}/api/integrations/sunpay/webhook/${token}`,
    });
    if (result.status === 409) throw new ApiError(409, "That till or paybill number is already registered with SunPay. If it belongs to your school, contact Rejista support to move it here.");
    if (!result.ok || !result.body?.id) throw new ApiError(502, `SunPay did not accept the registration${result.body?.message ? `: ${String(result.body.message).slice(0, 200)}` : "."}`);
    // Without its own notification address, payments would arrive at SunPay and never reach the school's books.
    if (!result.body.webhook?.secret || result.body.webhook.inheritedFromParent) throw new ApiError(502, "SunPay registered the number but did not set up payment notifications for it. Contact Rejista support before using it.");
    merchantId = String(result.body.id); merchantRef = String(result.body.merchantRef ?? ""); webhookSecret = String(result.body.webhook.secret); callbackToken = token;
  }
  await db.$transaction(async tx => {
    const data = {
      environment: "live", enabled: true, callbackTokenHash: digest(callbackToken!),
      encryptedCredentials: encryptCredentials({ webhookSecret: webhookSecret!, callbackToken: callbackToken!, merchantId: merchantId! }),
      publicConfig: json({ type: input.type, shortcode: input.shortcode, merchantRef, merchantId, businessName: actor.school.name }),
    };
    const saved = await tx.integrationConfig.upsert({ where: { schoolId_provider: { schoolId, provider: PROVIDER } }, create: { schoolId, provider: PROVIDER, ...data }, update: data });
    await audit(tx, actor, "connected", "integration", saved.id, undefined, { provider: PROVIDER, type: input.type, shortcode: input.shortcode, merchantRef });
  });
  return sunpayView(schoolId);
}

/** Stops using SunPay here. The registration at SunPay is left alone: deleting it there erases its payment history. */
export async function disconnectSunpay(actor: Actor) {
  const row = await connection(actor.school.id);
  if (!row?.enabled) throw new ApiError(409, "This school is not connected to SunPay.");
  await db.$transaction(async tx => {
    await tx.integrationConfig.update({ where: { id: row.id }, data: { enabled: false } });
    await audit(tx, actor, "disconnected", "integration", row.id, undefined, { provider: PROVIDER, shortcode: settings(row).shortcode });
  });
  return sunpayView(actor.school.id);
}

/**
 * Parents type "<school's number>#<admission number>" as the account, e.g. 998877#ADM123. Depending on how SunPay
 * routed it, the admission number arrives after the # in externalRef or on its own in subReference; either way this
 * returns just the learner's part, or nothing when only the school's number was typed.
 */
export function learnerReference(data: { externalRef?: unknown; subReference?: unknown }, school: { shortcode: string; merchantRef?: string }) {
  const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const own = new Set([school.shortcode, school.merchantRef ?? ""].filter(Boolean).map(v => v.toUpperCase()));
  const account = clean(data.externalRef), routed = clean(data.subReference);
  if (account.includes("#")) return account.slice(account.indexOf("#") + 1).trim() || undefined;
  if (routed && routed !== "#" && !own.has(routed.toUpperCase())) return routed;
  return account && !own.has(account.toUpperCase()) ? account : undefined;
}

/** A payment notification for one school, signed by SunPay with that school's own secret. */
export async function sunpayWebhook(token: string, rawBody: Buffer | undefined, signature: string | undefined, payload: any) {
  const row = await db.integrationConfig.findUnique({ where: { callbackTokenHash: digest(token) } });
  if (!row?.enabled || row.provider !== PROVIDER) throw new ApiError(404, "SunPay connection not found");
  const secret = decryptCredentials(row.encryptedCredentials).webhookSecret;
  const { createHmac } = await import("node:crypto");
  if (!rawBody || !signature || !secret || !equalSecret(createHmac("sha256", secret).update(rawBody).digest("hex"), signature)) throw new ApiError(401, "Invalid signature");
  const data = payload?.data;
  if (payload?.event !== "payment.completed" || data?.status !== "completed" || !data?.mpesaRef) return;
  const actor = await systemActor(row.schoolId), s = settings(row);
  const amount = money(String(data.amount)).toFixed(2), at = new Date(payload.timestamp ?? Date.now());
  const time = Number.isFinite(at.getTime()) ? at : new Date();
  // The admission number after the # is what matches the payment to a learner; without it, the payer's phone is used.
  const reference = learnerReference(data, s);
  const hold = await needsVerification(actor, PROVIDER, amount, time, String(data.mpesaRef));
  // Recorded under Safaricom's receipt number, so the same payment reported another way is never counted twice.
  await ingest(actor, {
    provider: "safaricom", providerTxnId: String(data.mpesaRef), channel: data.paymentType === "stk_push" ? "mpesa_stk" : "mpesa_c2b",
    amount, transactionTime: time, accountReference: reference, payerPhone: data.phoneNumber ? String(data.phoneNumber) : undefined, payerName: data.payerName ? String(data.payerName) : undefined,
  }, hold ? "callback_hold" : "sunpay_webhook", payload);
}

/** Whether phone prompts for this school go through SunPay: it is connected, and has no Daraja account of its own. */
export async function usesSunpayStk(schoolId: string) {
  const rows = await db.integrationConfig.findMany({ where: { schoolId, provider: { in: [PROVIDER, "daraja"] }, enabled: true }, select: { provider: true } });
  return rows.some(r => r.provider === PROVIDER) && !rows.some(r => r.provider === "daraja");
}
const marker = (transactionId: string) => `sunpay:${transactionId}`;

/** Sends an M-Pesa prompt to a parent's phone; the money is forwarded to the school's till or paybill. */
export async function startSunpayStk(actor: Actor, input: { studentId: string; phone: string; amount: string; idempotencyKey: string }) {
  const schoolId = actor.school.id, student = await owned(db, "student", input.studentId, schoolId);
  const amount = money(input.amount), phone = fullPhone(input.phone);
  if (!phone) throw new ApiError(400, "Enter a valid Kenyan mobile number for the M-Pesa prompt.");
  if (!amount.greaterThan(0) || !amount.isInteger()) throw new ApiError(400, "M-Pesa prompts take whole shillings only.");
  let stk = await db.stkRequest.findUnique({ where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: input.idempotencyKey } } });
  if (stk) {
    if (stk.studentId !== input.studentId || !stk.amount.equals(amount) || stk.phone !== phone) throw new ApiError(409, "STK idempotency key content changed");
    return stk;
  }
  const row = await connection(schoolId);
  if (!row?.enabled) throw new ApiError(503, "SunPay is not connected for this school.");
  const p = await platform(), base = publicBase(), s = settings(row);
  stk = await db.stkRequest.create({ data: { schoolId, studentId: input.studentId, phone, amount, idempotencyKey: input.idempotencyKey, requestedBy: actor.user.id, status: "submitting" } });
  try {
    const result = await request(p.apiKey, "POST", "/payments/stk-push", {
      phoneNumber: phone, amount: Number(amount.toFixed(0)), externalRef: student.admissionNo,
      // This address is not signed by SunPay, so a call to it only makes us ask SunPay what really happened.
      callbackUrl: `${base}/api/integrations/sunpay/prompt/${stk.id}`,
      settleTo: { type: s.type, shortcode: s.shortcode, ...(s.type === "paybill" ? { accountReference: student.admissionNo } : {}) },
    });
    if (!result.ok || !result.body?.success || !result.body.transactionId) throw new ApiError(503, `SunPay did not accept the M-Pesa prompt${result.body?.message ? `: ${String(result.body.message).slice(0, 200)}` : "."}`);
    return db.stkRequest.update({ where: { id: stk.id }, data: { status: "pending", checkoutRequestId: result.body.checkoutRequestId ? String(result.body.checkoutRequestId) : null, merchantRequestId: marker(String(result.body.transactionId)) } });
  } catch (error) {
    await db.stkRequest.update({ where: { id: stk.id }, data: { status: "submission_unknown" } });
    throw error;
  }
}
export const isSunpayStk = (stk: { merchantRequestId: string | null }) => !!stk.merchantRequestId?.startsWith("sunpay:");

/** Asks SunPay what became of a prompt and records the payment if it went through. Safe to call repeatedly. */
export async function refreshSunpayStk(schoolId: string, id: string) {
  const stk = await db.stkRequest.findFirst({ where: { id, schoolId } });
  if (!stk || !isSunpayStk(stk)) throw new ApiError(404, "M-Pesa prompt not found");
  if (!["pending", "submission_unknown"].includes(stk.status)) return stk;
  const p = await platform();
  const result = await request(p.apiKey, "GET", `/payments/${encodeURIComponent(stk.merchantRequestId!.slice("sunpay:".length))}`);
  const t = result.body;
  if (!result.ok || !t) return stk;
  if (t.status === "failed") return db.stkRequest.update({ where: { id }, data: { status: "failed", resultCode: "failed" } });
  // A prompt nobody answered: stop asking about it after half an hour.
  if (t.status !== "completed" || !t.mpesaRef) return stk.createdAt.getTime() < Date.now() - 30 * 60_000 ? db.stkRequest.update({ where: { id }, data: { status: "failed", resultCode: "timeout" } }) : stk;
  const actor = await systemActor(schoolId), paid = money(String(t.amount));
  const at = new Date(t.createdAt ?? Date.now()), time = Number.isFinite(at.getTime()) ? at : new Date();
  const hold = await needsVerification(actor, PROVIDER, paid.toFixed(2), time, String(t.mpesaRef));
  // The prompt named the learner, so a payment of the asked amount goes straight to them.
  const exact = paid.equals(stk.amount);
  await ingest(actor, {
    provider: "safaricom", providerTxnId: String(t.mpesaRef), channel: "mpesa_stk", amount: paid.toFixed(2), transactionTime: time,
    payerPhone: t.phoneNumber ? String(t.phoneNumber) : stk.phone, ...(exact ? { knownStudentId: stk.studentId } : {}),
  }, hold ? "callback_hold" : "sunpay_prompt", { Body: { stkCallback: { CheckoutRequestID: stk.checkoutRequestId } }, sunpay: t });
  return db.stkRequest.update({ where: { id }, data: { status: stk.status === "paid" ? "paid" : "processing", resultCode: "0" } });
}
