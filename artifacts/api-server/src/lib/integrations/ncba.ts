import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { ApiError, parse } from "../core";
import { equalSecret } from "./security";

/** NCBA Till payments arrive under this paybill; the school's till number is then in BillRefNumber. */
export const NCBA_TILL_PAYBILL = "880100";
export type CollectionType = "ncba_till" | "paybill";

const text = z.string().trim().min(1).max(200);
const optional = z.string().max(200).nullish();
const notification = z.object({
  TransType: text, TransID: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/), TransTime: z.string().trim(),
  TransAmount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/).refine(v => Number(v) > 0, "Amount must be positive"),
  BusinessShortCode: z.string().trim().regex(/^[0-9A-Za-z]{3,20}$/),
  BillRefNumber: optional, Narrative: optional, Mobile: optional, name: optional, FTRef: optional, created_at: optional,
  Username: z.string().max(200), Password: z.string().max(200), Hash: z.string().max(400),
});
export type NcbaNotification = z.infer<typeof notification>;

/** NCBA uses "N/A", "null" or blanks for missing values. */
const present = (v?: string | null) => { const t = v?.trim(); return t && !/^(n\/a|null)$/i.test(t) ? t : undefined; };

/**
 * NCBA's documented hash: SHA-256 over secretKey + TransType + TransID + TransTime + TransAmount + shortcode +
 * BillRefNumber + Mobile + name + "1", as lowercase hex, then Base64 of that hex text.
 * Values are concatenated exactly as sent, including "N/A".
 */
export function ncbaHash(secretKey: string, n: Pick<NcbaNotification, "TransType" | "TransID" | "TransTime" | "TransAmount" | "BusinessShortCode" | "BillRefNumber" | "Mobile" | "name">) {
  const hex = createHash("sha256").update(secretKey + n.TransType + n.TransID + n.TransTime + n.TransAmount + n.BusinessShortCode + (n.BillRefNumber ?? "") + (n.Mobile ?? "") + (n.name ?? "") + "1", "utf8").digest("hex");
  return Buffer.from(hex, "utf8").toString("base64");
}

/** TransTime is YYYYMMDDhhmmss in Nairobi time. Impossible dates and times in the future are refused. */
export function ncbaTime(value: string) {
  if (!/^\d{14}$/.test(value)) throw new ApiError(400, "Unsupported NCBA TransTime; expected YYYYMMDDhhmmss");
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+03:00`);
  const local = new Date(date.getTime() + 3 * 3600000).toISOString().replace(/\D/g, "").slice(0, 14);
  if (!Number.isFinite(date.getTime()) || local !== value || date.getTime() > Date.now() + 300000) throw new ApiError(400, "Invalid NCBA TransTime");
  return date;
}

export type NcbaAccount = { collectionType: CollectionType; collectionNumber: string };
export type NcbaCredentials = { notificationUsername: string; notificationPassword: string; notificationSecretKey: string };

/**
 * Checks a notification against the credentials Rejista generated for this account and turns it into an
 * incoming payment. A wrong username or password is refused. A wrong hash with the right username and
 * password is kept but held for the bursar (`hashVerified: false`), because NCBA's hash recipe is not yet
 * confirmed against a live message and refusing would risk losing a real payment.
 */
export function normalizeNcba(body: unknown, account: NcbaAccount, credentials: NcbaCredentials) {
  const n = parse(notification, body);
  if (!equalSecret(n.Username, credentials.notificationUsername) || !equalSecret(n.Password, credentials.notificationPassword)) throw new ApiError(401, "Invalid NCBA notification credentials");
  const hashVerified = equalSecret(n.Hash.trim(), ncbaHash(credentials.notificationSecretKey, n));
  const till = account.collectionType === "ncba_till";
  if (till ? n.BusinessShortCode !== NCBA_TILL_PAYBILL || present(n.BillRefNumber) !== account.collectionNumber : n.BusinessShortCode !== account.collectionNumber) {
    throw new ApiError(403, "NCBA till or paybill does not match this school's account");
  }
  // Where the payer's reference (the admission number) is: NCBA Till → Narrative, own paybill → BillRefNumber.
  const accountReference = till ? present(n.Narrative) : present(n.BillRefNumber);
  const mobile = present(n.Mobile);
  const { Username: _u, Password: _p, Hash: _h, ...stored } = n;
  return {
    hashVerified,
    input: {
      provider: "ncba", providerTxnId: n.TransID.toUpperCase(), channel: "mpesa_c2b" as const, amount: n.TransAmount,
      transactionTime: ncbaTime(n.TransTime), accountReference,
      // NCBA may send a SHA-256 of the number instead of the number itself; that cannot identify a payer.
      payerPhone: mobile && !/^[0-9a-f]{64}$/i.test(mobile) ? mobile : undefined, payerName: present(n.name),
    },
    // Never store the shared secrets with the payment.
    rawPayload: stored,
  };
}

// No 0/O, 1/l/I: these are printed on a letter and typed in by bank staff.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const readableSecret = (length: number, alphabet = ALPHABET) => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
const name = () => readableSecret(8, "abcdefghjkmnpqrstuvwxyz23456789");
export function generateNcbaCredentials() {
  return {
    callbackToken: readableSecret(40),
    notificationUsername: `rejista-${name()}`,
    notificationPassword: readableSecret(20),
    notificationSecretKey: readableSecret(32),
    stkUsername: `rejista-stk-${name()}`,
    stkSecretKey: readableSecret(32),
  };
}
