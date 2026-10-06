import { Router } from "express";
import { db, type Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { z as validator } from "zod";
import { ApiError, authenticateIdentity, body, contacts, requireContact, lock, parse, send, session, resolveTenant } from "../lib/core";
import { authView, platformAudit, requirePlatform } from "../lib/platform";
import { hashPassword } from "../lib/password";
import { provision } from "./auth";
import billingRouter from "./platform-billing";
import { platformLicensing } from "./licensing";
import { coverage } from "../lib/licensing";
import { platformMessagingRouter } from "./messaging-settings";
import { platformSubscriptions } from "./platform-subscriptions";
import { platformEmailRouter } from "./platform-email";
import { platformCampaignRouter } from "./email-campaigns";
import { platformWhatsappRouter } from "./whatsapp-setup";

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
router.use("/platform/schools/:schoolId/billing", billingRouter);
router.use(platformLicensing);
router.use(platformMessagingRouter);
router.use(platformSubscriptions);
router.use(platformEmailRouter);
router.use(platformCampaignRouter);
router.use(platformWhatsappRouter);
async function schoolExists(id: string) {
  const school = await db.school.findUnique({ where: { id }, include: { licences: { where: { revokedAt: null }, orderBy: { startsAt: "desc" } } } });
  if (!school) throw new ApiError(404, "School not found");
  return licensedSchoolView(school);
}
function licensedSchoolView<T extends { licenceManaged: boolean; licences: { startsAt: Date; expiresAt: Date; revokedAt: Date | null; planName: string }[] }>(school: T) {
  const now = new Date();
  const current = coverage(school.licenceManaged, school.licences, now);
  const plan = school.licences.find(l => l.startsAt <= now && l.expiresAt > now) ?? school.licences.at(-1);
  return { ...school, licenceStatus: current.status, licenceExpiresAt: current.currentEndsAt, licencePlanName: plan?.planName ?? null };
}
router.get("/platform/overview", async (_req, res) => {
  const [schools, activeSchools, suspendedSchools, activeSubscriptions, administrators] = await Promise.all([
    db.school.count(), db.school.count({ where: { status: "active" } }), db.school.count({ where: { status: "suspended" } }),
    db.school.count({ where: { licenceManaged: true, licences: { some: { revokedAt: null, startsAt: { lte: new Date() }, expiresAt: { gt: new Date() } } } } }), db.user.count({ where: { role: "school_admin", isActive: true } }),
  ]);
  send(res, "GetPlatformOverview", { schools, activeSchools, suspendedSchools, activeSubscriptions, administrators });
});
router.get(["/platform/schools", "/schools"], async (_req, res) => {
  const schools = await db.school.findMany({ include: { licences: { where: { revokedAt: null }, orderBy: { startsAt: "desc" } } }, orderBy: { createdAt: "desc" } });
  send(res, "ListPlatformSchools", schools.map(licensedSchoolView));
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
    if (["pending", "rejected"].includes(old.status)) throw new ApiError(409, "Review this school's registration before editing the school.");
    const normalized = contacts(data);
    const effective = { ...old, ...normalized };
    if (effective.subscriptionStartDate && effective.subscriptionEndDate && effective.subscriptionStartDate > effective.subscriptionEndDate) throw new ApiError(400, "Subscription end date must follow start date");
    const updated = await tx.school.update({ where: { id: schoolId }, data: normalized });
    await platformAudit(tx, req.identity, "school.updated", reason, schoolId, schoolId, old, updated);
    return updated;
  });
  send(res, "EditPlatformSchool", record);
});
router.post("/platform/schools/:schoolId/registration", async (req, res) => {
  const { schoolId } = parse(ids, req.params);
  const input = body(z.ReviewSchoolRegistrationBody.strict(), req.body);
  const reason = input.reason?.trim();
  if (input.decision === "reject" && (!reason || reason.length < 3)) throw new ApiError(400, "Please give a reason for declining this registration.");
  const school = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const old = await tx.school.findUnique({ where: { id: schoolId } });
    if (!old) throw new ApiError(404, "School not found");
    if (!["pending", "rejected"].includes(old.status)) throw new ApiError(409, "This registration has already been approved.");
    if (old.status === "rejected" && input.decision === "reject") throw new ApiError(409, "This registration has already been declined.");
    const updated = await tx.school.update({ where: { id: schoolId }, data: {
      status: input.decision === "approve" ? "active" : "rejected",
      registrationNote: input.decision === "reject" ? reason : null,
    } });
    await platformAudit(tx, req.identity, `school.registration_${input.decision === "approve" ? "approved" : "rejected"}`,
      reason || "School registration approved", schoolId, schoolId, old, updated);
    return updated;
  });
  send(res, "ReviewSchoolRegistration", school);
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
    db.platformAudit.findMany({ where, include: { actor: { select: { name: true } }, school: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: (page - 1) * limit }),
  ], { isolationLevel: "RepeatableRead" });
  res.setHeader("X-Total-Count", String(total));
  send(res, "ListPlatformAudit", rows.map(({ actor, school, ...row }) => ({ ...row, actorName: actor?.name ?? null, schoolName: school?.name ?? null })));
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