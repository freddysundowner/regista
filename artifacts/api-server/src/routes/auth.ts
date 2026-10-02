import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "express-rate-limit";
import { ApiError, body, contacts, requireContact, session, clearSession, send, authenticate, audit, lock, phone, allow, type Tx } from "../lib/core";

const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." }); } });
const setupLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many setup attempts. Try again later." }); } });
export async function provision(tx: Tx, input: ReturnType<typeof z.CreateInitialSchoolBody.parse>, role: string) {
  const contact = contacts({ email: input.email, phone: input.phone });
  requireContact(contact);
  const school = await tx.school.create({ data: { name: input.schoolName, code: input.schoolCode, county: input.county, type: input.schoolType } });
  const user = await tx.user.create({ data: { schoolId: school.id, name: input.adminName, ...contact, role, passwordHash: await hashPassword(input.password) } });
  await audit(tx, { school, user }, "created", "school", school.id);
  await audit(tx, { school, user }, "created", "user", user.id);
  return { school, user };
}
router.get("/setup/status", async (_req, res) => {
  send(res, "GetSetupStatus", { needsSetup: await db.school.count() === 0 });
});
router.post("/setup", setupLimit, async (req, res) => {
  const input = body(z.CreateInitialSchoolBody, req.body);
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(618534921)`;
    if (await tx.school.count()) throw new ApiError(409, "Setup has already been completed");
    return provision(tx, input, "super_admin");
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
  if (!user || !await verifyPassword(input.password, user.passwordHash) || !user.isActive || user.school.status !== "active") {
    throw new ApiError(401, "Invalid credentials");
  }
  await db.$transaction(tx => audit(tx, { user, school: user.school }, "login", "user", user.id));
  session(req, res, user);
  send(res, "Login", { user, school: user.school });
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
    const result = await provision(tx, input, "school_admin");
    await audit(tx, req.actor, "provisioned", "school", result.school.id);
    return result;
  }, { timeout: 30000 });
  send(res, "CreateSchool", result.school, 201);
});
export default router;