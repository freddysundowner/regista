import { useMemo, useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { ClipboardList } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, NativeSelect, Btn } from "@/components/kit";
import { errMsg, nairobiDay, fmtTime } from "@/lib/session";

function Snapshot({ label, value, testid }: { label: string; value: unknown; testid: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      {value == null ? <div className="rounded border border-dashed border-border px-3 py-2 text-muted-foreground">No snapshot</div> :
        <pre data-testid={testid} className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-card p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export default function Audit() {
  const [limit, setLimit] = useState(50);
  const [entity, setEntity] = useState("");
  const params = { limit };
  const q = useListAuditLogs(params, { query: { queryKey: getListAuditLogsQueryKey(params) } });
  const entities = useMemo(() => Array.from(new Set(q.data?.map((a) => a.entityType) ?? [])).sort(), [q.data]);
  const rows = (q.data ?? []).filter((a) => !entity || a.entityType === entity);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    rows.forEach((a) => { const k = nairobiDay(a.createdAt); m.set(k, [...(m.get(k) ?? []), a]); });
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Accountability" title="Audit history" meta="Every create, edit and import, with who did it. Times shown in East Africa Time (Nairobi). Select an entry for before/after detail.">
        <NativeSelect data-testid="filter-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className="w-full sm:w-40"><option value="">All records</option>{entities.map((e) => <option key={e} value={e}>{e}</option>)}</NativeSelect>
      </PageHeader>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows rows={8} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? <Empty icon={<ClipboardList className="h-5 w-5" />} title="Nothing recorded yet" body="Audit entries appear as soon as anyone changes the register." /> : (
          <>
            {groups.map(([day, items]) => (
              <section key={day}>
                <h3 className="sticky top-0 border-b border-border/70 bg-muted/60 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">{day}</h3>
                <ul>{items.map((a) => (
                  <li key={a.id} data-testid={`row-audit-${a.id}`} className="border-b border-border/40 last:border-0">
                    <details className="group">
                      <summary className="grid cursor-pointer list-none grid-cols-[4.5rem_1fr] gap-3 px-5 py-2.5 text-sm hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-ring md:grid-cols-[4.5rem_12rem_1fr_auto]">
                        <time dateTime={a.createdAt} className="font-mono text-xs text-muted-foreground">{fmtTime(a.createdAt)}</time>
                        <span className="font-semibold">{a.userName ?? "System"}</span>
                        <span className="col-span-2 text-foreground/80 md:col-span-1">{a.action.replace(/[._]/g, " ")} <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[11px] text-accent-foreground">{a.entityType}</span></span>
                        <span className="hidden font-mono text-[11px] text-muted-foreground md:block"><span className="group-open:hidden">Details</span><span className="hidden group-open:inline">Hide</span></span>
                      </summary>
                      <div className="space-y-3 bg-muted/30 px-5 pb-4 pt-2 text-xs">
                        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          <div><dt className="inline font-semibold">Record id: </dt><dd className="inline break-all font-mono">{a.entityId ?? "\u2014"}</dd></div>
                          <div><dt className="inline font-semibold">IP: </dt><dd className="inline font-mono">{a.ip ?? "\u2014"}</dd></div>
                          <div className="sm:col-span-2"><dt className="inline font-semibold">Device: </dt><dd className="inline break-all text-muted-foreground">{a.userAgent ?? "\u2014"}</dd></div>
                        </dl>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Snapshot label="Before" value={a.before} testid={`text-audit-before-${a.id}`} />
                          <Snapshot label="After" value={a.after} testid={`text-audit-after-${a.id}`} />
                        </div>
                        <p className="text-[11px] text-muted-foreground">Contact, identity and credential fields are redacted by the server.</p>
                      </div>
                    </details>
                  </li>))}</ul>
              </section>
            ))}
            {q.data && q.data.length >= limit && limit < 100 && <div className="border-t border-border/70 p-3 text-center"><Btn variant="outline" data-testid="button-load-more" onClick={() => setLimit(100)}>Show up to 100 entries</Btn></div>}
          </>
        )}
      </Panel>
    </div>
  );
}
