import { Link } from "wouter";
import { useGetModuleDashboard, getGetModuleDashboardQueryKey } from "@workspace/api-client-react";
import { Panel, ErrorState, Pill } from "@/components/kit";
import { Money } from "@/components/finance-kit";
import { errMsg, fmtDateTime } from "@/lib/session";

function Stat({ k, v, sub, href }: { k: string; v: React.ReactNode; sub?: string; href?: string }) {
  const body = <><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:text-[11px]">{k}</div><div className="mt-1 font-display text-xl font-semibold tabular-nums [overflow-wrap:anywhere] md:text-2xl">{v}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</>;
  return href ? <Link href={href} className="block border-b border-r border-border/60 min-w-0 px-3.5 py-3 active:bg-muted/60 hover:bg-muted/40 md:px-5 md:py-4">{body}</Link> : <div className="min-w-0 border-b border-r border-border/60 px-3.5 py-3 md:px-5 md:py-4">{body}</div>;
}

export function ModuleDashboard() {
  const q = useGetModuleDashboard({ query: { queryKey: getGetModuleDashboardQueryKey() } });
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (q.isError) return <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel>;
  const d = q.data; if (!d) return null;
  const f = d.finance; const att = (s: string) => d.attendance.find((a) => a.status === s)?.count ?? 0;
  const marked = d.attendance.reduce((n, a) => n + a.count, 0);
  return (
    <div className={`grid gap-6 ${f ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}>
      {f && <Panel title="Collections" note={`As of ${d.date}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3">
          <Stat k="Collected today" v={<Money v={f.todayCollected ?? "0"} />} sub={Object.entries(f.channels ?? {}).map(([c, v]) => `${c} ${v}`).join(" · ") || undefined} href="/payments" />
          <Stat k="Term billed" v={<Money v={f.termBilled ?? "0"} />} href="/invoices" />
          <Stat k="Term collected" v={<Money v={f.termCollected ?? "0"} />} />
          <Stat k="Unmatched" v={f.unmatchedCount ?? 0} sub="payments to resolve" href="/payments?show=unmatched" />
          <Stat k="Defaulters" v={f.defaulterCount ?? 0} href="/reports" />
          <Stat k="Last reconciliation" v={f.reconciliation ? <Pill tone={f.reconciliation.status === "completed" ? "active" : "current"}>{f.reconciliation.status}</Pill> : "\u2014"} sub={f.reconciliation ? `${f.reconciliation.provider ?? ""} ${fmtDateTime(f.reconciliation.createdAt)}` : "None run"} href="/payments?show=unmatched" />
        </div>
      </Panel>}
      <Panel title="Academics" note={d.termId ? "Current term" : "No current term"}>
        <div className="grid grid-cols-2">
          <Stat k="Assessments" v={d.academics.assessments} sub={`${d.academics.locked} locked`} href="/assessments" />
          <Stat k="Results entered" v={d.academics.results} />
          <Stat k="Report cards published" v={d.academics.publishedReportCards} href="/report-cards" />
          <Stat k="Attendance today" v={marked ? `${att("present") + att("late")}/${marked}` : "Not taken"} sub={marked ? `${att("absent")} absent · ${att("late")} late` : undefined} href="/attendance" />
        </div>
      </Panel>
    </div>
  );
}
