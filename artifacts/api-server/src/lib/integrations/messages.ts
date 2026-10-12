import { db } from "@workspace/db";
import { ApiError, lock, type Tx } from "../core";
import { decryptCredentials } from "./security";
import { resolveMessaging } from "./messaging-routing";
import { checkLeadsIntelConnection } from "./leadsintel";
import { SmsRejected, submitSms } from "./sms-transports";
export async function messageReadiness(schoolId: string, channel: string, templateName: string, guardianId: string) {
  const { credentials, publicConfig } = await resolveMessaging(schoolId, channel === "sms" ? "sms" : "whatsapp");
  if (channel === "sms") {
    return;
  }
  if (!credentials.platformKey || !credentials.tenantId || !publicConfig.connectionId) throw new ApiError(503, "LeadsIntel platform key/tenant/connection missing");
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId } });
  const template = (school.settings as any).messageTemplates?.[templateName];
  if (!template) throw new ApiError(503, `WhatsApp transport not configured for ${templateName}`);
  if (template.transport === "text") {
    const guardian = await db.guardian.findFirst({ where: { id: guardianId, schoolId } });
    if (!guardian?.whatsappLastInboundAt || guardian.whatsappLastInboundAt.getTime() < Date.now() - 86400000) throw new ApiError(503, "Verified WhatsApp 24-hour text session unavailable; use an approved template");
  } else if (!template.name) throw new ApiError(503, "Approved WhatsApp template name missing");
}
export async function queueMessage(tx: Tx, schoolId: string, input: { guardianId?: string; phone: string; channel: string; template: string; content: string; idempotencyKey: string; scheduledAt?: Date }) {
  if (!input.content || (input.channel === "whatsapp" && input.content.length > 4000)) throw new ApiError(400, "WhatsApp content must contain 1–4000 characters");
  const message = await tx.messageDelivery.upsert({
    where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: input.idempotencyKey } },
    create: { schoolId, ...input }, update: {},
  });
  if (message.content !== input.content || message.phone !== input.phone || message.channel !== input.channel || message.template !== input.template || message.guardianId !== (input.guardianId ?? null)) throw new ApiError(409, "Message idempotency key content changed");
  if (message.status === "failed" && message.attempts > 0 && !message.error?.startsWith("[not submitted] ")) {
    const error = "Legacy failure has no proof of non-submission; reconcile before retry";
    await tx.messageDelivery.updateMany({ where: { id: message.id, schoolId, status: "failed" }, data: { status: "uncertain", error } });
    return { ...message, status: "uncertain", error };
  }
  return message;
}
export async function sendDelivery(id: string, schoolId: string) {
  // Claim before any network I/O. A crashed/in-flight claim is NOT safe to retry:
  // neither SMS transport nor an undocumented provider idempotency header guarantees deduplication.
  const message = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const current = await tx.messageDelivery.findFirst({ where: { id, schoolId, status: { in: ["queued", "failed"] }, attempts: { lt: 5 }, scheduledAt: { lte: new Date() } } });
    if (!current) return null;
    if (current.status === "failed" && current.attempts > 0 && !current.error?.startsWith("[not submitted] ")) {
      await tx.messageDelivery.updateMany({ where: { id, schoolId, status: "failed" }, data: { status: "uncertain", error: "Legacy failure has no proof of non-submission; reconcile before retry" } });
      return null;
    }
    if (current.guardianId) {
      const guardian = await tx.guardian.findFirst({ where: { id: current.guardianId, schoolId, phone: current.phone, anonymizedAt: null, ...(current.template === "otp" ? {} : { students: { some: { schoolId, receivesNotifications: true } } }) } });
      if (!guardian) {
        await tx.messageDelivery.updateMany({ where: { id, schoolId }, data: { status: "cancelled", error: "Guardian identity no longer matches recipient" } });
        return null;
      }
    }
    const claim = await tx.messageDelivery.updateMany({ where: { id, schoolId, status: current.status }, data: { status: "sending", attempts: { increment: 1 }, error: null } });
    return claim.count ? current : null;
  });
  if (!message) return;
  let transportStarted = false;
  let definitivelyRejected = false;
  try {
    let providerMessageId: string | undefined;
    if (message.channel === "sms") {
      const { config, credentials, publicConfig, provider, accountId } = await resolveMessaging(schoolId, "sms");
      await db.messageDelivery.updateMany({ where: { id, schoolId, status: "sending" }, data: { transportProvider: provider, transportAccountId: accountId } });
      const content = message.template === "otp" ? decryptCredentials(message.content).content : message.content;
      transportStarted = true;
      providerMessageId = await submitSms({ provider, environment: config.environment, credentials, publicConfig }, message.phone, content);
    } else {
      const { credentials, publicConfig, provider, accountId } = await resolveMessaging(schoolId, "whatsapp");
      if (!credentials.platformKey || !credentials.tenantId || !publicConfig.connectionId) throw new ApiError(503, "LeadsIntel platform key/tenant/connection missing");
      const connection = await checkLeadsIntelConnection(credentials, publicConfig.connectionId);
      if (connection.status !== "active") throw new ApiError(503, "LeadsIntel connection is not active. No WhatsApp message was submitted.");
      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId } });
      const templates = (school.settings as Record<string, any>).messageTemplates ?? {};
      const template = templates[message.template];
      if (!template) throw new ApiError(503, `WhatsApp transport not configured for ${message.template}`);
      let payload: Record<string, unknown>;
      if (template.transport === "text") {
        const guardian = message.guardianId ? await db.guardian.findFirst({ where: { id: message.guardianId, schoolId } }) : null;
        if (!guardian?.whatsappLastInboundAt || guardian.whatsappLastInboundAt.getTime() < Date.now() - 86400000) throw new ApiError(503, "Verified WhatsApp 24-hour text session is unavailable; configure an approved template");
        payload = { to: message.phone, type: "text", text: message.content };
      } else {
        if (!template.name) throw new ApiError(503, `Approved WhatsApp template name missing for ${message.template}`);
        const components = JSON.parse(JSON.stringify(template.components ?? []).replace(/\{\{content\}\}/g, () => JSON.stringify(message.content).slice(1, -1)));
        payload = { to: message.phone, type: "template", name: template.name, language: template.language ?? "en", components };
      }
      await db.messageDelivery.updateMany({ where: { id, schoolId, status: "sending" }, data: { transportProvider: provider, transportAccountId: accountId } });
      transportStarted = true;
      const response = await fetch(`https://app.leadsintel.net/api/external-platform/whatsapp/connections/${encodeURIComponent(credentials.tenantId)}/${encodeURIComponent(publicConfig.connectionId)}/send`, {
        method: "POST", headers: { Authorization: `Bearer ${credentials.platformKey}`, "Idempotency-Key": message.id, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      if (response.status !== 202) throw new ApiError(503, `LeadsIntel submission not accepted (${response.status})`);
      providerMessageId = (await response.json() as { messageId?: string }).messageId;
    }
    if (!providerMessageId) throw new ApiError(503, "Provider accepted without a message identity; reconcile before retry");
    await db.messageDelivery.updateMany({ where: { id, schoolId, status: "sending" }, data: { status: "submitted", providerMessageId, error: null } });
  } catch (error) {
    definitivelyRejected = error instanceof SmsRejected;
    const errorText = error instanceof ApiError ? error.message : "Provider transport error; submission outcome may be unknown";
    const fallbackSafe = message.channel === "whatsapp" && !transportStarted;
    const status = definitivelyRejected || fallbackSafe ? "rejected" : transportStarted ? "uncertain" : "failed";
    await db.$transaction(async tx => {
      await lock(tx, schoolId);
      const changed = await tx.messageDelivery.updateMany({ where: { id, schoolId, status: "sending" }, data: { status, error: status === "failed" ? `[not submitted] ${errorText}` : errorText } });
      if (changed.count && fallbackSafe) await queueSmsFallback(tx, schoolId, message);
    });
    throw error;
  }
}

/** Called only by an authenticated, contract-validated delivery gateway. */
export async function recordDeliveryEvent(tx: Tx, schoolId: string, provider: string, providerMessageId: string, status: "delivered" | "read" | "rejected", accountId: string | null = null) {
  await lock(tx, schoolId);
  const channel = provider === "leadsintel" ? "whatsapp" : "sms";
  if (channel === "sms" && status === "read") throw new ApiError(400, "SMS read receipts are not supported.");
  const rows = await tx.messageDelivery.findMany({ where: { schoolId, channel, providerMessageId, transportAccountId: accountId,
    OR: accountId ? [{ transportProvider: provider }] : [{ transportProvider: provider }, { transportProvider: null }] }, take: 2 });
  if (rows.length !== 1) throw new ApiError(409, "Provider message identity missing or ambiguous; retry after submission is recorded");
  const message = rows[0];
  // Terminal positive evidence wins; late/duplicate failures must never trigger a fallback.
  if (message.status === "read" || (message.status === "delivered" && status !== "read") || message.status === status) return;
  await tx.messageDelivery.updateMany({ where: { schoolId, id: message.id }, data: { status, error: status === "rejected" ? "Provider confirmed non-delivery" : null } });
  if (channel === "whatsapp" && status !== "rejected") {
    await tx.messageDelivery.updateMany({ where: { schoolId, idempotencyKey: `sms-fallback:${message.id}`, status: { in: ["queued", "failed"] } }, data: { status: "cancelled", error: "WhatsApp delivery subsequently confirmed before SMS submission" } });
  }
  if (channel !== "whatsapp" || status !== "rejected") return;
  await queueSmsFallback(tx, schoolId, message);
}
/** Templates always queued on SMS as well as WhatsApp; a fallback would text the family twice. */
const SMS_SENT_ALONGSIDE = new Set(["absence_alert"]);
async function queueSmsFallback(tx: Tx, schoolId: string, message: { id: string; guardianId: string | null; phone: string; template: string; content: string }) {
  const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
  if ((school.settings as Record<string, unknown>).smsFallbackEnabled === false || !message.guardianId || SMS_SENT_ALONGSIDE.has(message.template)) return;
  const guardian = await tx.guardian.findFirst({ where: { id: message.guardianId, schoolId, phone: message.phone, anonymizedAt: null, students: { some: { schoolId, receivesNotifications: true } } } });
  if (!guardian) return;
  await queueMessage(tx, schoolId, { guardianId: guardian.id, phone: guardian.phone, channel: "sms", template: message.template, content: message.content, idempotencyKey: `sms-fallback:${message.id}` });
}