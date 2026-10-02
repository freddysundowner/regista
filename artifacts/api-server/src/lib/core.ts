import type { Request, Response, NextFunction } from "express";
import { db, Prisma, type User, type School } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import type { ZodTypeAny } from "zod";
import jwt from "jsonwebtoken";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Tx = Prisma.TransactionClient;
export type Actor = { user: User; school: School };
declare global {
  namespace Express { interface Request { actor: Actor } }
}
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET must be configured");
const jwtSecret: string = secret;
const cookieName = "school_session";
export const admin = ["super_admin", "school_admin"];
export const writers = [...admin, "bursar"];
export const readers = [...writers, "principal"];
export const teacher = (req: Request) => ["teacher", "class_teacher"].includes(req.actor.user.role);
export function allow(req: Request, roles: string[]) {
  if (!roles.includes(req.actor.user.role)) throw new ApiError(403, "You do not have permission for this action");
}
export function phone(value: string) {
  const clean = value.replace(/[\s()-]/g, "");
  const local = clean.replace(/^(?:\+254|254|0)/, "");
  if (!/^[71]\d{8}$/.test(local)) throw new ApiError(400, "Phone must be a valid Kenyan mobile number (07, 01, +254, 7 or 1)");
  return `+254${local}`;
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
  if (value instanceof Date) return ["startDate", "endDate", "dateOfBirth", "admissionDate"].includes(key) ? dateView(value) : value.toISOString();
  if (Array.isArray(value)) return value.map(v => serialize(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v, k)]));
  return value;
}
export function body<T extends ZodTypeAny>(schema: T, data: unknown): T["_output"] {
  const cleaned = cleanStrings(data);
  // Generated schemas coerce date strings; reject overflow dates before coercion.
  if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)) {
    for (const [key, value] of Object.entries(cleaned)) {
      if (["startDate", "endDate", "dateOfBirth", "admissionDate"].includes(key) && value !== null && value !== undefined && (typeof value !== "string" || !validDate(value))) {
        throw new ApiError(400, `${key} must be a real date (YYYY-MM-DD)`);
      }
    }
  }
  return parse(schema, cleaned);
}
export function session(req: Request, res: Response, user: User) {
  const token = jwt.sign({}, jwtSecret, { subject: user.id, expiresIn: "8h", issuer: "school-api", audience: "school-web" });
  res.cookie(cookieName, token, { httpOnly: true, secure: req.secure, sameSite: "lax", maxAge: 8 * 3600000, path: "/api" });
}
export function clearSession(req: Request, res: Response) {
  res.clearCookie(cookieName, { httpOnly: true, secure: req.secure, sameSite: "lax", path: "/api" });
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    let id: string;
    try {
      const payload = jwt.verify(req.cookies?.[cookieName] || "", jwtSecret, { algorithms: ["HS256"], issuer: "school-api", audience: "school-web" });
      if (typeof payload === "string" || !payload.sub) throw new Error();
      id = payload.sub;
    } catch { throw new ApiError(401, "Not signed in"); }
    const user = await db.user.findUnique({ where: { id }, include: { school: true } });
    if (!user?.isActive || user.school.status !== "active") throw new ApiError(401, "Account is inactive or session is invalid");
    req.actor = { user, school: user.school };
    next();
  } catch (e) { next(e); }
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
export async function audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId?: string) {
  await tx.auditLog.create({ data: { schoolId: actor.school.id, userId: actor.user.id, action, entityType, entityId } });
}
export const logInclude = { user: true } as const;
export function logView(log: { user?: { name: string } | null; id: string; action: string; entityType: string; entityId: string | null; createdAt: Date }) {
  return { ...log, userName: log.user?.name ?? null };
}
export async function owned(tx: Tx, model: "student" | "guardian" | "user" | "grade" | "stream" | "academicYear" | "term", id: string, schoolId: string) {
  const record = await (tx[model] as unknown as { findFirst(a: unknown): Promise<any> }).findFirst({ where: { id, schoolId } });
  if (!record) throw new ApiError(404, "Record not found");
  return record;
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
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "password" ? v : cleanStrings(v)])) as T;
  return value;
}