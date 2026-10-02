import { createContext, useContext, type ReactNode } from "react";
import type { AuthSession, UserRole } from "@workspace/api-client-react";

const Ctx = createContext<AuthSession | null>(null);

export function SessionProvider({ session, children }: { session: AuthSession; children: ReactNode }) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("No session");
  return s;
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
  return permissions(useSession().user.role);
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

export const TZ = "Africa/Nairobi";

export function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00+03:00` : d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** Calendar-day label in Nairobi time, used for grouping. */
export function nairobiDay(d: string) {
  return new Date(d).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
}

/** Today's date (YYYY-MM-DD) in Nairobi. */
export function nairobiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function blank(v: string) {
  const t = v.trim();
  return t === "" ? null : t;
}
