import { createContext, useContext, type ReactNode } from "react";
import type { AuthSession, School, StaffPermission, UserRole } from "@workspace/api-client-react";

const Ctx = createContext<AuthSession | null>(null);

export function SessionProvider({ session, children }: { session: AuthSession; children: ReactNode }) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

/** Raw session: school may be null (platform mode). Use in platform pages, shell and account. */
export function useAuthSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("No session");
  return s;
}

export type TenantSession = AuthSession & { school: School };

/** Tenant workspace session. Tenant routes only render when mode is tenant and a school is bound. */
export function useSession(): TenantSession {
  const s = useAuthSession();
  if (!s.school) throw new Error("This page needs a school workspace. Return to the platform console.");
  return s as TenantSession;
}

/** True when a platform owner is inside a school with a read-only support grant. */
export function useReadOnly() {
  const s = useAuthSession();
  return s.mode === "tenant" && !!s.tenantAccess && !s.tenantAccess.writeEnabled;
}

const ADMIN: UserRole[] = ["super_admin", "school_admin"];

/** Extra access a role brings by default; a school admin can add any of these to one person. */
export const ROLE_ACCESS: Record<UserRole, StaffPermission[]> = {
  super_admin: ["expenses", "procurement", "approve_lpo", "store", "library"],
  school_admin: ["expenses", "procurement", "approve_lpo", "store", "library"],
  principal: ["approve_lpo"],
  bursar: ["expenses", "procurement"],
  storekeeper: ["store"],
  librarian: ["library"],
  teacher: [],
  class_teacher: [],
};
export const ACCESS_LABEL: Record<StaffPermission, { label: string; hint: string }> = {
  expenses: { label: "Record expenses", hint: "Record and void expenses, and pay supplier invoices" },
  procurement: { label: "Raise LPOs", hint: "Add suppliers, raise LPOs, record deliveries and supplier invoices" },
  approve_lpo: { label: "Approve LPOs", hint: "Approve or reject LPOs someone else raised" },
  store: { label: "Run the store", hint: "Add store items, receive and issue stock, count stock" },
  library: { label: "Run the library", hint: "Catalogue books, lend and receive them back" },
};

export function permissions(role: UserRole, grants: readonly StaffPermission[] = []) {
  const admin = ADMIN.includes(role);
  const has = new Set<StaffPermission>([...ROLE_ACCESS[role], ...grants]);
  return {
    /** Works with learners at all; storekeepers and librarians don't (the library finds borrowers itself). */
    register: role !== "storekeeper" && role !== "librarian",
    expenses: has.has("expenses"),
    procurement: has.has("procurement"),
    approveLpo: has.has("approve_lpo"),
    store: has.has("store"),
    library: has.has("library"),
    /** Can see purchasing (LPOs, suppliers, supplier invoices). */
    purchasing: has.has("procurement") || has.has("approve_lpo") || has.has("expenses") || admin || role === "principal" || role === "bursar",
    manageSchool: admin,
    writeStudents: admin || role === "bursar",
    viewGuardians: admin || role === "bursar" || role === "principal",
    importStudents: admin || role === "bursar",
    viewAudit: admin || role === "principal",
    platform: role === "super_admin",
    manageGuardianPrivacy: admin,
    financeRead: admin || role === "bursar" || role === "principal",
    financeConfigure: admin || role === "bursar",
    bursar: role === "bursar",
    financeDecide: admin || role === "principal",
    financeJobs: admin,
    limitedToAssigned: role === "teacher" || role === "class_teacher",
    integrations: admin,
    notify: admin,
    collect: admin || role === "bursar",
    planDecide: admin || role === "principal",
    academicAdmin: admin,
    academicRead: admin || role === "principal" || role === "teacher" || role === "class_teacher",
    headRemarks: admin || role === "principal",
    reports: admin || role === "bursar" || role === "principal" || role === "teacher" || role === "class_teacher",
  };
}

export function usePerms() {
  const { user } = useAuthSession();
  return permissions(user.role, user.permissions ?? []);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Platform owner",
  school_admin: "School admin",
  principal: "Principal",
  bursar: "Bursar",
  teacher: "Teacher",
  class_teacher: "Class teacher",
  storekeeper: "Storekeeper",
  librarian: "Librarian",
};

export function errMsg(e: unknown, fallback = "Something went wrong") {
  const anyE = e as { data?: { error?: string } | null; message?: string } | null;
  return anyE?.data?.error || anyE?.message || fallback;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export { fmtDate, fmtDateTime, fmtTime, localDay, localToday, localDateKey, localInputToUtc, viewerTimezone } from "./datetime";

export function blank(v: string) {
  const t = v.trim();
  return t === "" ? null : t;
}
