import sanitizeHtml from "sanitize-html";
import { db } from "@workspace/db";
import { ApiError, type Tx } from "./core";
import { decryptCredentials } from "./integrations/security";
import { BrevoSendError, sendBrevoEmail } from "./integrations/brevo";
import { logger } from "./logger";

export function cleanEmailHtml(html: string) {
  const clean = sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "hr"],
    allowedAttributes: { a: ["href", "title"] }, allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
  });
  const text = sanitizeHtml(clean.replace(/<\/(p|h[123]|li|blockquote)>/g, "\n").replace(/<br\s*\/?>/g, "\n"), { allowedTags: [], allowedAttributes: {} }).trim();
  if (!text.replace(/&nbsp;/g, " ").trim()) throw new ApiError(400, "Write an email message before sending.");
  return { html: clean, text };
}
export const escapeEmailText = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function queueWelcome(tx: Tx, user: { id: string; email: string | null; name: string }, school: { name: string; status: string }) {
  if (!user.email) return;
  const account = await tx.messagingAccount.findUnique({ where: { scope_channel: { scope: "platform", channel: "email" } } });
  const ready = !!account?.enabled && !!account.encryptedCredentials;
  const text = `Hello ${user.name},\n\nWelcome to Rejista. ${school.name} has been registered.${school.status === "pending" ? " Your registration is awaiting administrator approval. You can sign in to check its status." : " You can sign in using the credentials provided to you."}\n\nThank you for joining Rejista.`;
  await tx.emailCampaign.upsert({
    where: { scope_idempotencyKey: { scope: "platform", idempotencyKey: `welcome:${user.id}` } },
    update: {},
    create: { scope: "platform", idempotencyKey: `welcome:${user.id}`, kind: "welcome", subject: "Welcome to Rejista",
      text, html: `<p>${escapeEmailText(text).replace(/\n/g, "<br>")}</p>`,
      recipients: { create: { email: user.email.toLowerCase(), status: ready ? "queued" : "skipped", error: ready ? null : "Platform email was not enabled at registration." } } },
  });
}

export async function resolveEmailAccount(scope: string) {
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: { scope, channel: "email" } } });
  if (!account?.enabled || account.provider !== "brevo" || !account.encryptedCredentials) throw new ApiError(409, "Configure and enable your own Brevo email account in Settings first.");
  const pub = account.publicConfig as Record<string, string>;
  const credentials = decryptCredentials(account.encryptedCredentials);
  if (!credentials.apiKey || !pub.senderName || !pub.senderEmail) throw new ApiError(409, "Complete your email sender settings first.");
  return { account, pub, credentials };
}

let running = false;
export async function processEmailQueue() {
  if (running) return;
  running = true;
  try {
    // A process may die after the provider accepted the message. Never retry it blindly.
    await db.emailRecipient.updateMany({ where: { status: "sending", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      data: { status: "uncertain", error: "Sending was interrupted. Check Brevo logs; no automatic retry was made." } });
    const items = await db.emailRecipient.findMany({ where: { status: "queued" }, orderBy: { updatedAt: "asc" }, take: 10, include: { campaign: true } });
    for (const item of items) {
      const claim = await db.emailRecipient.updateMany({ where: { id: item.id, status: "queued" }, data: { status: "sending" } });
      if (!claim.count) continue;
      let submitted = false;
      try {
        const campaign = item.campaign;
        if (campaign.scope !== "platform") {
          const school = await db.school.findUnique({ where: { id: campaign.scope }, select: { status: true } });
          if (school?.status !== "active") throw new ApiError(409, "School is not active; email was not submitted.");
        }
        if (campaign.kind === "marketing" && await db.emailSuppression.findUnique({ where: { scope_email: { scope: campaign.scope, email: item.email } } })) {
          await db.emailRecipient.update({ where: { id: item.id }, data: { status: "skipped", error: "Recipient unsubscribed from marketing." } });
          continue;
        }
        const { credentials, pub } = await resolveEmailAccount(campaign.scope);
        const url = `${campaign.publicOrigin}/api/email/unsubscribe/${item.unsubscribeToken}`;
        const footer = campaign.kind === "marketing" ? `<hr><p>Sent by ${escapeEmailText(pub.senderName)} (${escapeEmailText(pub.senderEmail)}). <a href="${escapeEmailText(url)}">Unsubscribe from marketing emails</a></p>` : "";
        submitted = true;
        const messageId = await sendBrevoEmail(credentials.apiKey, {
          senderName: pub.senderName, senderEmail: pub.senderEmail, replyTo: pub.replyTo || undefined,
          recipient: item.email, subject: campaign.subject, html: campaign.html + footer,
          text: campaign.text + (footer ? `\n\nUnsubscribe: ${url}` : ""),
        });
        await db.emailRecipient.update({ where: { id: item.id }, data: { status: "accepted", providerMessageId: messageId, error: null } });
      } catch (error) {
        const status = error instanceof BrevoSendError ? error.outcome : submitted ? "uncertain" : "failed";
        await db.emailRecipient.update({ where: { id: item.id }, data: { status, error: error instanceof ApiError ? error.message : "Email processing failed. Check provider logs before retrying." } });
      }
    }
  } finally { running = false; }
}
export function startEmailWorker() {
  const tick = () => { void processEmailQueue().catch(() => logger.error("Email queue processing failed; pending messages remain stored.")); };
  tick();
  setInterval(tick, 5000).unref();
}
