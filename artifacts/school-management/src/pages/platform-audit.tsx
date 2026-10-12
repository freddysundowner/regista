import { useMemo, useState } from "react";
import { Pager } from "@/components/pager";
import { useListPlatformSchools, getListPlatformAuditQueryKey, getListPlatformAuditUrl, getListPlatformSchoolsQueryKey, type PlatformAudit } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, TextInput, NativeSelect, CardTable, Filters } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, fmtDateTime } from "@/lib/session";
import { ACTION_LABELS, actionLabel, subjectLabel } from "@/lib/audit-format";
import { AuditChanges, AuditTechnical } from "@/components/audit-details";

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
      <PageHeader eyebrow="Platform console" title="Platform audit" meta="Every provisioning, edit, password reset and support session, with the reason given." />
      <FormDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} size="lg" title={open ? actionLabel(open) : "Activity details"} description={open ? fmtDateTime(open.createdAt) : undefined}>
        {open && <div className="space-y-4 p-5 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">School</dt><dd>{open.schoolName ?? (open.schoolId ? names.get(open.schoolId) ?? "School name unavailable" : "Platform")}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Performed by</dt><dd>{open.actorName ?? "Name unavailable"}</dd></div>
            {subjectLabel(open) && <div className="sm:col-span-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Affected record</dt><dd className="break-words">{subjectLabel(open)}</dd></div>}
            {open.grantId && <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Access</dt><dd>Audited school support session</dd></div>}
            <div className="sm:col-span-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</dt><dd>{open.reason}</dd></div>
          </dl>
          <AuditChanges before={open.before} after={open.after} />
          <AuditTechnical entry={open} />
        </div>}
      </FormDialog>
      <div className="rise-1"><Filters active={(schoolId ? 1 : 0) + (action ? 1 : 0)} lead={<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput data-testid="input-search-audit" aria-label="Search all audit history" className="pl-9" maxLength={200} placeholder="Search all history: reason, action or entity" value={term} onChange={(e) => { setTerm(e.target.value); reset(); }} /></div>}>
        <NativeSelect data-testid="select-audit-school" aria-label="School" className="lg:w-56" value={schoolId} onChange={(e) => { setSchoolId(e.target.value); reset(); }}><option value="">All schools</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        <NativeSelect data-testid="select-audit-action" aria-label="Activity type" className="lg:w-64" value={action} onChange={(e) => { setAction(e.target.value); reset(); }}><option value="">All activity types</option>{Array.from(new Set([...Object.keys(ACTION_LABELS), ...rows.map(e => e.action), ...(action ? [action] : [])])).sort().map(code => <option key={code} value={code}>{actionLabel({ action: code })}</option>)}</NativeSelect>
        <NativeSelect data-testid="select-audit-limit" aria-label="Entries per page" className="lg:w-36" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); reset(); }}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}</NativeSelect>
      </Filters></div>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <><Empty icon={<ScrollText className="h-5 w-5" />} title="No entries" body="No audit entries match this page and its filters." />{page > 1 && <Btn variant="outline" className="m-4" onClick={() => setPage(page - 1)}>Previous page</Btn>}</>
        ) : (<>
          <CardTable testid="table-platform-audit"><table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">When</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">School</th><th className="px-3 py-2.5">Reason</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} data-testid={`row-audit-${e.id}`} onClick={() => setOpen(e)} className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-accent/30">
                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                <td className="px-3 py-2.5"><button type="button" className="text-left text-sm font-semibold hover:text-primary" data-testid={`button-audit-${e.id}`}>{actionLabel(e)}</button><div className="mt-1 text-xs text-muted-foreground">By {e.actorName ?? "name unavailable"}{subjectLabel(e) && ` · ${subjectLabel(e)}`}</div>{e.grantId && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">Support session</span>}</td>
                <td className="px-3 py-2.5 text-xs">{e.schoolName ?? (e.schoolId ? names.get(e.schoolId) ?? "School name unavailable" : <span className="text-muted-foreground">Platform</span>)}</td>
                <td className="max-w-md whitespace-normal break-words px-3 py-2.5 text-xs text-muted-foreground">{e.reason}</td>
              </tr>
            ))}</tbody>
          </table></CardTable>
          <Pager page={page} size={limit} total={total} pages={pages} busy={q.isFetching} onPage={setPage} />
        </>)}
      </Panel>
    </div>
  );
}
