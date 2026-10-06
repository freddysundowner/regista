import { useQueryClient } from "@tanstack/react-query";
import { useListFailedFinanceJobs, useListFailedJobs, useRetryFailedJob, getListFailedFinanceJobsQueryKey, getListFailedJobsQueryKey } from "@workspace/api-client-react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill } from "@/components/kit";
import { Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime } from "@/lib/session";
import { str } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { readable } from "@/lib/audit-format";

const JOB_LABEL: Record<string, string> = { "finance-nightly": "Nightly balances & recurring", "finance-receipts": "Receipt generation" };

function Retry({ id }: { id?: string }) {
  const m = useRetryFailedJob(); const qc = useQueryClient(); const { toast } = useToast();
  if (!id) return null;
  return <Btn variant="outline" className="h-7 px-2 text-xs" data-testid={`button-retry-${id}`} disabled={m.isPending} onClick={() => m.mutate({ id }, {
    onSuccess: (r) => { [getListFailedJobsQueryKey(), getListFailedFinanceJobsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k })); toast({ title: "Retry queued", description: r.message ?? "It will run shortly. Check back for the result." }); },
    onError: (x) => toast({ title: "Retry refused", description: errMsg(x), variant: "destructive" }) })}>{m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Retry</Btn>;
}

export default function Jobs() {
  const p = usePerms();
  const q = useListFailedJobs({ query: { queryKey: getListFailedJobsQueryKey() } });
  const fin = useListFailedFinanceJobs({ query: { queryKey: getListFailedFinanceJobsQueryKey() } });
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Monitoring" title="Finance jobs" meta="Background work that did not finish. Postings are never undone by a failure; retrying re-runs only the job.">
        <Btn variant="outline" data-testid="button-refresh-jobs" onClick={() => { q.refetch(); fin.refetch(); }} disabled={q.isFetching}>Refresh</Btn>
      </PageHeader>
      <Panel title="Messages" note="Retrying re-sends through the same outbox; it cannot send twice. Expired one-time codes need a fresh code, not a retry.">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !d?.messages.length ? <Empty icon={<CheckCircle2 className="h-5 w-5" />} title="No failed messages" body="Every queued message was handed to its provider." /> : (
          <Table head={["Template", "Status", "Attempts", "Error", ""]}>{d.messages.map((m, i) => (
            <tr key={m.id ?? i}><td className={td}>{m.template?.replace(/_/g, " ")}</td><td className={td}><Pill tone="error">{m.status}</Pill></td><td className={td}>{m.attempts}</td><td className={`${td} text-xs text-destructive`}>{m.error}</td><td className={td}><Retry id={m.id} /></td></tr>))}</Table>
        )}
      </Panel>
      {(p.platform || !!d?.jobs.length) && <Panel title="Scheduler jobs" note={p.platform ? "Global jobs; platform administrators only." : undefined}>
        {!d?.jobs.length ? <p className="p-5 text-sm text-muted-foreground">No failed scheduler jobs.</p> : (
          <Table head={["Job", "State", "Retries", "Failed at", ""]}>{d.jobs.map((j, i) => (
            <tr key={j.id ?? i}><td className={`${td} font-semibold`}>{JOB_LABEL[j.name ?? ""] ?? j.name}</td><td className={td}><Pill tone="error">{j.state}</Pill></td><td className={td}>{j.retryCount}</td><td className={`${td} text-xs`}>{fmtDateTime(j.completedAt)}</td><td className={td}>{p.platform && <Retry id={j.id} />}</td></tr>))}</Table>
        )}
      </Panel>}
      <Panel title="Integration events">
        {!d?.integrations.length ? <p className="p-5 text-sm text-muted-foreground">No failed provider callbacks.</p> : (
          <Table head={["Provider", "Event", "Status", "Received"]}>{d.integrations.map((x, i) => (
            <tr key={x.id ?? i}><td className={td}>{readable(x.provider ?? "Integration")}</td><td className={`${td} text-xs`}>{readable(x.event ?? "Event")}</td><td className={td}><Pill tone="error">{readable(x.status ?? "Failed")}</Pill></td><td className={`${td} text-xs`}>{fmtDateTime(x.createdAt)}</td></tr>))}</Table>
        )}
      </Panel>
      <Panel title="Finance jobs">
        {fin.isLoading ? <SkeletonRows cols={4} /> : fin.isError ? <ErrorState msg={errMsg(fin.error)} onRetry={() => fin.refetch()} /> : !fin.data?.length ? <p className="p-5 text-sm text-muted-foreground">No failed nightly or receipt jobs.</p> : (
          <Table head={["Job", "ID", "Retries", "Failed at", ""]}>{fin.data.map((j, i) => (
            <tr key={str(j, "id") ?? i}><td className={`${td} font-semibold`}>{JOB_LABEL[str(j, "name") ?? ""] ?? str(j, "name")}</td><td className={`${td} font-mono text-xs`}>{str(j, "id")?.slice(0, 8)}</td><td className={td}>{str(j, "retryCount") ?? "0"}</td><td className={`${td} text-xs`}>{fmtDateTime(str(j, "completedOn") ?? str(j, "completedAt"))}</td><td className={td}>{p.platform && <Retry id={str(j, "id")} />}</td></tr>))}</Table>
        )}
      </Panel>
    </div>
  );
}
