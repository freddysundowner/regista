import { actionLabel } from "@/lib/audit-format";
import { Link } from "wouter";
import { useGetPlatformOverview, useListPlatformSchools, useListPlatformAudit, getGetPlatformOverviewQueryKey, getListPlatformSchoolsQueryKey, getListPlatformAuditQueryKey } from "@workspace/api-client-react";
import { ArrowRight, Building2, ClipboardCheck, ScrollText } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Pill } from "@/components/kit";
import { useAuthSession, errMsg, fmtDate, fmtDateTime } from "@/lib/session";

export default function PlatformOverview() {
  const { user } = useAuthSession();
  const o = useGetPlatformOverview({ query: { queryKey: getGetPlatformOverviewQueryKey() } });
  const sq = useListPlatformSchools({ query: { queryKey: getListPlatformSchoolsQueryKey() } });
  const ap = { limit: 8 };
  const aq = useListPlatformAudit(ap, { query: { queryKey: getListPlatformAuditQueryKey(ap) } });
  const names = new Map((sq.data ?? []).map((s) => [s.id, s.name]));
  const attention = (sq.data ?? []).filter((s) => s.status === "suspended" || (s.licenceManaged && s.licenceStatus !== "active"));
  const pending = (sq.data ?? []).filter((s) => s.status === "pending").length;
  const stats = o.data ? [
    { k: "Schools", v: o.data.schools, d: "Provisioned registers" },
    { k: "Active", v: o.data.activeSchools, d: "Staff can sign in" },
    { k: "Suspended", v: o.data.suspendedSchools, d: "Sign-in blocked", warn: o.data.suspendedSchools > 0 },
    { k: "Active licences", v: o.data.activeSubscriptions, d: "Schools with current coverage" },
    { k: "School administrators", v: o.data.administrators, d: "Across all schools" },
  ] : [];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform console" title="Overview" meta={`Signed in as ${user.name}. You are outside every school; enter one only with a recorded reason.`} />
      {pending > 0 && <Link href="/schools?status=pending" data-testid="link-pending-registrations" className="rise flex items-center gap-2 rounded-md border border-amber-600/35 bg-amber-500/10 px-4 py-3 text-sm hover:bg-amber-500/15"><ClipboardCheck className="h-4 w-4 text-amber-700" /><span><span className="font-semibold">{pending} school registration{pending === 1 ? "" : "s"} pending review.</span> Review now</span><ArrowRight className="ml-auto h-4 w-4" /></Link>}
      {o.isLoading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}</div>
        : o.isError ? <Panel><ErrorState msg={errMsg(o.error)} onRetry={() => o.refetch()} /></Panel> : (
        <div className="rise-1 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-card-border bg-border lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.k} data-testid={`stat-${s.k.toLowerCase().replace(/\s+/g, "-")}`} className="min-w-0 bg-card px-3.5 py-3 md:px-5 md:py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{s.k}</div>
              <div className={`mt-1 font-display text-3xl font-semibold tabular-nums md:text-4xl ${s.warn ? "text-destructive" : ""}`}>{s.v}</div>
              <div className="text-xs text-muted-foreground">{s.d}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel className="min-w-0" title="Needs attention" note="Suspended schools or lapsed subscriptions." action={<Link href="/schools" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid="link-all-schools">All schools<ArrowRight className="h-3 w-3" /></Link>}>
          {sq.isLoading ? <SkeletonRows rows={3} cols={3} /> : sq.isError ? <ErrorState msg={errMsg(sq.error)} onRetry={() => sq.refetch()} /> : !attention.length ? (
            <Empty icon={<Building2 className="h-5 w-5" />} title="All clear" body="No suspended schools or lapsed subscriptions." />
          ) : (
            <ul className="divide-y divide-border/60">{attention.map((s) => (
              <li key={s.id}><Link href={`/schools/${s.id}`} data-testid={`link-attention-${s.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-accent/30">
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{s.name}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{s.code} · {s.licenceStatus ?? "unmanaged"}</span></span>
                {s.status === "suspended" && <Pill tone="error">suspended</Pill>}
                {s.licenceManaged && s.licenceStatus !== "active" && <Pill tone="duplicate">{s.licenceStatus}</Pill>}
              </Link></li>
            ))}</ul>
          )}
        </Panel>
        <Panel className="min-w-0" title="Latest platform actions" action={<Link href="/platform/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid="link-platform-audit">Audit log<ArrowRight className="h-3 w-3" /></Link>}>
          {aq.isLoading ? <SkeletonRows rows={4} cols={3} /> : aq.isError ? <ErrorState msg={errMsg(aq.error)} onRetry={() => aq.refetch()} /> : !aq.data?.length ? (
            <Empty icon={<ScrollText className="h-5 w-5" />} title="Nothing recorded yet" body="Every platform action is logged here with its reason." />
          ) : (
            <ul className="divide-y divide-border/60">{aq.data.map((e) => (
              <li key={e.id} className="px-5 py-2.5 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-semibold">{actionLabel(e)}</span><span className="font-mono text-[11px] text-muted-foreground">{fmtDateTime(e.createdAt)}</span></div>
                <p className="text-xs text-muted-foreground">By {e.actorName ?? "name unavailable"} · {e.schoolName ?? (e.schoolId ? names.get(e.schoolId) ?? "School" : "Platform")}</p>
                <p className="break-words text-xs text-muted-foreground">{e.reason}</p>
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
