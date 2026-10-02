import { db } from "@workspace/db";
import { ApiError, owned, type Actor, type Tx } from "../core";
import { integration, decryptCredentials } from "./security";
export async function messageReadiness(schoolId: string, channel: string, templateName: string, guardianId: string) {
  const { credentials, publicConfig } = await integration(schoolId, channel === "sms" ? "africastalking" : "leadsintel");
  if (channel === "sms") {
    if (!credentials.apiKey || !credentials.username) throw new ApiError(503, "Africa's Talking API key/username missing");
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
  const existing = await tx.messageDelivery.findUnique({ where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: input.idempotencyKey } } });
  if (existing) {
    if (existing.content !== input.content || existing.phone !== input.phone || existing.channel !== input.channel) throw new ApiError(409, "Message idempotency key content changed");
    return existing;
  }
  return tx.messageDelivery.create({ data: { schoolId, ...input } });
}
export async function sendDelivery(id: string, schoolId: string) {
  const message = await db.messageDelivery.findFirst({ where: { id, schoolId } });
  if (!message || !["queued", "failed"].includes(message.status)) return;
  try {
    let providerMessageId: string | undefined;
    if (message.channel === "sms") {
      const { config, credentials } = await integration(schoolId, "africastalking");
      if (!credentials.apiKey || !credentials.username) throw new ApiError(503, "Africa's Talking API key/username missing");
      const form = new URLSearchParams({ username: credentials.username, to: `+${message.phone}`, message: message.template === "otp" ? decryptCredentials(message.content).content : message.content });
      if (credentials.senderId) form.set("from", credentials.senderId);
      const response = await fetch(`https://${config.environment === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com"}/version1/messaging`, { method: "POST", headers: { apiKey: credentials.apiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new ApiError(503, `SMS submission failed (${response.status})`);
      const body = await response.json() as { SMSMessageData?: { Recipients?: { statusCode: number; messageId: string }[] } };
      const recipient = body.SMSMessageData?.Recipients?.[0];
      if (!recipient || ![100, 101, 102].includes(recipient.statusCode)) throw new ApiError(503, `SMS recipient rejected (${recipient?.statusCode ?? "missing"})`);
      providerMessageId = recipient.messageId;
    } else {
      const { credentials, publicConfig } = await integration(schoolId, "leadsintel");
      if (!credentials.platformKey || !credentials.tenantId || !publicConfig.connectionId) throw new ApiError(503, "LeadsIntel platform key/tenant/connection missing");
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
      const response = await fetch(`https://app.leadsintel.net/api/external-platform/whatsapp/connections/${encodeURIComponent(credentials.tenantId)}/${encodeURIComponent(publicConfig.connectionId)}/send`, {
        method: "POST", headers: { Authorization: `Bearer ${credentials.platformKey}`, "Idempotency-Key": message.id, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      if (response.status !== 202) throw new ApiError(503, `LeadsIntel submission not accepted (${response.status})`);
      providerMessageId = (await response.json() as { messageId?: string }).messageId;
    }
    await db.messageDelivery.update({ where: { id }, data: { status: "submitted", providerMessageId, error: null, attempts: { increment: 1 } } });
  } catch (error) {
    const errorText = error instanceof ApiError ? error.message : "Provider transport error; submission outcome may be unknown";
    await db.messageDelivery.update({ where: { id }, data: { status: "failed", error: errorText, attempts: { increment: 1 } } });
    throw error;
  }
}