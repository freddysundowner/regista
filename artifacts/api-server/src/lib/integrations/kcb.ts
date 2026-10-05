import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { ApiError, parse } from "../core";

const text = z.string().trim().min(1).max(200);
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).refine(v => Number(v) > 0);
const accountSchema = z.object({
  transactionReference: text, requestId: text, timestamp: text,
  transactionAmount: amount, currency: z.literal("KES"),
  creditAccountIdentifier: text, customerReference: z.string().max(200).default(""),
  customerName: z.string().max(200).optional(), customerMobileNumber: z.string().max(30).optional(),
});
const tillSchema = z.object({
  header: z.object({ messageID: text, originatorConversationID: text, timeStamp: text }),
  requestPayload: z.object({
    primaryData: z.object({ businessKey: text, businessKeyType: z.literal("notifyBiller") }),
    additionalData: z.object({ notificationData: z.object({
      businessKey: z.string().max(200), businessKeyType: z.literal("BillReferenceNumber"),
      transactionID: text, transactionAmt: amount, transactionDate: text, currency: z.literal("KES"),
      debitMSISDN: z.string().max(30).optional(),
      firstName: z.string().max(200).optional(), middleName: z.string().max(200).optional(), lastName: z.string().max(200).optional(),
    }) }),
  }),
});

export function kcbPublicKey(pem: string) {
  try {
    if (pem.includes("PRIVATE KEY")) throw new Error("Private keys are not accepted");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("RSA 2048 required");
    return key;
  } catch { throw new ApiError(400, "Provide the KCB-issued RSA public key (PEM, at least 2048 bits), not a private key"); }
}

export function verifyKcbSignature(pem: string, raw: Buffer, signature: string) {
  if (!raw.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 2048 ||
      !verify("RSA-SHA256", raw, kcbPublicKey(pem), Buffer.from(signature, "base64"))) {
    throw new ApiError(401, "Invalid KCB notification signature");
  }
}

// Buni examples use compact EAT timestamps (12 or 14 digits).
// Reject invalid/ambiguous dates rather than treating server time as payment time.
export function kcbTime(value: string) {
  if (!/^\d{12}(\d{2})?$/.test(value)) throw new ApiError(400, "Unsupported KCB timestamp; expected YYYYMMDDHHmm[ss] in EAT");
  const v = value.length === 12 ? value + "00" : value;
  const date = new Date(`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:${v.slice(12,14)}+03:00`);
  const local = new Date(date.getTime() + 3 * 3600000);
  if (!Number.isFinite(date.getTime()) || local.toISOString().replace(/\D/g, "").slice(0,14) !== v || date.getTime() > Date.now() + 300000) {
    throw new ApiError(400, "Invalid KCB timestamp");
  }
  return date;
}

export function kcbTillTime(value: string) {
  const m = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) EAT (\d{4})$/.exec(value);
  if (!m) throw new ApiError(400, "Unsupported KCB till transaction date");
  const month = String(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[1]) + 1).padStart(2,"0");
  return kcbTime(`${m[6]}${month}${m[2].padStart(2,"0")}${m[3]}${m[4]}${m[5]}`);
}

export function normalizeKcb(kind: "account" | "till", body: unknown, config: { accountNumber?: string; tillBusinessKey?: string }) {
  if (kind === "account") {
    const p = parse(accountSchema, body);
    if (!config.accountNumber || p.creditAccountIdentifier !== config.accountNumber) throw new ApiError(403, "KCB receiving account does not match this school");
    return {
      input: { provider: "kcb", providerTxnId: p.transactionReference, channel: "bank" as const, amount: p.transactionAmount,
        transactionTime: kcbTime(p.timestamp), accountReference: p.customerReference, payerName: p.customerName, payerPhone: p.customerMobileNumber },
      acknowledgement: { transactionID: p.requestId, statusCode: "0", statusMessage: "Notification received successfully" },
    };
  }
  const p = parse(tillSchema, body), n = p.requestPayload.additionalData.notificationData;
  if (!config.tillBusinessKey || p.requestPayload.primaryData.businessKey !== config.tillBusinessKey) throw new ApiError(403, "KCB receiving business key does not match this school");
  return {
    input: { provider: "kcb", providerTxnId: n.transactionID, channel: "bank" as const, amount: n.transactionAmt,
      transactionTime: kcbTillTime(n.transactionDate), accountReference: n.businessKey,
      payerPhone: n.debitMSISDN, payerName: [n.firstName, n.middleName, n.lastName].filter(Boolean).join(" ") },
    acknowledgement: { header: { messageID: p.header.messageID, originatorConversationID: p.header.originatorConversationID,
      statusCode: "0", statusMessage: "Notification received successfully" }, responsePayload: { transactionInfo: { transactionId: n.transactionID } } },
  };
}
