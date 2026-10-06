import { Router, type Request } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { admin, allow, ApiError, audit, body, lock, send } from "../lib/core";
import { platformAudit } from "../lib/platform";
import { cleanEmailHtml, resolveEmailAccount } from "../lib/email";

export const platformCampaignRouter = Router();
export const schoolCampaignRouter = Router();
export const emailUnsubscribeRouter = Router();

async function audience(scope: string) {
  const users = await db.user.findMany({ where: { isActive: true, email: { not: null }, ...(scope === "platform" ? { role: "school_admin" } : { schoolId: scope }) },
    select: { id: true, name: true, email: true } });
  const guardians = scope === "platform" ? [] : await db.guardian.findMany({ where: { schoolId: scope, email: { not: null } }, select: { id: true, name: true, email: true } });
  const unique = new Map<string, { id: string; name: string; email: string }>();
  for (const row of [...users, ...guardians]) {
    if (row.email && z.string().email().safeParse(row.email).success) {
      const email = row.email.toLowerCase();
      if (!unique.has(email)) unique.set(email, { id: row.id, name: row.name, email });
    }
  }
  return [...unique.values()];
}
function mountCampaigns(router: Router, platform: boolean) {
  const prefix = platform ? "/platform" : "";
  const scopeOf = (req: Request) => { if (!platform) { allow(req, admin); return req.actor.school.id; } return "platform"; };
  router.get(`${prefix}/email-recipients`, async (req, res) => {
    send(res, platform ? "ListPlatformEmailRecipients" : "ListSchoolEmailRecipients", await audience(scopeOf(req)));
  });
  router.get(`${prefix}/emails`, async (req, res) => {
    const campaigns = await db.emailCampaign.findMany({ where: { scope: scopeOf(req) }, orderBy: { createdAt: "desc" }, take: 50, include: { recipients: { select: { status: true } } } });
    send(res, platform ? "ListPlatformEmailCampaigns" : "ListSchoolEmailCampaigns", campaigns.map(c => ({
      id: c.id, subject: c.subject, kind: c.kind, createdAt: c.createdAt.toISOString(), total: c.recipients.length,
      queued: c.recipients.filter(r => ["queued", "sending"].includes(r.status)).length,
      accepted: c.recipients.filter(r => r.status === "accepted").length,
      failed: c.recipients.filter(r => r.status === "failed").length,
      uncertain: c.recipients.filter(r => r.status === "uncertain").length,
      skipped: c.recipients.filter(r => r.status === "skipped").length,
    })));
  });
  const limit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: req => req.identity.user.id,
    message: { error: "Too many email requests. Wait a minute before retrying." } });
  router.post(`${prefix}/emails`, limit, async (req, res) => {
    const scope = scopeOf(req);
    const input = body(schemas.CreatePlatformEmailCampaignBody.strict(), req.body);
    const subject = input.subject.trim();
    if (!subject || /[\r\n]/.test(subject)) throw new ApiError(400, "Enter a single-line subject.");
    if (input.kind === "marketing" && !input.consentConfirmed) throw new ApiError(400, "Confirm that all selected recipients gave permission for marketing email.");
    const content = cleanEmailHtml(input.html);
    const recipients = [...new Set(input.recipients.map(e => e.toLowerCase()))].sort();
    if (!platform) {
      const permitted = new Set((await audience(scope)).map(r => r.email));
      if (recipients.some(e => !permitted.has(e))) throw new ApiError(403, "Recipients must be staff or guardians belonging to your school.");
    }
    // Origin is the request's actual trusted-proxy host, not a client-supplied body field.
    const publicOrigin = `${req.protocol}://${req.get("host")}`;
    if (input.kind === "marketing" && !publicOrigin.startsWith("https://")) throw new ApiError(400, "Marketing email needs an HTTPS app address for unsubscribe links.");
    const result = await db.$transaction(async tx => {
      await lock(tx, `email:${scope}:${input.idempotencyKey}`);
      const old = await tx.emailCampaign.findUnique({ where: { scope_idempotencyKey: { scope, idempotencyKey: input.idempotencyKey } }, include: { recipients: true } });
      if (old) {
        if (old.subject !== subject || old.html !== content.html || old.kind !== input.kind || JSON.stringify(old.recipients.map(r => r.email).sort()) !== JSON.stringify(recipients)) throw new ApiError(409, "This send request was already used with different content. Start a new email.");
        return { id: old.id, total: old.recipients.length, message: "This email was already queued; no duplicates were created." };
      }
      await resolveEmailAccount(scope);
      const suppressed = input.kind === "marketing" ? new Set((await tx.emailSuppression.findMany({ where: { scope, email: { in: recipients } } })).map(r => r.email)) : new Set<string>();
      const campaign = await tx.emailCampaign.create({ data: { scope, idempotencyKey: input.idempotencyKey, kind: input.kind, subject, ...content, publicOrigin,
        recipients: { create: recipients.map(email => ({ email, status: suppressed.has(email) ? "skipped" : "queued", error: suppressed.has(email) ? "Recipient unsubscribed from marketing." : null })) } } });
      const summary = { kind: input.kind, count: recipients.length, consentConfirmed: input.consentConfirmed };
      if (platform) await platformAudit(tx, req.identity, "email.campaign_queued", "Email campaign queued", null, campaign.id, undefined, summary);
      else await audit(tx, req.actor, "email.campaign_queued", "email_campaign", campaign.id, undefined, summary);
      return { id: campaign.id, total: recipients.length, message: "Email queued. Monitor history for acceptance or errors; queued does not mean delivered." };
    });
    send(res, platform ? "CreatePlatformEmailCampaign" : "CreateSchoolEmailCampaign", result);
  });
}
mountCampaigns(platformCampaignRouter, true);
mountCampaigns(schoolCampaignRouter, false);

// Confirmation avoids link-scanning email clients unsubscribing people on GET.
emailUnsubscribeRouter.get("/email/unsubscribe/:token", async (req, res) => {
  const token = z.string().uuid().safeParse(req.params.token);
  if (!token.success || !await db.emailRecipient.findUnique({ where: { unsubscribeToken: token.data }, select: { id: true } })) throw new ApiError(404, "Unsubscribe link not found.");
  res.set("Referrer-Policy", "no-referrer").type("html").send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:1rem"><h1>Unsubscribe from marketing emails</h1><p>This stops marketing from this sender. Important account emails are unaffected.</p><form method="post"><button type="submit" style="padding:1rem">Confirm unsubscribe</button></form></body></html>`);
});
emailUnsubscribeRouter.post("/email/unsubscribe/:token", async (req, res) => {
  const token = z.string().uuid().safeParse(req.params.token);
  if (!token.success) throw new ApiError(404, "Unsubscribe link not found.");
  const recipient = await db.emailRecipient.findUnique({ where: { unsubscribeToken: token.data }, include: { campaign: true } });
  if (!recipient || recipient.campaign.kind !== "marketing") throw new ApiError(404, "Unsubscribe link not found.");
  await db.emailSuppression.upsert({ where: { scope_email: { scope: recipient.campaign.scope, email: recipient.email } }, create: { scope: recipient.campaign.scope, email: recipient.email }, update: {} });
  res.set("Referrer-Policy", "no-referrer").type("html").send("<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Unsubscribed</title><body style=\"font:16px system-ui;padding:3rem\"><h1>You have unsubscribed</h1><p>You will no longer receive marketing emails from this sender.</p></body></html>");
});
