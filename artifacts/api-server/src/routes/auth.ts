import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, body, parse, contacts, requireContact, session, clearSession, send, authenticate, audit, lock, phone, allow, type Tx, type Actor } from "../lib/core";

const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." }); } });
const setupLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many setup attempts. Try again later." }); } });
export async function provision(tx: Tx, input: ReturnType<typeof z.CreateInitialSchoolBody.parse>, role: string, metadata: { ip?: string; userAgent?: string; initiator?: Actor["user"] } = {}) {
  const contact = contacts({ email: input.email, phone: input.phone });
  requireContact(contact);
  const school = await tx.school.create({ data: { name: input.schoolName, code: input.schoolCode, county: input.county, type: input.schoolType } });
  const user = await tx.user.create({ data: { schoolId: role === "super_admin" ? null : school.id, sessionSchoolId: role === "super_admin" ? school.id : null, name: input.adminName, ...contact, role, passwordHash: await hashPassword(input.password) } });
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
  send(res, "CreateInitialSchool", result, 201);
});
router.post("/auth/login", loginLimit, async (req, res) => {
  const input = body(z.LoginBody, req.body);
  let identifier = input.identifier.toLowerCase();
  if (!identifier.includes("@")) {
    try { identifier = phone(identifier); } catch { throw new ApiError(401, "Invalid credentials"); }
  }
  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] }, include: { school: true } });
  const school = user?.school ?? (user?.role === "super_admin" && user.sessionSchoolId ? await db.school.findUnique({ where: { id: user.sessionSchoolId } }) : null);
  if (!user || !await verifyPassword(input.password, user.passwordHash) || !user.isActive || !school || school.status !== "active") {
    throw new ApiError(401, "Invalid credentials");
  }
  const updated = await db.$transaction(async tx => {
    await lock(tx, school.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const currentSchool = await tx.school.findUniqueOrThrow({ where: { id: school.id } });
    if (!current.isActive || current.passwordHash !== user.passwordHash || currentSchool.status !== "active") throw new ApiError(401, "Invalid credentials");
    const updated = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(tx, { user, school, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) }, "login", "user", user.id, { lastLoginAt: user.lastLoginAt }, { lastLoginAt: updated.lastLoginAt });
    return updated;
  });
  session(req, res, updated);
  send(res, "Login", { user: updated, school });
});
router.post("/auth/password", loginLimit, authenticate, async (req, res) => {
  const input = body(z.ChangeOwnPasswordBody, req.body);
  const user = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: req.actor.user.id } });
    if (!await verifyPassword(input.currentPassword, current.passwordHash)) throw new ApiError(403, "Current password is incorrect");
    if (input.currentPassword === input.newPassword) throw new ApiError(400, "Choose a different new password");
    const updated = await tx.user.update({ where: { id: current.id }, data: { passwordHash: await hashPassword(input.newPassword), sessionVersion: { increment: 1 } } });
    await audit(tx, req.actor, "password_changed", "user", current.id, { sessionVersion: current.sessionVersion }, { sessionVersion: updated.sessionVersion });
    return updated;
  });
  session(req, res, user); send(res, "ChangeOwnPassword", { message: "Password changed. Other sessions have been signed out." });
});
router.post("/auth/logout", authenticate, (req, res) => {
  clearSession(req, res); send(res, "Logout", { message: "Signed out" });
});
router.get("/auth/me", authenticate, (req, res) => { send(res, "GetCurrentUser", req.actor); });
router.get("/schools", authenticate, async (req, res) => {
  allow(req, ["super_admin"]); send(res, "ListSchools", await db.school.findMany({ orderBy: { createdAt: "asc" }, take: 1000 }));
});
router.post("/schools", authenticate, async (req, res) => {
  allow(req, ["super_admin"]);
  // The supplemental contract uses the same bootstrap input.
  const input = body(z.CreateSchoolBody, req.body);
  const result = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const result = await provision(tx, input, "school_admin", { ip: req.actor.ip, userAgent: req.actor.userAgent, initiator: req.actor.user });
    await audit(tx, req.actor, "provisioned", "school", result.school.id);
    return result;
  }, { timeout: 30000 });
  send(res, "CreateSchool", result.school, 201);
});
router.patch("/schools/:schoolId", authenticate, async (req, res) => {
  allow(req, ["super_admin"]);
  const { schoolId } = parse(z.UpdatePlatformSchoolParams, req.params);
  const data = body(z.UpdatePlatformSchoolBody.strict(), req.body);
  if (schoolId === req.actor.school.id && data.status === "suspended") throw new ApiError(409, "Cannot suspend your session-bound school");
  const record = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.school.findUnique({ where: { id: schoolId } });
    if (!old) throw new ApiError(404, "School not found");
    const effective = { ...old, ...data };
    if (effective.subscriptionStartDate && effective.subscriptionEndDate && effective.subscriptionStartDate > effective.subscriptionEndDate) throw new ApiError(400, "Subscription end date must follow start date");
    const updated = await tx.school.update({ where: { id: schoolId }, data });
    await audit(tx, req.actor, "platform_updated", "school", schoolId, old, updated);
    return updated;
  });
  send(res, "UpdatePlatformSchool", record);
});
export default router;