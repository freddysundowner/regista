import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import { ApiError, lock, type Identity, type Tx } from "./core";
import { platformAudit } from "./platform";
import { decryptCredentials, digest, encryptCredentials, equalSecret } from "./integrations/security";
import { DAY_MS, licenceView, nextLicenceStart, orderInclude, orderView, syncLicencePayment } from "./licensing";
import { fullPhone } from "./payments/matching";
import { logger } from "./logger";
import { isStandalone, standaloneLearnerLimit } from "./installation";

export const PROVIDERS = ["mpesa", "stripe", "paystack"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_NAME: Record<Provider, string> = { mpesa: "M-Pesa (SunPay)", stripe: "Card (Stripe)", paystack: "Paystack" };
const FIELDS: Record<Provider, { config: string[]; requiredConfig: string[]; credentials: string[]; optional?: string[] }> = {
  // paybill: SunPay's collection paybill, shown to schools so parents know where to pay.
  mpesa: { config: ["paybill"], requiredConfig: [], credentials: ["apiKey", "webhookSecret"], optional: ["webhookSecret"] },
  stripe: { config: [], requiredConfig: [], credentials: ["secretKey", "webhookSecret"] },
  paystack: { config: [], requiredConfig: [], credentials: ["secretKey"] },
};
const DEFAULT_TRIAL_DAYS = 7;
const nairobiDay = () => new Date(new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date()) + "T00:00:00Z");

/** Public HTTPS origin for provider callbacks; absent in local development. */
export function publicBase() {
  const value = process.env.APP_BASE_URL;
  return value && /^https:\/\/[^/]+/.test(value) ? value.replace(/\/$/, "") : null;
}

// ---------- Pricing ----------
const strings = (value: Prisma.JsonValue) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
export async function pricingView(client: Tx | typeof db = db) {
  const row = await client.subscriptionSettings.findUnique({ where: { id: "default" } });
  if (!row) return { configured: false, currency: "KES" as const, price: "0.00", periodDays: 0, periodLabel: "", maxLearners: null, trialDays: DEFAULT_TRIAL_DAYS, highlights: [] as string[] };
  return { configured: true, currency: "KES" as const, price: row.price.toFixed(2), periodDays: row.periodDays, periodLabel: row.periodLabel,
    maxLearners: row.maxLearners, trialDays: row.trialDays, highlights: strings(row.highlights) };
}
export async function savePricing(identity: Identity, input: { price: string; periodDays: number; periodLabel: string; maxLearners: number | null; trialDays: number; highlights: string[] }) {
  const price = new Prisma.Decimal(input.price);
  if (!price.greaterThan(0)) throw new ApiError(400, "Price must be greater than zero.");
  const periodLabel = input.periodLabel.trim();
  if (periodLabel.length < 2) throw new ApiError(400, "Name the billing period, for example \"term\" or \"year\".");
  const highlights = input.highlights.map(h => h.trim()).filter(Boolean);
  const data = { price, periodDays: input.periodDays, periodLabel, maxLearners: input.maxLearners, trialDays: input.trialDays, highlights };
  return db.$transaction(async tx => {
    const before = await pricingView(tx);
    await tx.subscriptionSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
    const after = await pricingView(tx);
    await platformAudit(tx, identity, "billing.pricing_updated", "Subscription pricing updated; existing licences keep their purchased terms", null, "default", before, after);
    return after;
  });
}
export async function trialEnd(tx: Tx, from = new Date()) {
  const days = (await tx.subscriptionSettings.findUnique({ where: { id: "default" }, select: { trialDays: true } }))?.trialDays ?? DEFAULT_TRIAL_DAYS;
  return new Date(+from + days * DAY_MS);
}

// ---------- Registration ----------
export async function requireApproval(client: Tx | typeof db = db) {
  return (await client.platformSettings.findUnique({ where: { id: "default" } }))?.requireRegistrationApproval ?? true;
}
export async function saveRegistrationSettings(identity: Identity, input: { requireApproval: boolean }) {
  return db.$transaction(async tx => {
    const before = { requireApproval: await requireApproval(tx) };
    await tx.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", requireRegistrationApproval: input.requireApproval }, update: { requireRegistrationApproval: input.requireApproval } });
    await platformAudit(tx, identity, "platform.registration_settings_updated", input.requireApproval ? "New school registrations now wait for approval" : "New school registrations are now activated immediately on the free trial", null, "default", before, input);
    return { requireApproval: input.requireApproval };
  });
}

// ---------- Learner limit ----------
/** Highest learner allowance across licences covering now; null means unlimited (trial, unmanaged or uncapped). */
export async function learnerLimit(client: Tx | typeof db, schoolId: string, now = new Date()) {
  if (isStandalone()) return standaloneLearnerLimit();
  const school = await client.school.findUnique({ where: { id: schoolId }, select: { licenceManaged: true } });
  if (!school?.licenceManaged) return null;
  const active = await client.schoolLicence.findMany({ where: { schoolId, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } }, select: { maxLearners: true } });
  if (!active.length || active.some(l => l.maxLearners === null)) return null;
  return Math.max(...active.map(l => l.maxLearners!));
}
export async function enforceLearnerLimit(tx: Tx, schoolId: string, adding = 1) {
  await lock(tx, schoolId);
  const max = await learnerLimit(tx, schoolId);
  if (max === null) return;
  const active = await tx.student.count({ where: { schoolId, status: "active" } });
  if (active + adding > max) throw new ApiError(409, `Your subscription covers up to ${max.toLocaleString("en-KE")} active learners and you have ${active.toLocaleString("en-KE")}. Mark learners who have left as inactive, or upgrade to a bigger package under Subscription.`);
}

// ---------- Gateways ----------
type GatewayRow = Prisma.PaymentGatewayGetPayload<{}>;
function credentialsOf(row: GatewayRow | null): Record<string, string> {
  if (!row?.encryptedCredentials) return {};
  try { return decryptCredentials(row.encryptedCredentials); } catch { return {}; }
}
function configOf(row: GatewayRow | null): Record<string, string> {
  const value = row?.publicConfig;
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
}
function isConfigured(provider: Provider, config: Record<string, string>, credentials: Record<string, string>) {
  const f = FIELDS[provider];
  return f.requiredConfig.every(k => config[k]) && f.credentials.filter(k => !f.optional?.includes(k)).every(k => credentials[k]);
}
function webhookUrl(provider: Provider) {
  const base = publicBase();
  if (!base) return null;
  return `${base}/api/billing/webhooks/${provider === "mpesa" ? "sunpay" : provider}`;
}
function gatewayView(provider: Provider, row: GatewayRow | null) {
  const config = configOf(row), credentials = credentialsOf(row);
  return { provider, name: PROVIDER_NAME[provider], enabled: row?.enabled ?? false, environment: (row?.environment ?? "sandbox") as "sandbox" | "live",
    publicConfig: config, configured: isConfigured(provider, config, credentials),
    savedCredentials: FIELDS[provider].credentials.filter(k => credentials[k]), webhookUrl: webhookUrl(provider), updatedAt: row?.updatedAt ?? null };
}
export async function listGateways() {
  const rows = await db.paymentGateway.findMany();
  return PROVIDERS.map(p => gatewayView(p, rows.find(r => r.provider === p) ?? null));
}
export async function saveGateway(identity: Identity, provider: Provider, input: { enabled: boolean; environment: "sandbox" | "live"; publicConfig: Record<string, string>; credentials?: Record<string, string> }) {
  const f = FIELDS[provider];
  const unknownConfig = Object.keys(input.publicConfig).filter(k => !f.config.includes(k));
  const unknownCreds = Object.keys(input.credentials ?? {}).filter(k => !f.credentials.includes(k));
  if (unknownConfig.length || unknownCreds.length) throw new ApiError(400, `Unknown ${PROVIDER_NAME[provider]} fields: ${[...unknownConfig, ...unknownCreds].join(", ")}`);
  const config = Object.fromEntries(Object.entries(input.publicConfig).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  return db.$transaction(async tx => {
    const row = await tx.paymentGateway.findUnique({ where: { provider } });
    const before = gatewayView(provider, row);
    // Blank fields keep their saved value; credentials are write-only.
    const credentials = { ...credentialsOf(row), ...Object.fromEntries(Object.entries(input.credentials ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) };
    if (provider === "stripe" && credentials.secretKey && !/^(sk|rk)_(test|live)_/.test(credentials.secretKey)) throw new ApiError(400, "The Stripe secret key should start with sk_test_ or sk_live_.");
    if (provider === "stripe" && credentials.webhookSecret && !credentials.webhookSecret.startsWith("whsec_")) throw new ApiError(400, "The Stripe webhook signing secret should start with whsec_.");
    if (provider === "paystack" && credentials.secretKey && !/^sk_(test|live)_/.test(credentials.secretKey)) throw new ApiError(400, "The Paystack secret key should start with sk_test_ or sk_live_.");
    if (provider === "mpesa" && credentials.apiKey && !credentials.apiKey.startsWith("sp_")) throw new ApiError(400, "The SunPay API key should start with sp_.");
    // Credentials left over from the former Daraja integration are dropped.
    if (provider === "mpesa") for (const k of Object.keys(credentials)) if (!f.credentials.includes(k)) delete credentials[k];
    if (input.enabled && !isConfigured(provider, config, credentials)) {
      const missing = [...f.requiredConfig.filter(k => !config[k]), ...f.credentials.filter(k => !f.optional?.includes(k) && !credentials[k])];
      throw new ApiError(400, `Fill in ${missing.join(", ")} before enabling ${PROVIDER_NAME[provider]}.`);
    }
    const data = { enabled: input.enabled, environment: input.environment, publicConfig: config, encryptedCredentials: encryptCredentials(credentials) };
    const saved = await tx.paymentGateway.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    const after = gatewayView(provider, saved);
    await platformAudit(tx, identity, "billing.gateway_updated", `${PROVIDER_NAME[provider]} payment settings saved`, null, provider, before, after);
    return after;
  });
}
async function gateway(provider: Provider) {
  const row = await db.paymentGateway.findUnique({ where: { provider } });
  const config = configOf(row), credentials = credentialsOf(row);
  if (!row?.enabled || !isConfigured(provider, config, credentials)) throw new ApiError(409, `${PROVIDER_NAME[provider]} payments are not available. Choose another method.`);
  return { environment: row.environment as "sandbox" | "live", config, credentials };
}
/** The platform's SunPay account, when it is switched on: schools are registered under it to collect fees. */
export async function sunpayPlatform() {
  const row = await db.paymentGateway.findUnique({ where: { provider: "mpesa" } });
  const config = configOf(row), credentials = credentialsOf(row);
  if (!row?.enabled || !credentials.apiKey) return null;
  return { apiKey: credentials.apiKey, paybill: config.paybill || null };
}
export async function availableMethods() {
  const rows = await db.paymentGateway.findMany({ where: { enabled: true } });
  return PROVIDERS.filter(p => { const r = rows.find(x => x.provider === p) ?? null; return !!r && isConfigured(p, configOf(r), credentialsOf(r)); });
}

// ---------- Licence keys ----------
const KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const newKeyCode = () => "RJST-" + Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join("")).join("-");
const normalizeKey = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const keyHash = (code: string) => digest(`licence-key:${normalizeKey(code)}`);
type KeyRow = Prisma.LicenceKeyGetPayload<{}>;
function keyView(row: KeyRow, schoolName: string | null = null) {
  return { id: row.id, batchId: row.batchId, maskedCode: `RJST-••••-••••-${row.last4}`, durationDays: row.durationDays, price: row.price.toFixed(2),
    maxLearners: row.maxLearners, note: row.note, status: row.revokedAt ? "revoked" as const : row.redeemedAt ? "redeemed" as const : "available" as const,
    redeemedAt: row.redeemedAt, redeemedSchoolId: row.redeemedSchoolId, redeemedSchoolName: schoolName, createdAt: row.createdAt };
}
export async function listKeys() {
  const rows = await db.licenceKey.findMany({ orderBy: [{ createdAt: "desc" }, { last4: "asc" }], take: 1000 });
  const schools = await db.school.findMany({ where: { id: { in: rows.flatMap(r => r.redeemedSchoolId ? [r.redeemedSchoolId] : []) } }, select: { id: true, name: true } });
  return rows.map(r => keyView(r, schools.find(s => s.id === r.redeemedSchoolId)?.name ?? null));
}
export async function generateKeys(identity: Identity, input: { requestId: string; quantity: number; durationDays: number; price: string; maxLearners: number | null; note?: string }) {
  const price = new Prisma.Decimal(input.price);
  if (price.lessThan(0)) throw new ApiError(400, "Price cannot be negative.");
  const note = (input.note ?? "").trim();
  return db.$transaction(async tx => {
    const existing = await tx.licenceKey.findMany({ where: { batchId: input.requestId } });
    if (existing.length) return { batchId: input.requestId, keys: existing.map(k => ({ id: k.id, code: decryptCredentials(k.encryptedCode).code })) };
    const keys = Array.from({ length: input.quantity }, () => ({ id: randomUUID(), code: newKeyCode() }));
    await tx.licenceKey.createMany({ data: keys.map(k => ({
      id: k.id, batchId: input.requestId, codeHash: keyHash(k.code), encryptedCode: encryptCredentials({ code: k.code }), last4: k.code.slice(-4),
      durationDays: input.durationDays, price, maxLearners: input.maxLearners, note, createdById: identity.user.id,
    })) });
    await platformAudit(tx, identity, "licence.keys_generated", `${input.quantity} prepaid licence key(s) generated`, null, input.requestId, undefined,
      { quantity: input.quantity, durationDays: input.durationDays, price: price.toFixed(2), maxLearners: input.maxLearners, note });
    return { batchId: input.requestId, keys };
  });
}
export async function revealKey(identity: Identity, keyId: string) {
  return db.$transaction(async tx => {
    const key = await tx.licenceKey.findUnique({ where: { id: keyId } });
    if (!key) throw new ApiError(404, "Licence key not found.");
    await platformAudit(tx, identity, "licence.key_revealed", "Full licence key code viewed", key.redeemedSchoolId, key.id);
    return { id: key.id, code: decryptCredentials(key.encryptedCode).code };
  });
}
export async function revokeKey(identity: Identity, keyId: string) {
  return db.$transaction(async tx => {
    const key = await tx.licenceKey.findUnique({ where: { id: keyId } });
    if (!key) throw new ApiError(404, "Licence key not found.");
    if (key.redeemedAt) throw new ApiError(409, "This key has already been redeemed. Revoke the school's licence instead.");
    if (key.revokedAt) return keyView(key);
    const updated = await tx.licenceKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    await platformAudit(tx, identity, "licence.key_revoked", "Unredeemed licence key revoked", null, key.id, keyView(key), keyView(updated));
    return keyView(updated);
  });
}
export async function redeemKey(identity: Identity, schoolId: string, code: string) {
  const hash = keyHash(code);
  return db.$transaction(async tx => {
    await lock(tx, schoolId);
    const key = await tx.licenceKey.findUnique({ where: { codeHash: hash } });
    if (!key || key.revokedAt) throw new ApiError(404, "That licence key is not valid. Check it and try again.");
    if (key.redeemedAt) throw new ApiError(409, key.redeemedSchoolId === schoolId ? "Your school has already redeemed this key." : "This licence key has already been used.");
    const startsAt = await nextLicenceStart(tx, schoolId);
    const licence = await tx.schoolLicence.create({ data: {
      id: randomUUID(), schoolId, planId: null, planName: `Licence key ••••${key.last4}`, durationDays: key.durationDays, price: key.price,
      maxLearners: key.maxLearners, startsAt, expiresAt: new Date(+startsAt + key.durationDays * DAY_MS), source: "key",
    } });
    // Conditional update makes concurrent redemption of one key by two schools impossible.
    const claimed = await tx.licenceKey.updateMany({ where: { id: key.id, redeemedAt: null, revokedAt: null }, data: { redeemedAt: new Date(), redeemedSchoolId: schoolId, licenceId: licence.id } });
    if (claimed.count !== 1) throw new ApiError(409, "This licence key has already been used.");
    await tx.school.update({ where: { id: schoolId }, data: { licenceManaged: true } });
    await platformAudit(tx, identity, "licence.key_redeemed", "Prepaid licence key redeemed by school administrator", schoolId, licence.id, undefined, licenceView(licence));
    return licence;
  });
}

// ---------- Checkout ----------
type Checkout = Prisma.PaymentCheckoutGetPayload<{}>;
const STATUS_MESSAGE: Record<string, string> = {
  pending: "Waiting for the payment to be confirmed.", paid: "Payment received. Your licence is active.",
  failed: "The payment did not go through.", cancelled: "The payment was cancelled.",
};
export function checkoutView(c: Checkout) {
  return { id: c.id, orderId: c.orderId, provider: c.provider as Provider, status: c.status as "pending" | "paid" | "failed" | "cancelled",
    amount: c.amount.toFixed(2), currency: c.currency, redirectUrl: c.status === "pending" ? c.redirectUrl : null, receipt: c.receipt,
    message: c.status === "failed" && c.failure ? c.failure : c.provider === "mpesa" && c.status === "pending" ? "Check your phone and enter your M-Pesa PIN to complete the payment." : STATUS_MESSAGE[c.status], createdAt: c.createdAt };
}
/** Network failures and timeouts become a clear 502 instead of an unhandled error. */
async function providerFetch(provider: Provider, url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch (error) {
    logger.warn({ provider, err: error instanceof Error ? error.name : error }, "Payment provider unreachable");
    throw new ApiError(502, `Could not reach ${PROVIDER_NAME[provider]}. Check the connection and try again in a moment.`);
  }
}
async function providerJson(response: Response, provider: Provider) {
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON provider error */ }
  if (!response.ok) {
    const detail = data?.error?.message ?? data?.message ?? data?.errorMessage ?? `HTTP ${response.status}`;
    throw new ApiError(502, `${PROVIDER_NAME[provider]} rejected the request: ${String(detail).slice(0, 200)}`);
  }
  return data;
}
const stripeAuth = (key: string) => ({ Authorization: `Bearer ${key}` });
async function stripeRequest(key: string, method: "GET" | "POST", path: string, form?: Record<string, string>) {
  return providerJson(await providerFetch("stripe", `https://api.stripe.com/v1${path}`, {
    method, headers: { ...stripeAuth(key), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(20000),
  }), "stripe");
}
async function paystackRequest(key: string, method: "GET" | "POST", path: string, payload?: unknown) {
  return providerJson(await providerFetch("paystack", `https://api.paystack.co${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000),
  }), "paystack");
}
/** SunPay (https://sunpay.co.ke/docs) collects M-Pesa via STK push; there is no separate sandbox host. */
async function sunpayRequest(key: string, method: "GET" | "POST", path: string, payload?: unknown) {
  return providerJson(await providerFetch("mpesa", `https://api.sunpay.co.ke/api/v1${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000),
  }), "mpesa");
}
/** Re-reads a SunPay transaction and applies its authoritative status. */
async function applySunpay(checkoutId: string, key: string, transactionId: string) {
  const t = await sunpayRequest(key, "GET", `/payments/${encodeURIComponent(transactionId)}`);
  if (t?.status === "completed") return settleCheckout(checkoutId, { amount: new Prisma.Decimal(String(t.amount)), currency: "KES", receipt: String(t.mpesaRef ?? transactionId) });
  if (t?.status === "failed") return failCheckout(checkoutId, t.resultDesc ? `M-Pesa: ${t.resultDesc}` : "The M-Pesa payment did not complete.");
  return db.paymentCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
}

export async function startCheckout(identity: Identity, schoolId: string, orderId: string, input: { requestId: string; method: Provider; phone?: string; email?: string }, origin: string) {
  const existing = await db.paymentCheckout.findUnique({ where: { id: input.requestId } });
  if (existing) {
    if (existing.schoolId !== schoolId || existing.orderId !== orderId || existing.provider !== input.method) throw new ApiError(409, "This payment request was already used. Start again.");
    return existing;
  }
  const order = await db.licenceOrder.findFirst({ where: { id: orderId, schoolId }, include: { ...orderInclude, school: true } });
  if (!order) throw new ApiError(404, "Renewal invoice not found.");
  const view = orderView(order);
  if (view.status === "paid") throw new ApiError(409, "This invoice is already paid.");
  if (view.status === "cancelled") throw new ApiError(409, "This invoice was cancelled. Start a new renewal.");
  const amount = new Prisma.Decimal(view.balance);
  const g = await gateway(input.method);
  const checkout = await db.paymentCheckout.create({ data: {
    id: input.requestId, orderId, schoolId, provider: input.method, environment: g.environment, amount, currency: "KES", createdById: identity.user.id,
  } });
  const returnUrl = `${(publicBase() ?? origin).replace(/\/$/, "")}/subscription?checkout=${checkout.id}`;
  const description = `Rejista ${order.planName} · ${order.school.name}`;
  try {
    if (input.method === "stripe") {
      const session = await stripeRequest(g.credentials.secretKey, "POST", "/checkout/sessions", {
        mode: "payment", success_url: returnUrl, cancel_url: `${returnUrl}&cancelled=1`, client_reference_id: checkout.id,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "kes",
        "line_items[0][price_data][unit_amount]": amount.times(100).toFixed(0), "line_items[0][price_data][product_data][name]": description,
        "metadata[checkoutId]": checkout.id, "metadata[invoice]": order.invoice.number,
        ...(input.email ?? identity.user.email ? { customer_email: (input.email ?? identity.user.email)! } : {}),
      });
      return db.paymentCheckout.update({ where: { id: checkout.id }, data: { providerRef: session.id, redirectUrl: session.url } });
    }
    if (input.method === "paystack") {
      const email = input.email ?? identity.user.email;
      if (!email) throw new ApiError(400, "Paystack needs an email address for the receipt.");
      const reference = `rj_${checkout.id.replace(/-/g, "")}`;
      const result = await paystackRequest(g.credentials.secretKey, "POST", "/transaction/initialize", {
        email, amount: Number(amount.times(100).toFixed(0)), currency: "KES", reference, callback_url: returnUrl,
        metadata: { checkoutId: checkout.id, invoice: order.invoice.number, school: order.school.name },
      });
      if (!result?.data?.authorization_url) throw new ApiError(502, "Paystack did not return a payment page.");
      return db.paymentCheckout.update({ where: { id: checkout.id }, data: { providerRef: reference, redirectUrl: result.data.authorization_url } });
    }
    const phone = fullPhone(input.phone ?? "");
    if (!phone || !/^254(7|1)\d{8}$/.test(phone)) throw new ApiError(400, "Enter a Safaricom number such as 0712 345 678.");
    if (!amount.isInteger()) throw new ApiError(400, "M-Pesa takes whole shillings only. Ask Rejista to round the price.");
    const base = publicBase();
    const result = await sunpayRequest(g.credentials.apiKey, "POST", "/payments/stk-push", {
      phoneNumber: phone, amount: amount.toNumber(), externalRef: order.invoice.number,
      // The per-transaction callback is unsigned, so it only triggers a re-check against SunPay's API.
      ...(base ? { callbackUrl: `${base}/api/billing/webhooks/sunpay/${checkout.id}` } : {}),
    });
    if (!result?.success || !result?.transactionId) throw new ApiError(502, `M-Pesa did not accept the request${result?.message ? `: ${result.message}` : ""}.`);
    return db.paymentCheckout.update({ where: { id: checkout.id }, data: { providerRef: String(result.transactionId), phone } });
  } catch (error) {
    await db.paymentCheckout.update({ where: { id: checkout.id }, data: { status: "failed", failure: error instanceof ApiError ? error.message : "Could not reach the payment provider." } });
    throw error;
  }
}

/** Records a verified provider payment on the invoice and activates the licence, exactly once. */
export async function settleCheckout(checkoutId: string, evidence: { amount: Prisma.Decimal; currency: string; receipt: string }) {
  return db.$transaction(async tx => {
    const first = await tx.paymentCheckout.findUnique({ where: { id: checkoutId } });
    if (!first) throw new ApiError(404, "Checkout not found.");
    await lock(tx, first.schoolId);
    const c = await tx.paymentCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
    if (c.status === "paid") return c;
    if (evidence.currency.toUpperCase() !== c.currency || !evidence.amount.greaterThan(0)) {
      logger.error({ checkoutId, currency: evidence.currency }, "Online payment currency or amount mismatch");
      return tx.paymentCheckout.update({ where: { id: c.id }, data: { status: "failed", failure: "The payment amount or currency did not match. Contact Rejista support with your receipt." } });
    }
    const order = await tx.licenceOrder.findUniqueOrThrow({ where: { id: c.orderId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: c.createdById } });
    const identity: Identity = { user, sessionId: `billing:${c.provider}` };
    await tx.platformBillingPayment.create({ data: { id: randomUUID(), invoiceId: order.invoiceId, amount: evidence.amount, paidOn: nairobiDay(), method: c.provider, reference: evidence.receipt.slice(0, 120) } });
    const updated = await tx.paymentCheckout.update({ where: { id: c.id }, data: { status: "paid", receipt: evidence.receipt.slice(0, 120), completedAt: new Date(), failure: null } });
    await platformAudit(tx, identity, "billing.online_payment_received", `${PROVIDER_NAME[c.provider as Provider]} payment confirmed by the provider`, c.schoolId, c.id, undefined, checkoutView(updated));
    await syncLicencePayment(tx, order.invoiceId, identity);
    return updated;
  });
}
async function failCheckout(checkoutId: string, failure: string, status: "failed" | "cancelled" = "failed") {
  await db.paymentCheckout.updateMany({ where: { id: checkoutId, status: "pending" }, data: { status, failure: failure.slice(0, 300) } });
  return db.paymentCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
}

/** While pending, asks the provider directly so local setups without public webhooks still settle. */
export async function refreshCheckout(schoolId: string, checkoutId: string) {
  let c = await db.paymentCheckout.findFirst({ where: { id: checkoutId, schoolId } });
  if (!c) throw new ApiError(404, "Payment not found.");
  if (c.status !== "pending" || !c.providerRef || Date.now() - +c.updatedAt < 4000) return c;
  await db.paymentCheckout.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
  try {
    const g = await gateway(c.provider as Provider);
    if (c.provider === "stripe") {
      const s = await stripeRequest(g.credentials.secretKey, "GET", `/checkout/sessions/${encodeURIComponent(c.providerRef)}`);
      if (s.payment_status === "paid") c = await settleCheckout(c.id, { amount: new Prisma.Decimal(s.amount_total).dividedBy(100), currency: s.currency, receipt: String(s.payment_intent ?? s.id) });
      else if (s.status === "expired") c = await failCheckout(c.id, "The card payment page expired. Start the payment again.");
    } else if (c.provider === "paystack") {
      const r = await paystackRequest(g.credentials.secretKey, "GET", `/transaction/verify/${encodeURIComponent(c.providerRef)}`);
      if (r?.data?.status === "success") c = await settleCheckout(c.id, { amount: new Prisma.Decimal(r.data.amount).dividedBy(100), currency: r.data.currency, receipt: String(r.data.reference) });
      else if (r?.data?.status === "failed") c = await failCheckout(c.id, r.data.gateway_response || "Paystack reported the payment as failed.");
    } else {
      c = await applySunpay(c.id, g.credentials.apiKey, c.providerRef);
    }
  } catch (error) {
    // Still processing or provider briefly unreachable: stay pending and retry on the next poll.
    logger.warn({ checkoutId, err: error instanceof Error ? error.message : error }, "Checkout verification deferred");
  }
  return c;
}

// ---------- Webhooks ----------
export async function stripeWebhook(rawBody: Buffer | undefined, signatureHeader: string | undefined) {
  const g = await gateway("stripe").catch(() => null);
  if (!g || !rawBody || !signatureHeader) throw new ApiError(400, "Unverifiable webhook");
  const pairs = signatureHeader.split(",").map(p => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const; });
  const t = pairs.find(([k]) => k === "t")?.[1];
  const sigs = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new ApiError(400, "Unverifiable webhook");
  const expected = createHmac("sha256", g.credentials.webhookSecret).update(`${t}.`).update(rawBody).digest("hex");
  if (!sigs.some(s => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)))) throw new ApiError(400, "Invalid signature");
  const event = JSON.parse(rawBody.toString("utf8"));
  const session = event?.data?.object;
  if (!session?.id) return;
  const c = await db.paymentCheckout.findUnique({ where: { provider_providerRef: { provider: "stripe", providerRef: session.id } } });
  if (!c) return;
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && session.payment_status === "paid") {
    await settleCheckout(c.id, { amount: new Prisma.Decimal(session.amount_total).dividedBy(100), currency: session.currency, receipt: String(session.payment_intent ?? session.id) });
  } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
    await failCheckout(c.id, "The card payment did not complete.");
  }
}
export async function paystackWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
  const g = await gateway("paystack").catch(() => null);
  if (!g || !rawBody || !signature) throw new ApiError(400, "Unverifiable webhook");
  const expected = createHmac("sha512", g.credentials.secretKey).update(rawBody).digest("hex");
  if (!equalSecret(signature, expected)) throw new ApiError(400, "Invalid signature");
  const event = JSON.parse(rawBody.toString("utf8"));
  const reference = event?.data?.reference;
  if (event?.event !== "charge.success" || typeof reference !== "string") return;
  const c = await db.paymentCheckout.findUnique({ where: { provider_providerRef: { provider: "paystack", providerRef: reference } } });
  if (!c || c.status !== "pending") return;
  // Re-verify with the API rather than trusting webhook amounts alone.
  const r = await paystackRequest(g.credentials.secretKey, "GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  if (r?.data?.status === "success") await settleCheckout(c.id, { amount: new Prisma.Decimal(r.data.amount).dividedBy(100), currency: r.data.currency, receipt: String(r.data.reference) });
}
/** Registered SunPay webhook: HMAC-SHA256 of the raw body in X-Webhook-Signature, then re-checked via the API. */
export async function sunpayWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
  const g = await gateway("mpesa").catch(() => null);
  if (!g?.credentials.webhookSecret || !rawBody || !signature) throw new ApiError(400, "Unverifiable webhook");
  const expected = createHmac("sha256", g.credentials.webhookSecret).update(rawBody).digest("hex");
  if (!equalSecret(signature, expected)) throw new ApiError(401, "Invalid signature");
  const transactionId = JSON.parse(rawBody.toString("utf8"))?.data?.transactionId;
  if (typeof transactionId !== "string") return;
  const c = await db.paymentCheckout.findUnique({ where: { provider_providerRef: { provider: "mpesa", providerRef: transactionId } } });
  if (c?.status === "pending") await applySunpay(c.id, g.credentials.apiKey, transactionId);
}
/** Per-transaction SunPay callback: unsigned, so its body is ignored and the status is fetched from SunPay. */
export async function sunpayCallback(checkoutId: string) {
  const c = await db.paymentCheckout.findUnique({ where: { id: checkoutId } });
  if (!c || c.provider !== "mpesa" || c.status !== "pending" || !c.providerRef) return;
  const g = await gateway("mpesa");
  await applySunpay(c.id, g.credentials.apiKey, c.providerRef);
}
