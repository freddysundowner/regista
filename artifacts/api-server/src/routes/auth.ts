import { Router } from "express";
import { requireApproval, trialEnd } from "../lib/billing";
import { isStandalone, requireHosted } from "../lib/installation";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual, randomUUID, randomBytes } from "node:crypto";
import { decryptCredentials, digest } from "../lib/integrations/security";
import { sendBrevoEmail } from "../lib/integrations/brevo";
import { escapeEmailText } from "../lib/email";
import { logger } from "../lib/logger";
import { ApiError, body, contacts, requireContact, session, clearSession, revokeSessions, send, authenticateIdentity, audit, lock, phone, type Tx, type Actor } from "../lib/core";
import { authView, platformAudit } from "../lib/platform";
import { queueWelcome } from "../lib/email";
import { UNNAMED_SCHOOL } from "./onboarding";

const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." }); } });
const setupLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many setup attempts. Try again later." }); } });
const registrationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many registration attempts. Try again in an hour." }); } });
// The wording of the Terms and Privacy Policy an account agrees to; keep in step with LEGAL_VERSION in the web app.
const TERMS_VERSION = "2026-10-12";
// Pending/rejected applicants may authenticate only to see their application.
// resolveTenant independently refuses all operational access until approval.
const canSignIn = (status?: string) => !!status && ["active", "pending", "rejected"].includes(status);
const EMAIL_TAKEN = "An account with this email already exists. Sign in instead, or use a different email.";
const availabilityLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many checks. Try again in a few minutes." }); } });
// Sign-up asks this on its first screen. It reveals no more than submitting the form would, and is rate limited the same way.
router.post("/auth/email-available", availabilityLimit, async (req, res) => {
  requireHosted();
  const input = body(z.CheckEmailAvailableBody.strict(), req.body);
  send(res, "CheckEmailAvailable", { available: !await db.user.findUnique({ where: { email: input.email.trim().toLowerCase() }, select: { id: true } }) });
});
router.post("/auth/register", registrationLimit, async (req, res) => {
  requireHosted();
  const raw = req.body ?? {};
  const input = body(z.RegisterSchoolBody.strict(), {
    ...raw,
    schoolName: typeof raw.schoolName === "string" ? raw.schoolName.trim() : raw.schoolName,
    adminName: typeof raw.adminName === "string" ? raw.adminName.trim() : raw.adminName,
    email: typeof raw.email === "string" ? raw.email.trim().toLowerCase() : raw.email,
  });
  if (input.acceptedTerms === false) throw new ApiError(400, "Accept the terms to create an account.");
  // A public registration must never replace the protected first-owner setup.
  if (!await db.user.count({ where: { role: "super_admin", isActive: true } })) throw new ApiError(503, "School registration is not available yet. Please try again later.");
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ApiError(409, EMAIL_TAKEN);
  const passwordHash = await hashPassword(input.password);
  const result = await db.$transaction(async tx => {
    // With approval switched off, the school opens immediately on the free trial.
    const instant = !await requireApproval(tx);
    const school = await tx.school.create({ data: {
      // Sign-up asks nothing about the school; the admin names it from the dashboard setup card.
      name: input.schoolName || UNNAMED_SCHOOL, type: input.schoolType ?? "other",
      code: `SCH-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      status: instant ? "active" : "pending",
      ...(instant ? { trialEndsAt: await trialEnd(tx) } : {}),
    } });
    const user = await tx.user.create({ data: {
      schoolId: school.id, name: input.adminName, email: input.email,
      role: "school_admin", passwordHash,
    } });
    const actor = { school, user, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) };
    await audit(tx, actor, "registration_submitted", "school", school.id, undefined, school);
    await audit(tx, actor, "created", "user", user.id, undefined, user);
    // Proof of what was agreed to and when: the wording's version, with the time, address and device on the entry.
    if (input.acceptedTerms) await audit(tx, actor, "terms_accepted", "user", user.id, undefined, { version: TERMS_VERSION });
    await queueWelcome(tx, user, school, { selfRegistered: true });
    return { school, user };
  }, { timeout: 30000 });
  session(req, res, result.user);
  send(res, "RegisterSchool", { ...result, mode: result.school.status === "active" ? "tenant" : "registration", tenantAccess: null }, 201);
});
export async function provision(tx: Tx, input: ReturnType<typeof z.CreateInitialSchoolBody.parse>, role: string, metadata: { ip?: string; userAgent?: string; initiator?: Actor["user"] } = {}) {
  const contact = contacts({ email: input.email, phone: input.phone });
  requireContact(contact);
  // Platform-provisioned schools start on the free trial; the owner's first school is never time-limited.
  const school = await tx.school.create({ data: { name: input.schoolName, code: input.schoolCode, county: input.county, type: input.schoolType,
    ...(role === "school_admin" && !isStandalone() ? { trialEndsAt: await trialEnd(tx) } : {}) } });
  const user = await tx.user.create({ data: { schoolId: role === "super_admin" ? null : school.id, name: input.adminName, ...contact, role, passwordHash: await hashPassword(input.password) } });
  const actor = { school, user: metadata.initiator ?? user, ip: metadata.ip, userAgent: metadata.userAgent };
  await audit(tx, actor, "created", "school", school.id, undefined, school);
  await audit(tx, actor, "created", "user", user.id, undefined, user);
  if (role === "school_admin") await queueWelcome(tx, user, school);
  return { school, user };
}
router.get("/setup/status", async (_req, res) => {
  send(res, "GetSetupStatus", { needsSetup: await db.school.count() === 0, requiresSetupToken: productionSetup() });
});
export const productionSetup = () => process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";
export function verifySetupToken(input?: string) {
  if (!productionSetup()) return;
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 32) throw new ApiError(503, "Production setup is disabled. Configure SETUP_TOKEN with at least 32 characters.");
  if (!input || !timingSafeEqual(createHash("sha256").update(input).digest(), createHash("sha256").update(expected).digest())) throw new ApiError(403, "A valid setup token is required");
}
router.post("/setup", setupLimit, async (req, res) => {
  const input = body(z.CreateInitialSchoolBody, req.body);
  verifySetupToken(input.setupToken);
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(618534921)`;
    if (await tx.school.count()) throw new ApiError(409, "Setup has already been completed");
    return provision(tx, input, "super_admin", { ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) });
  }, { timeout: 30000 });
  session(req, res, result.user);
  send(res, "CreateInitialSchool", { user: result.user, school: null, mode: "platform", tenantAccess: null }, 201);
});
router.post("/auth/login", loginLimit, async (req, res) => {
  const input = body(z.LoginBody, req.body);
  let identifier = input.identifier.toLowerCase();
  if (!identifier.includes("@")) {
    try { identifier = phone(identifier); } catch { throw new ApiError(401, "Invalid credentials"); }
  }
  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] }, include: { school: true } });
  const school = user?.role === "super_admin" ? null : user?.school;
  if (!user || !await verifyPassword(input.password, user.passwordHash) || !user.isActive || (user.role !== "super_admin" && !canSignIn(school?.status))) {
    throw new ApiError(401, "Invalid credentials");
  }
  const updated = await db.$transaction(async tx => {
    await lock(tx, school?.id ?? user.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const currentSchool = school ? await tx.school.findUniqueOrThrow({ where: { id: school.id } }) : null;
    if (!current.isActive || current.passwordHash !== user.passwordHash || current.sessionVersion !== user.sessionVersion || (current.role !== "super_admin" && !canSignIn(currentSchool?.status))) throw new ApiError(401, "Invalid credentials");
    const updated = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (school) await audit(tx, { user, school, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) }, "login", "user", user.id, { lastLoginAt: user.lastLoginAt }, { lastLoginAt: updated.lastLoginAt });
    else await platformAudit(tx, { user, sessionId: "", ip: req.ip }, "login", "Platform sign-in");
    return updated;
  });
  session(req, res, updated);
  const currentSchool = updated.schoolId ? await db.school.findUnique({ where: { id: updated.schoolId } }) : null;
  send(res, "Login", { user: updated, school: currentSchool, mode: updated.role === "super_admin" ? "platform" : currentSchool?.status === "active" ? "tenant" : "registration", tenantAccess: null });
});
router.post("/auth/password", loginLimit, authenticateIdentity, async (req, res) => {
  const input = body(z.ChangeOwnPasswordBody, req.body);
  const user = await db.$transaction(async tx => {
    await lock(tx, req.identity.user.schoolId ?? req.identity.user.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: req.identity.user.id } });
    if (!await verifyPassword(input.currentPassword, current.passwordHash)) throw new ApiError(403, "Current password is incorrect");
    if (input.currentPassword === input.newPassword) throw new ApiError(400, "Choose a different new password");
    const updated = await tx.user.update({ where: { id: current.id }, data: { passwordHash: await hashPassword(input.newPassword), sessionVersion: { increment: 1 } } });
    if (current.role === "super_admin") await platformAudit(tx, req.identity, "password_changed", "Owner changed own password", null, current.id);
    else {
      const school = await tx.school.findUniqueOrThrow({ where: { id: current.schoolId! } });
      await audit(tx, { user: current, school }, "password_changed", "user", current.id, { sessionVersion: current.sessionVersion }, { sessionVersion: updated.sessionVersion });
    }
    return updated;
  });
  session(req, res, user); send(res, "ChangeOwnPassword", { message: "Password changed. Other sessions have been signed out." });
});
// ---------- Forgotten passwords ----------
const forgotLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many reset requests. Try again in 15 minutes." }); } });
const RESET_MINUTES = 60;
/** Where the emailed link points. Never taken from the request in production: a forged Host header must not choose it. */
function resetBase(req: { protocol: string; get(name: string): string | undefined }) {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\/[^/]+$/.test(configured)) return configured;
  if (process.env.NODE_ENV === "production") throw new ApiError(503, "Password reset emails are not set up on this system yet. Ask your administrator to reset your password.");
  return `${req.protocol}://${req.get("host")}`;
}
router.post("/auth/forgot-password", forgotLimit, async (req, res) => {
  const { email } = body(z.RequestPasswordResetBody.strict(), req.body);
  // Sent from the platform's own email account, the same one that sends welcome emails.
  const account = await db.messagingAccount.findUnique({ where: { scope_channel: { scope: "platform", channel: "email" } } });
  const sender = account?.publicConfig as Record<string, string> | undefined;
  const apiKey = account?.enabled && account.encryptedCredentials ? decryptCredentials(account.encryptedCredentials).apiKey : null;
  if (!apiKey || !sender?.senderEmail) throw new ApiError(503, "Password reset emails are not set up on this system yet. Ask your administrator to reset your password.");
  const base = resetBase(req);
  const done = () => send(res, "RequestPasswordReset", { message: "If that email has an account, a link to choose a new password is on its way. It works for one hour." });
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // The same reply either way, so this can't be used to find out who has an account.
  if (!user?.isActive) { done(); return; }
  if (await db.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3600_000) } } }) >= 3) { done(); return; }
  const token = randomBytes(32).toString("base64url");
  await db.passwordReset.create({ data: { userId: user.id, tokenHash: digest(`password-reset:${token}`), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
  const link = `${base}/reset-password?token=${token}`;
  const text = `Hello ${user.name},\n\nSomeone asked to reset the password for your Rejista account. Open this link to choose a new one:\n\n${link}\n\nThe link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays the same.`;
  const html = `<p>Hello ${escapeEmailText(user.name)},</p><p>Someone asked to reset the password for your Rejista account. Use the button below to choose a new one.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1f5560;color:#ffffff;text-decoration:none;font-weight:600">Choose a new password</a></p><p>The link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays the same.</p>`;
  // A sending failure is logged, not shown: the reply must not reveal that this address has an account.
  await sendBrevoEmail(apiKey, { senderName: sender.senderName || "Rejista", senderEmail: sender.senderEmail, replyTo: sender.replyTo || undefined, recipient: user.email!, subject: "Reset your Rejista password", text, html })
    .catch(err => logger.warn({ err: err instanceof Error ? err.message : err }, "Password reset email could not be sent"));
  done();
});
router.post("/auth/reset-password", loginLimit, async (req, res) => {
  const input = body(z.ResetPasswordWithLinkBody.strict(), req.body);
  const passwordHash = await hashPassword(input.password);
  const user = await db.$transaction(async tx => {
    const reset = await tx.passwordReset.findUnique({ where: { tokenHash: digest(`password-reset:${input.token}`) }, include: { user: true } });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || !reset.user.isActive) throw new ApiError(400, "This link has expired or was already used. Ask for a new one.");
    await lock(tx, reset.user.schoolId ?? reset.user.id);
    // Claim the link first, so two requests with the same link can't both succeed.
    const claimed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new ApiError(400, "This link has expired or was already used. Ask for a new one.");
    await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
    const updated = await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    const who = { ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) };
    if (updated.role === "super_admin" || !updated.schoolId) await platformAudit(tx, { user: updated, sessionId: "", ...who }, "password_reset_by_email", "Password reset with an emailed link", null, updated.id);
    else {
      const school = await tx.school.findUniqueOrThrow({ where: { id: updated.schoolId } });
      await audit(tx, { user: updated, school, ...who }, "password_reset_by_email", "user", updated.id, { sessionVersion: reset.user.sessionVersion }, { sessionVersion: updated.sessionVersion });
    }
    return updated;
  });
  logger.info({ userId: user.id }, "Password reset with an emailed link");
  send(res, "ResetPasswordWithLink", { message: "Password changed. Sign in with your new password." });
});
router.post("/auth/logout", async (req, res) => {
  await revokeSessions(req);
  clearSession(req, res); send(res, "Logout", { message: "Signed out" });
});
router.get("/auth/me", authenticateIdentity, async (req, res) => { send(res, "GetCurrentUser", await authView(req)); });
export default router;