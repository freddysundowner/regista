import type { QueryClient } from "@tanstack/react-query";
import { getGetPlatformLicensingQueryKey, getGetSchoolSubscriptionQueryKey, getListLicencePlansQueryKey, getListPlatformAuditQueryKey, getGetPlatformSchoolQueryKey, getListPlatformSchoolsQueryKey, getGetPlatformOverviewQueryKey, type SchoolLicence } from "@workspace/api-client-react";

export const DAY_MS = 86_400_000;
export const LIC_TONE: Record<string, string> = { trial: "duplicate", active: "active", scheduled: "duplicate", expired: "inactive", revoked: "error", unmanaged: "inactive" };
export const ORDER_TONE: Record<string, string> = { pending: "inactive", partial: "duplicate", paid: "active", cancelled: "error" };
export const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Refresh every view that depends on licence state for a school. */
export function invalidateLicensing(qc: QueryClient, schoolId?: string) {
  if (schoolId) {
    qc.invalidateQueries({ queryKey: getGetPlatformLicensingQueryKey(schoolId) });
    qc.invalidateQueries({ queryKey: getGetPlatformSchoolQueryKey(schoolId) });
  } else {
    qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && q.queryKey[0].endsWith("/licensing") });
  }
  qc.invalidateQueries({ queryKey: getListLicencePlansQueryKey() });
  qc.invalidateQueries({ queryKey: getListPlatformSchoolsQueryKey() });
  qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey() });
  qc.invalidateQueries({ queryKey: getGetSchoolSubscriptionQueryKey() });
  qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey().slice(0, 1) });
}

/** Where a new grant without a custom start would begin: after the furthest live/scheduled licence, else now. */
export function defaultStart(licences: SchoolLicence[], now = Date.now()) {
  let t = now;
  for (const l of licences) if (l.status === "active" || l.status === "scheduled") t = Math.max(t, Date.parse(l.expiresAt));
  return t;
}

/** Next instant at which access may flip (expiry or a scheduled start). */
export function nextBoundary(licences: SchoolLicence[], currentEndsAt: string | null, now = Date.now()) {
  const pts = [currentEndsAt ? Date.parse(currentEndsAt) : NaN, ...licences.filter((l) => l.status !== "revoked").flatMap((l) => [Date.parse(l.startsAt), Date.parse(l.expiresAt)])];
  const f = pts.filter((p) => Number.isFinite(p) && p > now);
  return f.length ? Math.min(...f) : null;
}
