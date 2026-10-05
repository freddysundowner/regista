import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { ApiError, audit, type Actor } from "../core";
import { json } from "../finance/posting";
import { kcbPublicKey } from "./kcb";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new ApiError(503, "ENCRYPTION_KEY is not configured");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new ApiError(503, "ENCRYPTION_KEY must encode exactly 32 bytes");
  return key;
}
export function encryptCredentials(value: Record<string, string>) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function decryptCredentials(value: string): Record<string, string> {
  const [iv, tag, encrypted] = value.split(".");
  try {
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted, "base64")), cipher.final()]).toString());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Integration credentials could not be decrypted");
  }
}
export const equalSecret = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function verifySignature(secret: string, timestamp: string, rawBody: Buffer, signature: string, now = Date.now()) {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000) throw new ApiError(401, "Request timestamp expired");
  const expected = createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex");
  if (!equalSecret(expected, signature)) throw new ApiError(401, "Invalid request signature");
}
export async function integration(schoolId: string, provider: string) {
  const config = await db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId, provider } } });
  if (!config?.enabled) throw new ApiError(503, `${provider} is not configured or is disabled`);
  return { config, credentials: decryptCredentials(config.encryptedCredentials), publicConfig: config.publicConfig as Record<string, string> };
}
export async function systemActor(schoolId: string): Promise<Actor> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId } });
  const user = await db.user.findFirst({ where: { schoolId, isActive: true, role: { in: ["school_admin", "bursar"] } }, orderBy: { createdAt: "asc" } });
  if (!user || school.status !== "active") throw new ApiError(503, "School needs an active finance administrator for integration processing");
  return { school, user };
}
export async function saveIntegration(actor: Actor, input: { provider: string; environment: string; enabled: boolean; credentials: Record<string, string>; shortcode?: string; accountNumber?: string; connectionId?: string }) {
  const credentials = input.credentials;
  if (input.provider === "daraja") {
    for (const k of ["consumerKey", "consumerSecret", "passkey", "callbackToken"]) if (!credentials[k]) throw new ApiError(400, `${k} is required`);
    if (!input.shortcode || credentials.callbackToken.length < 32) throw new ApiError(400, "Shortcode and a callback token of at least 32 characters are required");
  }
  if (input.provider === "bot" && (!credentials.apiKey || credentials.apiKey.length < 32 || !credentials.hmacSecret || credentials.hmacSecret.length < 32)) throw new ApiError(400, "Bot API key and HMAC secret must each have at least 32 characters");
  if (input.provider === "bank") {
    if (!input.accountNumber?.trim() && !credentials.tillBusinessKey?.trim()) throw new ApiError(400, "A KCB collection account or KCB-issued receiving business key is required");
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(credentials.callbackToken ?? "")) throw new ApiError(400, "KCB callback token must be 32–128 URL-safe characters");
    kcbPublicKey(credentials.kcbPublicKey ?? "");
  }
  const encryptedCredentials = encryptCredentials(credentials);
  const publicConfig = json({ shortcode: input.shortcode, accountNumber: input.accountNumber, connectionId: input.connectionId });
  const result = await db.$transaction(async tx => {
    if (input.provider === "bank") {
      // Serialize registration so the same receiving account cannot be assigned
      // to two tenants, including concurrent configuration requests.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(49181234)`;
      const others = await tx.integrationConfig.findMany({ where: { provider: "bank", schoolId: { not: actor.school.id } } });
      for (const other of others) {
        const pub = other.publicConfig as Record<string, string>;
        if (input.accountNumber && pub.accountNumber === input.accountNumber) throw new ApiError(409, "This collection account is already registered to another school");
        if (credentials.tillBusinessKey && decryptCredentials(other.encryptedCredentials).tillBusinessKey === credentials.tillBusinessKey) throw new ApiError(409, "This KCB business key is already registered to another school");
      }
    }
    const data = {
      environment: input.environment, enabled: input.enabled, encryptedCredentials, publicConfig,
      callbackTokenHash: credentials.callbackToken ? digest(credentials.callbackToken) : null,
      apiKeyHash: credentials.apiKey && input.provider === "bot" ? digest(credentials.apiKey) : null,
    };
    const result = await tx.integrationConfig.upsert({ where: { schoolId_provider: { schoolId: actor.school.id, provider: input.provider } }, create: { ...data, schoolId: actor.school.id, provider: input.provider }, update: data });
    await audit(tx, actor, "configured", "integration", result.id, undefined, { provider: input.provider, environment: input.environment, enabled: input.enabled, credentialsChanged: true });
    return result;
  });
  return { provider: result.provider, environment: result.environment, enabled: result.enabled, configured: true, status: "unverified", reason: "Credentials saved; live connectivity has not been verified" };
}