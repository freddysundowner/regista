import { db } from "@workspace/db";
import { ApiError, owned, type Actor } from "../core";
import { money } from "../finance/money";
import { integration } from "./security";
import { fullPhone } from "../payments/matching";

async function daraja(schoolId: string) {
  const { config, credentials, publicConfig } = await integration(schoolId, "daraja");
  if (config.environment !== "sandbox") throw new ApiError(503, "Production Daraja product URLs require the school's approved go-live contract; sandbox contracts only are verified");
  if (!credentials.consumerKey || !credentials.consumerSecret || !publicConfig.shortcode) throw new ApiError(503, "Daraja credentials or shortcode are incomplete");
  const response = await fetch("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ApiError(503, "Daraja authentication failed");
  const auth = await response.json() as { access_token?: string };
  if (!auth.access_token) throw new ApiError(503, "Daraja did not return an access token");
  const post = async (path: string, payload: unknown) => {
    const result = await fetch(`https://sandbox.safaricom.co.ke${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    if (!result.ok) throw new ApiError(503, `Daraja request failed (${result.status})`);
    return await result.json() as Record<string, any>;
  };
  const timestamp = new Date(Date.now() + 3 * 3600000).toISOString().replace(/\D/g, "").slice(0, 14);
  return { credentials, publicConfig, timestamp, password: Buffer.from(`${publicConfig.shortcode}${credentials.passkey}${timestamp}`).toString("base64"), post };
}
function callbackBase() {
  const value = process.env.APP_BASE_URL;
  if (!value || !/^https:\/\/[^/]+/.test(value)) throw new ApiError(503, "APP_BASE_URL must be a public HTTPS origin");
  return value.replace(/\/$/, "");
}
export async function registerCallbacks(actor: Actor) {
  const api = await daraja(actor.school.id);
  const result = await api.post("/mpesa/c2b/v2/registerurl", {
    ShortCode: api.publicConfig.shortcode, ResponseType: "Completed",
    ConfirmationURL: `${callbackBase()}/api/payments/confirmation/${api.credentials.callbackToken}`,
    ValidationURL: `${callbackBase()}/api/payments/validation/${api.credentials.callbackToken}`,
  });
  await db.integrationEvent.create({ data: { schoolId: actor.school.id, provider: "daraja", event: "register_callbacks", status: result.ResponseCode === "0" ? "accepted" : "failed", detail: { responseCode: String(result.ResponseCode ?? ""), description: String(result.ResponseDescription ?? "") } } });
  if (String(result.ResponseCode) !== "0") throw new ApiError(503, "Daraja registration was not accepted");
  return { status: "accepted", message: "Registration accepted; this is not a payment verification or live acceptance test" };
}
export async function startStk(actor: Actor, input: { studentId: string; phone: string; amount: string; idempotencyKey: string }) {
  const schoolId = actor.school.id, student = await owned(db, "student", input.studentId, schoolId);
  const amount = money(input.amount), phone = fullPhone(input.phone);
  if (!phone || !phone.startsWith("2547")) throw new ApiError(400, "STK requires a documented 2547 phone; 2541 support awaits provider acceptance");
  if (!amount.greaterThan(0) || !amount.isInteger()) throw new ApiError(400, "Daraja STK requires a positive whole-shilling amount");
  if (student.admissionNo.length > 12) throw new ApiError(400, "Admission reference exceeds the provider's 12-character STK limit; configure a verified short alias first");
  let request = await db.stkRequest.findUnique({ where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: input.idempotencyKey } } });
  if (request) {
    if (request.studentId !== input.studentId || !request.amount.equals(amount) || request.phone !== phone) throw new ApiError(409, "STK idempotency key content changed");
    return request;
  }
  const api = await daraja(schoolId);
  request = await db.stkRequest.create({ data: { schoolId, studentId: input.studentId, phone, amount, idempotencyKey: input.idempotencyKey, requestedBy: actor.user.id, status: "submitting" } });
  try {
    const response = await api.post("/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: api.publicConfig.shortcode, Password: api.password, Timestamp: api.timestamp,
      TransactionType: "CustomerPayBillOnline", Amount: amount.toFixed(0), PartyA: phone, PartyB: api.publicConfig.shortcode,
      PhoneNumber: phone, CallBackURL: `${callbackBase()}/api/payments/prompt/${api.credentials.callbackToken}`,
      AccountReference: student.admissionNo, TransactionDesc: "School fees",
    });
    if (String(response.ResponseCode) !== "0" || !response.CheckoutRequestID) throw new ApiError(503, "Daraja did not accept the STK request");
    return db.stkRequest.update({ where: { id: request.id }, data: { status: "pending", checkoutRequestId: response.CheckoutRequestID, merchantRequestId: response.MerchantRequestID } });
  } catch (error) {
    await db.stkRequest.update({ where: { id: request.id }, data: { status: "submission_unknown" } });
    throw error;
  }
}
export async function queryStk(schoolId: string, id: string) {
  const request = await db.stkRequest.findFirst({ where: { id, schoolId } });
  if (!request?.checkoutRequestId) throw new ApiError(404, "STK request has no checkout identifier");
  const api = await daraja(schoolId);
  const response = await api.post("/mpesa/stkpushquery/v1/query", { BusinessShortCode: api.publicConfig.shortcode, Password: api.password, Timestamp: api.timestamp, CheckoutRequestID: request.checkoutRequestId });
  const resultCode = response.ResultCode === undefined ? undefined : String(response.ResultCode);
  // The query contract does not return receipt/amount; never fabricate a posting.
  return db.stkRequest.update({ where: { id }, data: { resultCode, status: resultCode === "0" ? "awaiting_receipt" : resultCode ? "failed" : "pending" } });
}
export function pullTransactions(): never {
  throw new ApiError(503, "Daraja Pull query endpoint, transport and pagination are not verified; upload an authorized statement. Live Pull unavailable.");
}