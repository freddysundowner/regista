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
    limitedToAssigned: role === "teacher" || role === "class_teacher",
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

export function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function blank(v: string) {
  const t = v.trim();
  return t === "" ? null : t;
}
