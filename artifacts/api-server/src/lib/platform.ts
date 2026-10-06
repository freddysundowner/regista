import type { Request } from "express";
import { db, Prisma } from "@workspace/db";
import { ApiError, redactSnapshot, resolveTenant, type Identity, type Tx } from "./core";

export function requirePlatform(req: Request) {
  if (req.identity.user.role !== "super_admin") throw new ApiError(403, "Platform owner access required");
}
export async function platformAudit(tx: Tx, identity: Identity, action: string, reason: string, schoolId?: string | null, entityId?: string, before?: unknown, after?: unknown, grantId?: string) {
  await tx.platformAudit.create({ data: {
    actorId: identity.user.id, schoolId, grantId: grantId ?? identity.grantId, action, reason, entityId,
    before: before == null ? Prisma.DbNull : redactSnapshot(before),
    after: after == null ? Prisma.DbNull : redactSnapshot(after),
    ip: identity.ip, userAgent: identity.userAgent,
  } });
}
export async function authView(req: Request) {
  if (req.identity.user.role === "super_admin" && !req.identity.grantId) {
    return { user: req.identity.user, school: null, mode: "platform", tenantAccess: null };
  }
  if (req.identity.user.role !== "super_admin" && req.identity.user.schoolId) {
    const school = await db.school.findUnique({ where: { id: req.identity.user.schoolId } });
    if (school && ["pending", "rejected"].includes(school.status)) {
      return { user: req.identity.user, school, mode: "registration", tenantAccess: null };
    }
  }
  const actor = await resolveTenant(req);
  return { user: actor.user, school: actor.school, mode: "tenant", tenantAccess: actor.tenantAccess ?? null };
}