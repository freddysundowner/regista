import { useMemo, useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { ClipboardList } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, NativeSelect, Btn } from "@/components/kit";
import { errMsg } from "@/lib/session";

export default function Audit() {
  const [limit, setLimit] = useState(50);
  const [entity, setEntity] = useState("");
  const params = { limit };
  const q = useListAuditLogs(params, { query: { queryKey: getListAuditLogsQueryKey(params) } });
  const entities = useMemo(() => Array.from(new Set(q.data?.map((a) => a.entityType) ?? [])).sort(), [q.data]);
  const rows = (q.data ?? []).filter((a) => !entity || a.entityType === entity);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    rows.forEach((a) => { const k = new Date(a.createdAt).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); m.set(k, [...(m.get(k) ?? []), a]); });
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Accountability" title="Audit history" meta="Every create, edit and import, with who did it.">
        <NativeSelect data-testid="filter-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className="w-40"><option value="">All records</option>{entities.map((e) => <option key={e} value={e}>{e}</option>)}</NativeSelect>
      </PageHeader>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows rows={8} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? <Empty icon={<ClipboardList className="h-5 w-5" />} title="Nothing recorded yet" body="Audit entries appear as soon as anyone changes the register." /> : (
          <>
            {groups.map(([day, items]) => (
              <section key={day}>
                <h3 className="sticky top-0 border-b border-border/70 bg-muted/60 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">{day}</h3>
                <ul>{items.map((a) => (
                  <li key={a.id} data-testid={`row-audit-${a.id}`} className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-border/40 px-5 py-2.5 text-sm last:border-0 md:grid-cols-[4.5rem_12rem_1fr_auto]">
                    <time className="font-mono text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</time>
                    <span className="font-semibold">{a.userName ?? "System"}</span>
                    <span className="col-span-2 text-foreground/80 md:col-span-1">{a.action.replace(/[._]/g, " ")} <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[11px] text-accent-foreground">{a.entityType}</span></span>
                    <span className="hidden font-mono text-[11px] text-muted-foreground md:block">{a.entityId?.slice(0, 8)}</span>
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
