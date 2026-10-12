import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword } from "../lib/password";
import { cleanPermissions } from "../lib/access";
import { admin, readers, auditors, allow, send, body, parse, contacts, requireContact, audit, owned, lock, ApiError, logInclude, logView, validateAsset } from "../lib/core";
const router = Router();
router.get("/school", (req, res) => { send(res, "GetSchool", req.actor.school); });
router.patch("/school", async (req, res) => {
  allow(req, admin);
  const data = contacts(body(z.UpdateSchoolBody, req.body));
  if (req.body.settings && Object.keys(req.body.settings).some(key => !Object.keys(data.settings ?? {}).includes(key))) throw new ApiError(400, "Unknown school settings are not allowed");
  const school = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const before = await tx.school.findUniqueOrThrow({ where: { id: req.actor.school.id } });
    await validateAsset(tx, req.actor.school.id, req.actor.school.id, "school_logo", data.logoUrl);
    const record = await tx.school.update({ where: { id: req.actor.school.id }, data: { ...data, ...(data.settings ? { settings: JSON.parse(JSON.stringify(data.settings)) } : {}) } });
    await audit(tx, req.actor, "updated", "school", record.id, before, record); return record;
  });
  send(res, "UpdateSchool", school);
});
router.get("/users", async (req, res) => {
  allow(req, readers);
  send(res, "ListUsers", await db.user.findMany({ where: { schoolId: req.actor.school.id }, orderBy: { name: "asc" }, take: 1000 }));
});
router.post("/users", async (req, res) => {
  allow(req, admin);
  const { password, ...data } = contacts(body(z.CreateUserBody, req.body));
  requireContact(data);
  if (data.role === "super_admin") throw new ApiError(403, "Creating super administrator accounts is not allowed");
  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async tx => {
    const user = await tx.user.create({ data: { ...data, permissions: cleanPermissions(data.role, data.permissions), passwordHash, schoolId: req.actor.school.id } });
    await audit(tx, req.actor, "created", "user", user.id); return user;
  });
  send(res, "CreateUser", user, 201);
});
router.patch("/users/:userId", async (req, res) => {
  allow(req, admin);
  const { userId } = parse(z.UpdateUserParams, req.params);
  const data = contacts(body(z.UpdateUserBody, req.body));
  if (data.role === "super_admin") throw new ApiError(403, "Assigning super administrator is not allowed");
  const user = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const old = await owned(tx, "user", userId, req.actor.school.id);
    requireContact({ ...old, ...data });
    if (old.role === "super_admin") throw new ApiError(403, "The bootstrap super administrator cannot be demoted or deactivated");
    if (old.role === "school_admin" && old.isActive && (data.isActive === false || (data.role && data.role !== "school_admin"))) {
      if (await tx.user.count({ where: { schoolId: req.actor.school.id, role: "school_admin", isActive: true } }) <= 1) {
        throw new ApiError(409, "The last active school administrator cannot be deactivated or demoted");
      }
    }
    // Extra access is kept clean: only real permissions the (new) role doesn't already give.
    const permissions = data.permissions !== undefined || data.role !== undefined ? cleanPermissions(data.role ?? old.role, data.permissions ?? old.permissions) : undefined;
    const user = await tx.user.update({ where: { id: userId }, data: { ...data, ...(permissions ? { permissions } : {}), ...((data.role !== undefined && data.role !== old.role) || (data.isActive !== undefined && data.isActive !== old.isActive) ? { sessionVersion: { increment: 1 } } : {}) } });
    await audit(tx, req.actor, "updated", "user", userId, { role: old.role, permissions: old.permissions, isActive: old.isActive }, { role: user.role, permissions: user.permissions, isActive: user.isActive }); return user;
  });
  send(res, "UpdateUser", user);
});
// A staff member who forgot their password asks an administrator; nobody can reset their own this way.
router.post("/users/:userId/reset-password", async (req, res) => {
  allow(req, admin);
  const { userId } = parse(z.ResetStaffPasswordParams, req.params);
  const { password } = body(z.ResetStaffPasswordBody.strict(), req.body);
  if (userId === req.actor.user.id) throw new ApiError(400, "Change your own password from your account page");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const old = await owned(tx, "user", userId, req.actor.school.id);
    if (old.role === "super_admin") throw new ApiError(403, "The platform owner's password cannot be reset here");
    await tx.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await audit(tx, req.actor, "password_reset", "user", userId, { sessionVersion: old.sessionVersion }, { sessionVersion: old.sessionVersion + 1 });
  });
  send(res, "ResetStaffPassword", { message: "Password reset. They have been signed out and can sign in with the new password." });
});
router.get("/audit-logs", async (req, res) => {
  allow(req, auditors);
  const { limit, page, search, entityType } = parse(z.ListAuditLogsQueryParams, req.query);
  const take = limit ?? 50;
  // Every word must appear in the action, the record type or the person's name.
  const words = (search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where = { schoolId: req.actor.school.id, ...(entityType ? { entityType } : {}),
    ...(words.length ? { AND: words.map(w => ({ OR: [{ action: { contains: w, mode: "insensitive" as const } }, { entityType: { contains: w, mode: "insensitive" as const } }, { user: { name: { contains: w, mode: "insensitive" as const } } }] })) } : {}) };
  send(res, "ListAuditLogs", (await db.auditLog.findMany({ where, include: logInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: ((page ?? 1) - 1) * take, take })).map(logView));
});
export default router;