import type { Request } from "express";
import { ApiError, type Actor } from "./core";

type User = { role: string; permissions: string[] };

/**
 * Staff access beyond the fixed roles. A role brings its usual access; a school admin can add
 * any of these to one person, e.g. a teacher who also runs the library or a bursar who keeps the store.
 */
export const STAFF_PERMISSIONS = ["expenses", "procurement", "approve_lpo", "store", "library"] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

const ROLE_ACCESS: Record<string, readonly StaffPermission[]> = {
  super_admin: STAFF_PERMISSIONS,
  school_admin: STAFF_PERMISSIONS,
  principal: ["approve_lpo"],
  bursar: ["expenses", "procurement"],
  storekeeper: ["store"],
  librarian: ["library"],
  teacher: [],
  class_teacher: [],
};

/** Roles that only work in the store or library; everything else in the school is closed to them. */
export const RESTRICTED_ROLES = ["storekeeper", "librarian"];

export function access(user: Pick<User, "role" | "permissions">): Set<StaffPermission> {
  const extra = (user.permissions ?? []).filter((p): p is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(p));
  return new Set([...(ROLE_ACCESS[user.role] ?? []), ...extra]);
}
export const can = (actor: Actor, permission: StaffPermission) => access(actor.user).has(permission);
export function need(req: Request, ...any: StaffPermission[]) {
  if (!any.some(p => can(req.actor, p))) throw new ApiError(403, "You do not have permission for this action");
}

/** Only real permissions, each once; role defaults are left out since the role already gives them. */
export function cleanPermissions(role: string, list: readonly string[] | undefined) {
  const own = new Set(ROLE_ACCESS[role] ?? []);
  return [...new Set(list ?? [])].filter((p): p is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(p) && !own.has(p as StaffPermission));
}

// Paths open to the store and library roles. Other work they have been given access to opens its own paths.
const BASE: RegExp[] = [/^\/auth\//, /^\/school$/, /^\/dashboard\/summary$/, /^\/terms$/, /^\/academic-years$/, /^\/school\/subscription$/, /^\/storage\//];
const AREA: Record<StaffPermission, RegExp[]> = {
  store: [/^\/store\//],
  library: [/^\/library\//],
  procurement: [/^\/procurement\//, /^\/store\/items$/],
  approve_lpo: [/^\/procurement\/(orders|suppliers)/],
  expenses: [/^\/finance\/expenses/, /^\/procurement\/(suppliers|invoices)/],
};
export function restrictedPathAllowed(user: Pick<User, "role" | "permissions">, method: string, path: string) {
  if (!RESTRICTED_ROLES.includes(user.role)) return true;
  if (BASE.some(r => r.test(path))) return method === "GET" || /^\/(auth|storage)\//.test(path);
  return [...access(user)].some(p => AREA[p].some(r => r.test(path)));
}

export const ROLE_NAMES: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", bursar: "Bursar", teacher: "Teacher", class_teacher: "Class teacher", storekeeper: "Storekeeper", librarian: "Librarian",
};
