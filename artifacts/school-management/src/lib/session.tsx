import { createContext, useContext, type ReactNode } from "react";
import type { AuthSession, School, UserRole } from "@workspace/api-client-react";

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

export function permissions(role: UserRole) {
  const admin = ADMIN.includes(role);
  return {
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
  return permissions(useAuthSession().user.role);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Platform owner",
  school_admin: "School admin",
  principal: "Principal",
  bursar: "Bursar",
  teacher: "Teacher",
  class_teacher: "Class teacher",
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
