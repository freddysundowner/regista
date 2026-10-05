import { Link } from "wouter";
import { useGetFinanceOverview, getGetFinanceOverviewQueryKey } from "@workspace/api-client-react";
import { ArrowUpRight } from "lucide-react";
import { Panel, ErrorState } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { kes } from "@/lib/finance";

export function FinanceOverviewPanel() {
  const q = useGetFinanceOverview({ query: { queryKey: getGetFinanceOverviewQueryKey() } });
  const d = q.data;
  const cells = d ? [
    { k: "Invoiced", v: kes(d.invoiced) }, { k: "Collected", v: kes(d.collected) },
    { k: "Outstanding", v: kes(d.outstanding), warn: true }, { k: "Credit held", v: kes(d.credit) },
  ] : [];
  return (
    <Panel title="Fees at a glance" note="From posted ledger entries only" className="rise-1" action={<Link href="/approvals" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">{d ? `${d.pendingApprovals} pending approval${d.pendingApprovals === 1 ? "" : "s"}` : "Approvals"} <ArrowUpRight className="h-3 w-3" /></Link>}>
      {q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {(q.isLoading ? Array.from({ length: 4 }, () => null) : cells).map((c, i) => (
            <div key={i} className="min-w-0 border-r border-t border-border/60 px-3.5 py-3 last:border-r-0 md:px-5 md:py-4">
              {c ? <><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{c.k}</div><div data-testid={`stat-finance-${i}`} className={`mt-1 font-mono text-lg font-semibold tabular-nums ${"warn" in c && c.warn ? "text-amber-800" : ""}`}>{c.v}</div></>
                : <div className="space-y-2"><div className="h-3 w-16 animate-pulse rounded bg-muted" /><div className="h-6 w-28 animate-pulse rounded bg-muted" /></div>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
