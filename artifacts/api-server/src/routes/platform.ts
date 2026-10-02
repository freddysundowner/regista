import { Router } from "express";
import { db, type Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { z as validator } from "zod";
import { ApiError, authenticateIdentity, body, contacts, requireContact, lock, parse, send, session, resolveTenant } from "../lib/core";
import { authView, platformAudit, requirePlatform } from "../lib/platform";
import { hashPassword } from "../lib/password";
import { provision } from "./auth";

const router = Router();
// Mount only on platform paths: tenant endpoints retain their own middleware.
router.use(["/platform", "/schools"], authenticateIdentity, async (req, _res, next) => {
  try {
    requirePlatform(req);
    if (req.identity.grantId && req.originalUrl.split("?")[0] !== "/api/platform/tenant-access/exit") {
      const actor = await resolveTenant(req);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !actor.tenantAccess?.writeEnabled) throw new ApiError(403, "Exit read-only tenant access before making platform changes");
    }
    next();
  } catch (error) { next(error); }
});
const ids = validator.object({ schoolId: validator.string().uuid(), userId: validator.string().uuid().optional() });
async function schoolExists(id: string) {
  const school = await db.school.findUnique({ where: { id } });
  if (!school) throw new ApiError(404, "School not found");
  return school;
}
router.get("/platform/overview", async (_req, res) => {
  const [schools, activeSchools, suspendedSchools, activeSubscriptions, administrators] = await Promise.all([
    db.school.count(), db.school.count({ where: { status: "active" } }), db.school.count({ where: { status: "suspended" } }),
    db.school.count({ where: { subscriptionStatus: "active" } }), db.user.count({ where: { role: "school_admin", isActive: true } }),
  ]);
  send(res, "GetPlatformOverview", { schools, activeSchools, suspendedSchools, activeSubscriptions, administrators });
});
router.get(["/platform/schools", "/schools"], async (_req, res) => {
  send(res, "ListPlatformSchools", await db.school.findMany({ orderBy: { createdAt: "desc" } }));
});
router.get("/platform/schools/:schoolId", async (req, res) => {
  send(res, "GetPlatformSchool", await schoolExists(parse(ids, req.params).schoolId));
});
router.post(["/platform/schools", "/schools"], async (req, res) => {
  const { reason, confirmation: _confirmation, ...input } = body(z.ProvisionPlatformSchoolBody, req.body);
  const result = await db.$transaction(async tx => {
    const result = await provision(tx, input, "school_admin", { initiator: req.identity.user, ip: req.ip, userAgent: req.identity.userAgent });
    await platformAudit(tx, req.identity, "school.provisioned", reason, result.school.id, result.school.id, undefined, result.school);
    return result.school;
  }, { timeout: 30000 });
  send(res, "ProvisionPlatformSchool", result, 201);
});
router.patch(["/platform/schools/:schoolId", "/schools/:schoolId"], async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  const { reason, confirmation: _confirmation, ...data } = body(z.EditPlatformSchoolBody.strict(), req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.school.findUnique({ where: { id: schoolId } });
    if (!old) throw new ApiError(404, "School not found");
    const effective = { ...old, ...data };
    if (effective.subscriptionStartDate && effective.subscriptionEndDate && effective.subscriptionStartDate > effective.subscriptionEndDate) throw new ApiError(400, "Subscription end date must follow start date");
    const updated = await tx.school.update({ where: { id: schoolId }, data });
    await platformAudit(tx, req.identity, "school.updated", reason, schoolId, schoolId, old, updated);
    return updated;
  });
  send(res, "EditPlatformSchool", record);
});
router.get("/platform/schools/:schoolId/admins", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  await schoolExists(schoolId);
  send(res, "ListPlatformAdmins", await db.user.findMany({ where: { schoolId, role: "school_admin" }, orderBy: { name: "asc" } }));
});
router.post("/platform/schools/:schoolId/admins", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  if (req.body.role !== undefined) throw new ApiError(400, "Role cannot be supplied");
  const { password, reason, confirmation: _confirmation, ...data } = contacts(body(z.CreatePlatformAdminBody, req.body));
  requireContact(data);
  const passwordHash = await hashPassword(password);
  const record = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    if (!await tx.school.findUnique({ where: { id: schoolId } })) throw new ApiError(404, "School not found");
    const user = await tx.user.create({ data: { ...data, name: data.name!, schoolId, role: "school_admin", passwordHash } });
    await platformAudit(tx, req.identity, "admin.created", reason, schoolId, user.id, undefined, user);
    return user;
  });
  send(res, "CreatePlatformAdmin", record, 201);
});
router.patch("/platform/schools/:schoolId/admins/:userId", async (req, res) => {
  const { schoolId, userId } = parse(ids.required(), req.params);
  const { reason, confirmation: _confirmation, ...data } = contacts(body(z.EditPlatformAdminBody.strict(), req.body));
  const record = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.user.findFirst({ where: { id: userId, schoolId, role: "school_admin" } });
    if (!old) throw new ApiError(404, "School administrator not found");
    requireContact({ ...old, ...data });
    if (old.isActive && data.isActive === false && await tx.user.count({ where: { schoolId, role: "school_admin", isActive: true } }) <= 1) throw new ApiError(409, "The last active school administrator cannot be disabled");
    const user = await tx.user.update({ where: { id: userId }, data: { ...data, ...(data.isActive !== undefined && data.isActive !== old.isActive ? { sessionVersion: { increment: 1 } } : {}) } });
    await platformAudit(tx, req.identity, "admin.updated", reason, schoolId, userId, old, user);
    return user;
  });
  send(res, "EditPlatformAdmin", record);
});
router.post("/platform/schools/:schoolId/admins/:userId/reset-password", async (req, res) => {
  const { schoolId, userId } = parse(ids.required(), req.params);
  const { password, reason } = body(z.ResetPlatformAdminPasswordBody, req.body);
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.user.findFirst({ where: { id: userId, schoolId, role: "school_admin" } });
    if (!old) throw new ApiError(404, "School administrator not found");
    await tx.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await platformAudit(tx, req.identity, "admin.password_reset", reason, schoolId, userId);
  });
  send(res, "ResetPlatformAdminPassword", { message: "Password reset. All administrator sessions revoked." });
});
router.get("/platform/audit", async (req, res) => {
  const { schoolId, limit = 50, page = 1, action, search } = parse(z.ListPlatformAuditQueryParams, req.query);
  const where: Prisma.PlatformAuditWhereInput = {
    schoolId, action,
    ...(search ? { OR: ["reason", "action", "entityId"].map(field => ({ [field]: { contains: search, mode: "insensitive" } })) } : {}),
  };
  const [total, rows] = await db.$transaction([
    db.platformAudit.count({ where }),
    db.platformAudit.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: (page - 1) * limit }),
  ], { isolationLevel: "RepeatableRead" });
  res.setHeader("X-Total-Count", String(total));
  send(res, "ListPlatformAudit", rows);
});
router.post("/platform/tenant-access", async (req, res) => {
  const input = body(z.EnterTenantAccessBody, req.body);
  const grant = await db.$transaction(async tx => {
    await lock(tx, input.schoolId);
    const school = await tx.school.findUnique({ where: { id: input.schoolId } });
    if (!school || school.status !== "active") throw new ApiError(409, "Only active schools can be accessed");
    await tx.platformTenantGrant.updateMany({ where: { actorId: req.identity.user.id, sessionId: req.identity.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    const grant = await tx.platformTenantGrant.create({ data: {
      actorId: req.identity.user.id, schoolId: school.id, sessionId: req.identity.sessionId,
      sessionVersion: req.identity.user.sessionVersion, reason: input.reason, writeEnabled: input.writeEnabled ?? false,
      expiresAt: new Date(Date.now() + (input.durationMinutes ?? 30) * 60000),
    } });
    await platformAudit(tx, req.identity, "tenant.entered", input.reason, school.id, school.id, undefined, { writeEnabled: grant.writeEnabled, expiresAt: grant.expiresAt }, grant.id);
    return grant;
  });
  req.identity.grantId = grant.id;
  session(req, res, req.identity.user, req.identity);
  send(res, "EnterTenantAccess", await authView(req));
});
router.post("/platform/tenant-access/exit", async (req, res) => {
  await db.$transaction(async tx => {
    const grant = req.identity.grantId ? await tx.platformTenantGrant.findFirst({ where: { id: req.identity.grantId, actorId: req.identity.user.id, sessionId: req.identity.sessionId } }) : null;
    if (grant) {
      await tx.platformTenantGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      await platformAudit(tx, req.identity, "tenant.exited", grant.reason, grant.schoolId, grant.schoolId, undefined, undefined, grant.id);
    }
  });
  req.identity.grantId = undefined;
  session(req, res, req.identity.user, req.identity);
  send(res, "ExitTenantAccess", await authView(req));
});
export default router;