import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { ApiError, body, contacts, requireContact, session, clearSession, send, authenticateIdentity, audit, lock, phone, type Tx, type Actor } from "../lib/core";
import { authView, platformAudit } from "../lib/platform";

const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." }); } });
const setupLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many setup attempts. Try again later." }); } });
const registrationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many registration attempts. Try again in an hour." }); } });
// Pending/rejected applicants may authenticate only to see their application.
// resolveTenant independently refuses all operational access until approval.
const canSignIn = (status?: string) => !!status && ["active", "pending", "rejected"].includes(status);
router.post("/auth/register", registrationLimit, async (req, res) => {
  const raw = req.body ?? {};
  const input = body(z.RegisterSchoolBody.strict(), {
    ...raw,
    schoolName: typeof raw.schoolName === "string" ? raw.schoolName.trim() : raw.schoolName,
    adminName: typeof raw.adminName === "string" ? raw.adminName.trim() : raw.adminName,
    email: typeof raw.email === "string" ? raw.email.trim().toLowerCase() : raw.email,
  });
  // A public registration must never replace the protected first-owner setup.
  if (!await db.user.count({ where: { role: "super_admin", isActive: true } })) throw new ApiError(503, "School registration is not available yet. Please try again later.");
  const passwordHash = await hashPassword(input.password);
  const result = await db.$transaction(async tx => {
    const school = await tx.school.create({ data: {
      name: input.schoolName, type: input.schoolType,
      code: `SCH-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      status: "pending",
    } });
    const user = await tx.user.create({ data: {
      schoolId: school.id, name: input.adminName, email: input.email,
      role: "school_admin", passwordHash,
    } });
    const actor = { school, user, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) };
    await audit(tx, actor, "registration_submitted", "school", school.id, undefined, school);
    await audit(tx, actor, "created", "user", user.id, undefined, user);
    return { school, user };
  }, { timeout: 30000 });
  session(req, res, result.user);
  send(res, "RegisterSchool", { ...result, mode: "registration", tenantAccess: null }, 201);
});
export async function provision(tx: Tx, input: ReturnType<typeof z.CreateInitialSchoolBody.parse>, role: string, metadata: { ip?: string; userAgent?: string; initiator?: Actor["user"] } = {}) {
  const contact = contacts({ email: input.email, phone: input.phone });
  requireContact(contact);
  const school = await tx.school.create({ data: { name: input.schoolName, code: input.schoolCode, county: input.county, type: input.schoolType } });
  const user = await tx.user.create({ data: { schoolId: role === "super_admin" ? null : school.id, name: input.adminName, ...contact, role, passwordHash: await hashPassword(input.password) } });
  const actor = { school, user: metadata.initiator ?? user, ip: metadata.ip, userAgent: metadata.userAgent };
  await audit(tx, actor, "created", "school", school.id, undefined, school);
  await audit(tx, actor, "created", "user", user.id, undefined, user);
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
router.post("/auth/logout", (req, res) => {
  clearSession(req, res); send(res, "Logout", { message: "Signed out" });
});
router.get("/auth/me", authenticateIdentity, async (req, res) => { send(res, "GetCurrentUser", await authView(req)); });
export default router;