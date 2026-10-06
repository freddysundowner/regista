import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { ApiError, body, lock, send, admin, allow, audit } from "../lib/core";
import { platformAudit } from "../lib/platform";
import { decryptCredentials, encryptCredentials } from "../lib/integrations/security";
import { sendBrevoEmail } from "../lib/integrations/brevo";

export const platformEmailRouter = Router();
export const schoolEmailRouter = Router();
const key = (scope: string) => ({ scope, channel: "email" });
async function emailSettings(scope: string) {
  const accountKey = key(scope);
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: accountKey } });
  const config = (account?.publicConfig ?? {}) as Record<string, string>;
  return {
    provider: "brevo" as const, enabled: account?.enabled ?? false,
    configured: !!account?.encryptedCredentials,
    senderName: config.senderName ?? "", senderEmail: config.senderEmail ?? "", replyTo: config.replyTo ?? "",
    ...(account ? { updatedAt: account.updatedAt.toISOString() } : {}),
  };
}
function mountEmailSettings(router: Router, path: string, school: boolean) {
  const scopeOf = (req: Request) => { if (school) { allow(req, admin); return req.actor.school.id; } return "platform"; };
router.get(path, async (req, res) => {
  const scope = scopeOf(req);
  res.set("Cache-Control", "no-store");
  send(res, school ? "GetSchoolEmailSettings" : "GetPlatformEmailSettings", await emailSettings(scope));
});
router.put(path, async (req, res) => {
  const scope = scopeOf(req), accountKey = key(scope);
  const input = body(schemas.SavePlatformEmailSettingsBody.strict(), req.body);
  if (!input.senderName.trim()) throw new ApiError(400, "Sender name is required.");
  if (input.apiKey !== undefined && !input.apiKey.trim()) throw new ApiError(400, "API key cannot be blank.");
  await db.$transaction(async tx => {
    await lock(tx, `messaging:${scope}:email`);
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
    const summary = { enabled: input.enabled, credentialsChanged: input.apiKey !== undefined };
    if (school) await audit(tx, req.actor, "email.settings_updated", "messaging_account", saved.id, undefined, summary);
    else await platformAudit(tx, req.identity, "email.settings_updated", "Platform Brevo email settings updated", null, saved.id, undefined, summary);
  });
  res.set("Cache-Control", "no-store");
  send(res, school ? "SaveSchoolEmailSettings" : "SavePlatformEmailSettings", await emailSettings(scope));
});
const testLimit = rateLimit({
  windowMs: 60_000, limit: 3, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: req => req.identity.user.id,
  message: { error: "Too many test emails. Wait a minute before trying again." },
});
router.post(`${path}/test`, testLimit, async (req, res) => {
  const scope = scopeOf(req), accountKey = key(scope);
  const { recipient } = body(schemas.SendPlatformTestEmailBody.strict(), req.body);
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: accountKey } });
  if (!account?.enabled || !account.encryptedCredentials || account.provider !== "brevo") throw new ApiError(409, "Configure and enable Brevo email before sending a test.");
  const pub = account.publicConfig as Record<string, string>;
  const credentials = decryptCredentials(account.encryptedCredentials);
  if (!credentials.apiKey || !pub.senderEmail || !pub.senderName) throw new ApiError(409, "Complete the Brevo email settings first.");
  // Record the explicit request before contacting Brevo. Never include credentials or message contents.
  await db.$transaction(tx => school
    ? audit(tx, req.actor, "email.test_requested", "messaging_account", account.id)
    : platformAudit(tx, req.identity, "email.test_requested", "Platform test email requested", null, account.id));
  const messageId = await sendBrevoEmail(credentials.apiKey, {
    senderName: pub.senderName, senderEmail: pub.senderEmail, replyTo: pub.replyTo || undefined, recipient,
    subject: "Rejista — email configuration test",
    text: "This is a test email from your Rejista system settings. Your Brevo email configuration accepted this test request.",
  });
  res.set("Cache-Control", "no-store");
  send(res, school ? "SendSchoolTestEmail" : "SendPlatformTestEmail", { message: "Test email accepted by Brevo. Check the recipient's inbox and Brevo transactional logs for delivery.", messageId });
});
}
mountEmailSettings(platformEmailRouter, "/platform/settings/email", false);
mountEmailSettings(schoolEmailRouter, "/email/settings", true);
