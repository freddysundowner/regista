import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { ApiError, body, lock, send } from "../lib/core";
import { platformAudit } from "../lib/platform";
import { decryptCredentials, encryptCredentials } from "../lib/integrations/security";
import { sendBrevoEmail } from "../lib/integrations/brevo";

export const platformEmailRouter = Router();
const accountKey = { scope: "platform", channel: "email" };
async function emailSettings() {
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: accountKey } });
  const config = (account?.publicConfig ?? {}) as Record<string, string>;
  return {
    provider: "brevo" as const, enabled: account?.enabled ?? false,
    configured: !!account?.encryptedCredentials,
    senderName: config.senderName ?? "", senderEmail: config.senderEmail ?? "", replyTo: config.replyTo ?? "",
    ...(account ? { updatedAt: account.updatedAt.toISOString() } : {}),
  };
}
// Mounted under the platform owner's authentication and support-session guards.
platformEmailRouter.get("/platform/settings/email", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  send(res, "GetPlatformEmailSettings", await emailSettings());
});
platformEmailRouter.put("/platform/settings/email", async (req, res) => {
  const input = body(schemas.SavePlatformEmailSettingsBody.strict(), req.body);
  if (!input.senderName.trim()) throw new ApiError(400, "Sender name is required.");
  if (input.apiKey !== undefined && !input.apiKey.trim()) throw new ApiError(400, "API key cannot be blank.");
  await db.$transaction(async tx => {
    await lock(tx, "messaging:platform:email");
    const old = await tx.messagingAccount.findUnique({ where: { scope_channel: accountKey } });
    const encryptedCredentials = input.apiKey
      ? encryptCredentials({ apiKey: input.apiKey.trim() }) : old?.encryptedCredentials ?? null;
    if (!encryptedCredentials) throw new ApiError(400, "A Brevo API key is required for the first configuration.");
    const data = {
      mode: "override", provider: "brevo", environment: "live", enabled: input.enabled,
      encryptedCredentials,
      publicConfig: { senderName: input.senderName.trim(), senderEmail: input.senderEmail.trim(), replyTo: input.replyTo?.trim() ?? "" },
    };
    const saved = await tx.messagingAccount.upsert({ where: { scope_channel: accountKey }, create: { ...accountKey, ...data }, update: data });
    await platformAudit(tx, req.identity, "email.settings_updated", "Platform Brevo email settings updated", null, saved.id,
      undefined, { enabled: input.enabled, credentialsChanged: input.apiKey !== undefined });
  });
  res.set("Cache-Control", "no-store");
  send(res, "SavePlatformEmailSettings", await emailSettings());
});
const testLimit = rateLimit({
  windowMs: 60_000, limit: 3, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: req => req.identity.user.id,
  message: { error: "Too many test emails. Wait a minute before trying again." },
});
platformEmailRouter.post("/platform/settings/email/test", testLimit, async (req, res) => {
  const { recipient } = body(schemas.SendPlatformTestEmailBody.strict(), req.body);
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: accountKey } });
  if (!account?.enabled || !account.encryptedCredentials || account.provider !== "brevo") throw new ApiError(409, "Configure and enable Brevo email before sending a test.");
  const pub = account.publicConfig as Record<string, string>;
  const credentials = decryptCredentials(account.encryptedCredentials);
  if (!credentials.apiKey || !pub.senderEmail || !pub.senderName) throw new ApiError(409, "Complete the Brevo email settings first.");
  // Record the explicit request before contacting Brevo. Never include credentials or message contents.
  await db.$transaction(tx => platformAudit(tx, req.identity, "email.test_requested", "Platform test email requested", null, account.id));
  const messageId = await sendBrevoEmail(credentials.apiKey, {
    senderName: pub.senderName, senderEmail: pub.senderEmail, replyTo: pub.replyTo || undefined, recipient,
    subject: "Rejista — email configuration test",
    text: "This is a test email from your Rejista system settings. Your Brevo email configuration accepted this test request.",
  });
  res.set("Cache-Control", "no-store");
  send(res, "SendPlatformTestEmail", { message: "Test email accepted by Brevo. Check the recipient's inbox and Brevo transactional logs for delivery.", messageId });
});
