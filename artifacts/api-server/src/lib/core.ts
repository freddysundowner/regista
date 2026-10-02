import type { Request, Response, NextFunction } from "express";
import { db, Prisma, type User, type School } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import type { ZodTypeAny } from "zod";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Tx = Prisma.TransactionClient;
export type TenantAccess = { id: string; schoolId: string; reason: string; writeEnabled: boolean; expiresAt: Date };
export type Identity = { user: User; sessionId: string; grantId?: string; ip?: string; userAgent?: string };
export type Actor = { user: User; school: School; ip?: string; userAgent?: string; tenantAccess?: TenantAccess };
declare global {
  namespace Express { interface Request { actor: Actor; identity: Identity } }
}
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET must be configured");
const jwtSecret: string = secret;
const cookieName = "school_session";
export const admin = ["super_admin", "school_admin"];
export const writers = [...admin, "bursar"];
export const readers = [...writers, "principal"];
export const auditors = [...admin, "principal"];
export const streamAccess = (userId: string, schoolId: string): Prisma.StreamWhereInput => ({
  schoolId,
  OR: [
    { classTeacherUserId: userId },
    { assignments: { some: { userId, schoolId } } },
    { subjectAssignments: { some: { userId, schoolId } } },
  ],
});
export const teacher = (req: Request) => ["teacher", "class_teacher"].includes(req.actor.user.role);
export function allow(req: Request, roles: string[]) {
  if (!roles.includes(req.actor.user.role)) throw new ApiError(403, "You do not have permission for this action");
}
export function phone(value: string) {
  const clean = value.replace(/[\s()-]/g, "");
  const local = clean.replace(/^(?:\+254|254|0)/, "");
  if (!/^[71]\d{8}$/.test(local)) throw new ApiError(400, "Phone must be a valid Kenyan mobile number (07, 01, +254, 7 or 1)");
  return `254${local}`;
}
export function contacts<T extends { email?: string | null; phone?: string | null }>(data: T): T {
  return { ...data, ...(data.email !== undefined ? { email: data.email?.trim().toLowerCase() || null } : {}),
    ...(data.phone !== undefined ? { phone: data.phone ? phone(data.phone) : null } : {}) };
}
export function requireContact(data: { email?: string | null; phone?: string | null }) {
  if (!data.email && !data.phone) throw new ApiError(400, "Email or phone is required");
}
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): T["_output"] {
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError(400, result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}
export function send(res: Response, operation: string, data: unknown, status = 200) {
  const schema = (schemas as unknown as Record<string, ZodTypeAny>)[`${operation}Response`];
  if (!schema) throw new Error("Response schema missing");
  res.status(status).json(serialize(schema.parse(data)));
}
function serialize(value: any, key = ""): any {
  if (value instanceof Date) return ["startDate", "endDate", "dateOfBirth", "admissionDate", "subscriptionStartDate", "subscriptionEndDate"].includes(key) ? dateView(value) : value.toISOString();
  if (Array.isArray(value)) return value.map(v => serialize(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v, k)]));
  return value;
}
export function body<T extends ZodTypeAny>(schema: T, data: unknown): T["_output"] {
  const cleaned = cleanStrings(data);
  // Generated schemas coerce date strings; reject overflow dates before coercion.
  if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)) {
    for (const [key, value] of Object.entries(cleaned)) {
      if (["startDate", "endDate", "dueDate", "dateOfBirth", "admissionDate", "subscriptionStartDate", "subscriptionEndDate"].includes(key) && value !== null && value !== undefined && (typeof value !== "string" || !validDate(value))) {
        throw new ApiError(400, `${key} must be a real date (YYYY-MM-DD)`);
      }
    }
  }
  return parse(schema, cleaned);
}
export function session(req: Request, res: Response, user: User, binding?: { sessionId: string; grantId?: string }) {
  const token = jwt.sign({ version: user.sessionVersion, sid: binding?.sessionId ?? randomUUID(), grantId: binding?.grantId }, jwtSecret, { subject: user.id, expiresIn: "8h", issuer: "school-api", audience: "school-web" });
  res.cookie(cookieName, token, { httpOnly: true, secure: req.secure, sameSite: "lax", maxAge: 8 * 3600000, path: "/api" });
}
export function clearSession(req: Request, res: Response) {
  res.clearCookie(cookieName, { httpOnly: true, secure: req.secure, sameSite: "lax", path: "/api" });
}
export async function authenticateIdentity(req: Request, _res: Response, next: NextFunction) {
  try {
    let id: string;
    let version = 0;
    let sessionId = "";
    let grantId: string | undefined;
    try {
      const payload = jwt.verify(req.cookies?.[cookieName] || "", jwtSecret, { algorithms: ["HS256"], issuer: "school-api", audience: "school-web" });
      if (typeof payload === "string" || !payload.sub) throw new Error();
      id = payload.sub;
      version = typeof payload.version === "number" ? payload.version : 0;
      sessionId = typeof payload.sid === "string" ? payload.sid : "";
      grantId = typeof payload.grantId === "string" ? payload.grantId : undefined;
    } catch { throw new ApiError(401, "Not signed in"); }
    const user = await db.user.findUnique({ where: { id }, include: { school: true } });
    if (!user?.isActive || ![...readers, "teacher", "class_teacher"].includes(user.role) || user.sessionVersion !== version || !sessionId) throw new ApiError(401, "Account is inactive or session is invalid");
    req.identity = { user, sessionId, grantId, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 500) };
    next();
  } catch (e) { next(e); }
}
export async function resolveTenant(req: Request): Promise<Actor> {
  const identity = req.identity;
  let tenantAccess: TenantAccess | undefined;
  let schoolId = identity.user.schoolId;
  if (identity.user.role === "super_admin") {
    const grant = identity.grantId ? await db.platformTenantGrant.findUnique({ where: { id: identity.grantId } }) : null;
    if (!grant || grant.actorId !== identity.user.id || grant.sessionId !== identity.sessionId || grant.sessionVersion !== identity.user.sessionVersion || grant.revokedAt || grant.expiresAt <= new Date()) throw new ApiError(403, "An active tenant access grant is required");
    tenantAccess = grant;
    schoolId = grant.schoolId;
  }
  const school = schoolId ? await db.school.findUnique({ where: { id: schoolId } }) : null;
  if (!school || school.status !== "active") throw new ApiError(403, "School is suspended or unavailable");
  return { user: identity.user, school, ip: identity.ip, userAgent: identity.userAgent, tenantAccess };
}
export function safeTenantRequest(method: string, path: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method) || (method === "POST" && (
    ["/imports/students/preview"].includes(path) ||
    ["collections", "fee-items", "balances", "defaulters", "aged-arrears", "unmatched", "reconciliation", "adjustments", "sponsors", "plans", "statement", "performance", "attendance"].some(type => path === `/reports/${type}`)));
}
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  await authenticateIdentity(req, res, async error => {
    if (error) { next(error); return; }
    try {
      req.actor = await resolveTenant(req);
      if (req.actor.tenantAccess && !req.actor.tenantAccess.writeEnabled && !safeTenantRequest(req.method, req.path)) throw new ApiError(403, "This tenant access grant is read-only");
      next();
    } catch (e) { next(e); }
  });
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  const expected = `${req.protocol}://${req.get("host")}`;
  if (req.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) {
    next(new ApiError(403, "Cross-origin requests are not allowed")); return;
  }
  // Non-browser clients without Origin are supported; browsers send Origin on JSON mutations.
  const hasBody = Number(req.get("content-length") ?? 0) > 0 || !!req.get("transfer-encoding");
  if (hasBody && !req.is("application/json")) { next(new ApiError(415, "Use application/json")); return; }
  next();
}
export async function lock(tx: Tx, schoolId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId}, 0))`;
}
const snapshots = new WeakMap<object, Map<string, unknown>>();
const auditModels: Record<string, string> = { school: "school", user: "user", student: "student", guardian: "guardian", family: "family", stream: "stream", grade: "grade", academic_year: "academicYear", term: "term", student_guardian: "studentGuardian", teacher_assignment: "teacherAssignment" };
export function redactSnapshot(value: unknown): Prisma.InputJsonValue {
  const sensitive = /password|secret|token|credential|phone|email|idnumber|^name$|firstname|middlename|lastname|dateofbirth|address|upi|photourl|logourl|filename|objectkey/i;
  const walk = (v: any): any => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).map(([key, item]) => [key, sensitive.test(key) ? "[REDACTED]" : walk(item)]));
    return v;
  };
  return walk(value) as Prisma.InputJsonValue;
}
export async function audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId?: string, before?: unknown, after?: unknown) {
  const model = auditModels[entityType];
  const prior = before ?? (action !== "created" && model && entityId ? snapshots.get(tx)?.get(`${model}:${entityId}`) : undefined);
  const current = after ?? (model && entityId ? await (tx as any)[model].findFirst({ where: { id: entityId, ...(model === "school" ? {} : { schoolId: actor.school.id }) } }) : undefined);
  await tx.auditLog.create({ data: {
    schoolId: actor.school.id, userId: actor.user.id, action, entityType, entityId,
    before: prior == null ? Prisma.DbNull : redactSnapshot(prior),
    after: current == null ? Prisma.DbNull : redactSnapshot(current),
    ip: actor.ip ?? null, userAgent: actor.userAgent ?? null,
  } });
  if (actor.tenantAccess) await tx.platformAudit.create({ data: {
    actorId: actor.user.id, schoolId: actor.school.id, grantId: actor.tenantAccess.id,
    action: `tenant.${action}`, reason: actor.tenantAccess.reason, entityId,
    before: prior == null ? Prisma.DbNull : redactSnapshot(prior),
    after: current == null ? Prisma.DbNull : redactSnapshot(current),
    ip: actor.ip, userAgent: actor.userAgent,
  } });
}
export const logInclude = { user: true } as const;
export function logView(log: { user?: { name: string } | null; id: string; action: string; entityType: string; entityId: string | null; createdAt: Date }) {
  return { ...log, userName: log.user?.name ?? null };
}
export async function owned(tx: Tx, model: "student" | "guardian" | "user" | "grade" | "stream" | "academicYear" | "term", id: string, schoolId: string) {
  const record = await (tx[model] as unknown as { findFirst(a: unknown): Promise<any> }).findFirst({ where: { id, schoolId } });
  if (!record) throw new ApiError(404, "Record not found");
  if (tx !== db) {
    if (!snapshots.has(tx)) snapshots.set(tx, new Map());
    snapshots.get(tx)!.set(`${model}:${id}`, record);
  }
  return record;
}
export async function validateAsset(tx: Tx, schoolId: string, entityId: string, entityType: string, reference: string | null | undefined) {
  if (reference == null) return;
  const match = /^\/api\/storage\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(reference);
  if (!match || !await tx.storedFile.findFirst({ where: { id: match[1], schoolId, entityId, entityType, status: "ready" } })) {
    throw new ApiError(400, "Image must reference a completed upload for this school and record");
  }
}
export function dates<T extends Record<string, any>>(data: T): T {
  const result = { ...data };
  for (const field of ["startDate", "endDate", "dateOfBirth", "admissionDate"]) {
    if (typeof result[field] === "string") {
      if (!validDate(result[field])) throw new ApiError(400, `${field} must be a real date (YYYY-MM-DD)`);
      (result as Record<string, any>)[field] = new Date(`${result[field]}T00:00:00.000Z`);
    }
  }
  return result;
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const dateView = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;
export function cleanStrings<T>(value: T): T {
  if (typeof value === "string") return value.trim() as T;
  if (Array.isArray(value)) return value.map(cleanStrings) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /password|setupToken/i.test(k) ? v : cleanStrings(v)])) as T;
  return value;
}