import { useMemo, useState } from "react";
import { useListPlatformSchools, getListPlatformAuditQueryKey, getListPlatformAuditUrl, getListPlatformSchoolsQueryKey, type PlatformAudit } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, TextInput, NativeSelect } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, fmtDateTime } from "@/lib/session";

function Json({ v }: { v: unknown }) {
  if (v === undefined || v === null) return <span className="text-muted-foreground">None</span>;
  return <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(v, null, 2)}</pre>;
}

export default function PlatformAuditPage() {
  const initialSchool = new URLSearchParams(window.location.search).get("school") ?? "";
  const [schoolId, setSchoolId] = useState(initialSchool);
  const [limit, setLimit] = useState(25);
  const [action, setAction] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PlatformAudit | null>(null);
  const params = { limit, page, ...(schoolId ? { schoolId } : {}), ...(action.trim() ? { action: action.trim() } : {}), ...(term.trim() ? { search: term.trim() } : {}) };
  // Generated array hooks deliberately preserve overview callers. This query
  // also consumes the pagination header; give its envelope a distinct cache key.
  const q = useQuery({
    queryKey: [...getListPlatformAuditQueryKey(params), "with-total"],
    queryFn: async ({ signal }): Promise<{ rows: PlatformAudit[]; total: number }> => {
      const response = await fetch(getListPlatformAuditUrl(params), { signal, credentials: "same-origin" });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error ?? "Unable to load platform audit");
      const header = response.headers.get("X-Total-Count");
      if (header === null || !/^\d+$/.test(header)) throw new Error("Audit pagination metadata is unavailable. Please retry.");
      return { rows, total: Number(header) };
    },
    staleTime: 15000,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });
  const sq = useListPlatformSchools({ query: { queryKey: getListPlatformSchoolsQueryKey() } });
  const names = useMemo(() => new Map((sq.data ?? []).map((s) => [s.id, s.name])), [sq.data]);
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const reset = () => setPage(1);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform console" title="Platform audit log" meta="Every provisioning, edit, password reset and support session, with the reason given." />
      <FormDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} size="lg" title={open?.action ?? "Entry"} description={open ? fmtDateTime(open.createdAt) : undefined}>
        {open && <div className="space-y-4 p-5 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">School</dt><dd>{open.schoolId ? names.get(open.schoolId) ?? open.schoolId : "Platform"}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actor</dt><dd className="font-mono text-xs">{open.actorId}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Entity</dt><dd className="font-mono text-xs">{open.entityId ?? "\u2014"}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Support grant</dt><dd className="font-mono text-xs">{open.grantId ?? "\u2014"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</dt><dd>{open.reason}</dd></div>
          </dl>
          <div className="grid gap-3 md:grid-cols-2"><div><div className="mb-1 text-xs font-semibold">Before</div><Json v={open.before} /></div><div><div className="mb-1 text-xs font-semibold">After</div><Json v={open.after} /></div></div>
        </div>}
      </FormDialog>
      <div className="rise-1 flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput data-testid="input-search-audit" aria-label="Search all audit history" className="pl-9" maxLength={200} placeholder="Search all history: reason, action or entity" value={term} onChange={(e) => { setTerm(e.target.value); reset(); }} /></div>
        <NativeSelect data-testid="select-audit-school" aria-label="School" className="lg:w-56" value={schoolId} onChange={(e) => { setSchoolId(e.target.value); reset(); }}><option value="">All schools</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        <TextInput data-testid="select-audit-action" aria-label="Exact action filter" className="lg:w-56" maxLength={160} placeholder="Exact action (optional)" value={action} onChange={(e) => { setAction(e.target.value); reset(); }} />
        <NativeSelect data-testid="select-audit-limit" aria-label="Entries per page" className="lg:w-36" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); reset(); }}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}</NativeSelect>
      </div>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <><Empty icon={<ScrollText className="h-5 w-5" />} title="No entries" body="No audit entries match this page and its filters." />{page > 1 && <Btn variant="outline" className="m-4" onClick={() => setPage(page - 1)}>Previous page</Btn>}</>
        ) : (<>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">When</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">School</th><th className="px-3 py-2.5">Reason</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} data-testid={`row-audit-${e.id}`} onClick={() => setOpen(e)} className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-accent/30">
                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                <td className="px-3 py-2.5"><button type="button" className="font-mono text-xs font-semibold hover:text-primary" data-testid={`button-audit-${e.id}`}>{e.action}</button>{e.grantId && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">grant</span>}</td>
                <td className="px-3 py-2.5 text-xs">{e.schoolId ? names.get(e.schoolId) ?? "Unknown school" : <span className="text-muted-foreground">Platform</span>}</td>
                <td className="max-w-md truncate px-3 py-2.5 text-xs text-muted-foreground">{e.reason}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="flex items-center justify-between border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
            <span data-testid="text-audit-range">{(page - 1) * limit + 1} to {(page - 1) * limit + rows.length} of {total} matching entries</span>
            <div className="flex gap-1">
              <Btn variant="outline" className="h-8 px-2" aria-label="Previous page" data-testid="button-audit-prev" disabled={page === 1 || q.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Btn>
              <span className="px-2 py-1.5">Page {page} of {pages}</span>
              <Btn variant="outline" className="h-8 px-2" aria-label="Next page" data-testid="button-audit-next" disabled={page >= pages || q.isFetching} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Btn>
            </div>
          </div>
        </>)}
      </Panel>
    </div>
  );
}
