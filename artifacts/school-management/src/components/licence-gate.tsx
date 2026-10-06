import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSchoolSubscription, useLogout, getGetSchoolSubscriptionQueryKey } from "@workspace/api-client-react";
import { CalendarClock, LockKeyhole, LogOut } from "lucide-react";
import { Btn, ErrorState, Panel, SkeletonRows } from "@/components/kit";
import { hardReset } from "@/components/platform-kit";
import { useAuthSession, errMsg, fmtDateTime } from "@/lib/session";
import { DAY_MS, nextBoundary } from "@/lib/licensing";

const OPEN_PATHS = ["/subscription", "/account"];

/** Blocks operational school UI when the school's timed licence does not allow access. Platform and support sessions bypass. */
export function LicenceAccessGate({ children }: { children: ReactNode }) {
  const s = useAuthSession();
  const staff = s.mode === "tenant" && s.user.role !== "super_admin" && !s.tenantAccess && !!s.school;
  if (!staff) return <>{children}</>;
  return <StaffGate>{children}</StaffGate>;
}

function StaffGate({ children }: { children: ReactNode }) {
  const s = useAuthSession();
  const [loc] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout({ mutation: { onSuccess: () => hardReset(qc) } });
  const q = useGetSchoolSubscription({ query: { queryKey: getGetSchoolSubscriptionQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true, refetchIntervalInBackground: false } });
  const sub = q.data;
  const boundary = sub ? nextBoundary(sub.licences, sub.currentEndsAt) : null;
  useEffect(() => {
    if (!boundary) return;
    const ms = boundary - Date.now() + 1000;
    if (ms > 2 ** 31 - 1) return;
    const t = window.setTimeout(() => { qc.invalidateQueries({ queryKey: getGetSchoolSubscriptionQueryKey() }); }, Math.max(ms, 1000));
    return () => window.clearTimeout(t);
  }, [boundary, qc]);

  const open = OPEN_PATHS.some((p) => loc === p || loc.startsWith(p + "/"));
  const isAdmin = s.user.role === "school_admin";

  if (q.isLoading && !open) return <Panel><SkeletonRows rows={4} cols={3} /></Panel>;
  if ((q.isError || !sub) && !open) return <ErrorState msg={`${errMsg(q.error, "Could not confirm your school's licence.")} Retry, or sign out.`} onRetry={() => q.refetch()} />;
  if (!sub || sub.accessAllowed || open) {
    const soon = sub?.accessAllowed && sub.managed && sub.currentEndsAt && Date.parse(sub.currentEndsAt) - Date.now() < 14 * DAY_MS;
    return <>
      {soon && isAdmin && !open && <div data-testid="banner-licence-expiring" className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-amber-600/35 bg-amber-500/10 px-4 py-2.5 text-sm"><CalendarClock className="h-4 w-4" />Licence ends {fmtDateTime(sub!.currentEndsAt)}.<Link href="/subscription" className="font-semibold text-primary hover:underline">Renew</Link></div>}
      {children}
    </>;
  }
  const scheduled = sub.status === "scheduled" ? sub.licences.filter((l) => l.status === "scheduled").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] : undefined;
  return (
    <div data-testid="licence-blocked" className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><LockKeyhole className="h-6 w-6" /></div>
      <h1 className="font-display text-2xl font-semibold">{scheduled ? "Licence not started yet" : "School licence expired"}</h1>
      <p className="text-sm text-muted-foreground">
        {scheduled ? `${s.school!.name}'s next licence starts ${fmtDateTime(scheduled.startsAt)}. Access opens then.` : `${s.school!.name}'s licence${sub.currentEndsAt ? ` ended ${fmtDateTime(sub.currentEndsAt)}` : " has ended"}. Records are kept safe.`}
        {" "}{isAdmin ? "Request a renewal invoice; access returns once payment is recorded." : "Contact your school administrator to renew."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {isAdmin && <Link href="/subscription" data-testid="link-gate-subscription" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Renew licence</Link>}
        <Link href="/account" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold">My account</Link>
        <Btn variant="ghost" data-testid="button-gate-logout" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut className="h-4 w-4" />Sign out</Btn>
      </div>
    </div>
  );
}
