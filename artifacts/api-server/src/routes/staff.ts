import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { hashPassword } from "../lib/password";
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
    const user = await tx.user.create({ data: { ...data, passwordHash, schoolId: req.actor.school.id } });
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
    const user = await tx.user.update({ where: { id: userId }, data });
    await audit(tx, req.actor, "updated", "user", userId); return user;
  });
  send(res, "UpdateUser", user);
});
router.get("/audit-logs", async (req, res) => {
  allow(req, auditors);
  const { limit } = parse(z.ListAuditLogsQueryParams, req.query);
  send(res, "ListAuditLogs", (await db.auditLog.findMany({ where: { schoolId: req.actor.school.id }, include: logInclude, orderBy: { createdAt: "desc" }, take: limit ?? 50 })).map(logView));
});
export default router;