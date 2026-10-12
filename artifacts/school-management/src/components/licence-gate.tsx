import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSchoolSubscription, useLogout, getGetSchoolSubscriptionQueryKey } from "@workspace/api-client-react";
import { CalendarClock, LockKeyhole, LogOut } from "lucide-react";
import { Btn, ErrorState, Panel, SkeletonRows } from "@/components/kit";
import { hardReset } from "@/components/platform-kit";
import { useAuthSession, errMsg, fmtDate, fmtDateTime } from "@/lib/session";
import { DAY_MS, nextBoundary } from "@/lib/licensing";
import { useInstallation } from "@/lib/installation";

const OPEN_PATHS = ["/subscription", "/licence", "/account"];

/** Blocks operational school UI when the school's timed licence does not allow access. Platform and support sessions bypass. */
export function LicenceAccessGate({ children }: { children: ReactNode }) {
  const s = useAuthSession();
  const staff = s.mode === "tenant" && s.user.role !== "super_admin" && !s.tenantAccess && !!s.school;
  const install = useInstallation();
  if (!staff) return <>{children}</>;
  if (install.standalone) return install.licensed ? <StandaloneGate>{children}</StandaloneGate> : <>{children}</>;
  return <StaffGate>{children}</StaffGate>;
}

/** Standalone servers are gated by the installed offline licence instead of a hosted subscription. */
function StandaloneGate({ children }: { children: ReactNode }) {
  const s = useAuthSession();
  const [loc] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout({ mutation: { onSuccess: () => hardReset(qc) } });
  const { licence } = useInstallation();
  const open = OPEN_PATHS.some((p) => loc === p || loc.startsWith(p + "/"));
  const isAdmin = s.user.role === "school_admin";
  if (open || licence?.status === "active") {
    const soon = licence?.status === "active" && licence.expiresAt && Date.parse(licence.expiresAt) - Date.now() < 30 * DAY_MS;
    return <>
      {soon && isAdmin && loc === "/" && <div data-testid="banner-licence-expiring" className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-amber-600/35 bg-amber-500/10 px-4 py-2.5 text-sm"><CalendarClock className="h-4 w-4" />Licence ends {fmtDateTime(licence!.expiresAt)}. Ask your Rejista provider for a renewal.<Link href="/licence" className="font-semibold text-primary hover:underline">Licence</Link></div>}
      {children}
    </>;
  }
  return (
    <div data-testid="licence-blocked" className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><LockKeyhole className="h-6 w-6" /></div>
      <h1 className="font-display text-2xl font-semibold">{licence?.status === "expired" ? "Licence expired" : "Licence needed"}</h1>
      <p className="text-sm text-muted-foreground">Records are kept safe. {isAdmin ? "Install a valid licence from your Rejista provider to continue." : "Ask your school administrator to install a valid licence."}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {isAdmin && <Link href="/licence" data-testid="link-gate-licence" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Install licence</Link>}
        <Btn variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut className="h-4 w-4" />Sign out</Btn>
      </div>
    </div>
  );
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
    // A reminder, not a blocker: it shows on Home only, so it doesn't sit on top of every page.
    const soon = sub?.accessAllowed && (sub.managed || sub.status === "trial") && sub.currentEndsAt && Date.parse(sub.currentEndsAt) - Date.now() < 14 * DAY_MS;
    return <>
      {soon && isAdmin && loc === "/" && <div data-testid="banner-licence-expiring" className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-amber-600/35 bg-amber-500/10 px-4 py-2.5 text-sm max-md:mb-3 max-md:flex-nowrap max-md:px-3 max-md:py-1.5 max-md:text-[13px]"><CalendarClock className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{sub!.status === "trial" ? "Free trial ends" : "Licence ends"} <span className="max-md:hidden">{fmtDateTime(sub!.currentEndsAt)}.</span><span className="md:hidden">{fmtDate(sub!.currentEndsAt)}</span></span><Link href="/subscription" className="font-semibold text-primary hover:underline max-md:ml-auto max-md:shrink-0">{sub!.status === "trial" ? "Subscribe" : "Renew"}</Link></div>}
      {children}
    </>;
  }
  const scheduled = sub.status === "scheduled" ? sub.licences.filter((l) => l.status === "scheduled").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] : undefined;
  return (
    <div data-testid="licence-blocked" className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><LockKeyhole className="h-6 w-6" /></div>
      <h1 className="font-display text-2xl font-semibold">{scheduled ? "Licence not started yet" : !sub.managed ? "Free trial ended" : "School licence expired"}</h1>
      <p className="text-sm text-muted-foreground">
        {scheduled ? `${s.school!.name}'s next licence starts ${fmtDateTime(scheduled.startsAt)}. Access opens then.` : `${s.school!.name}'s licence${sub.currentEndsAt ? ` ended ${fmtDateTime(sub.currentEndsAt)}` : " has ended"}. Records are kept safe.`}
        {" "}{isAdmin ? "Subscribe or enter a licence key to continue." : "Contact your school administrator to renew."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {isAdmin && <Link href="/subscription" data-testid="link-gate-subscription" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Renew licence</Link>}
        <Link href="/account" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold">My account</Link>
        <Btn variant="ghost" data-testid="button-gate-logout" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut className="h-4 w-4" />Sign out</Btn>
      </div>
    </div>
  );
}
