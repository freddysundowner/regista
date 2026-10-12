import { useEffect, useState } from "react";
import { Pager, usePaged } from "@/components/pager";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListStudents, useCreateStudent, useListGrades, getListStudentsQueryKey, getGetDashboardSummaryQueryKey, getListGuardiansQueryKey, getListFamiliesQueryKey, getListGradesQueryKey, StudentStatus, type ListStudentsParams } from "@workspace/api-client-react";
import { ChevronRight, GraduationCap, Plus, Search, Users } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Pill, Btn, NativeSelect, CardTable, Filters, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { StudentAdmissionWizard } from "@/components/student-admission-wizard";
import { usePerms, errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

export default function Students() {
  const p = usePerms();
  const search = useSearch();
  const [, nav] = useLocation();
  const [creating, setCreating] = useState(() => new URLSearchParams(search).get("new") === "1");
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);

  const params: ListStudentsParams = { ...(debounced && { search: debounced }), ...(gradeId && { gradeId }), ...(status && { status: status as StudentStatus }) };
  const q = useListStudents(params, { query: { queryKey: getListStudentsQueryKey(params) } });
  const { rows, pager } = usePaged(q.data, params);
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateStudent();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admission register" title="Students" meta={p.limitedToAssigned ? "Showing learners in your assigned streams" : q.data ? `${q.data.length} record${q.data.length === 1 ? "" : "s"} match` : undefined}>
        {p.writeStudents && <Btn data-testid="button-new-student" className="max-md:hidden" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Admit student</Btn>}
      </PageHeader>

      {p.writeStudents && (
        <FormDialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o) setErr(null); }} busy={create.isPending} size="xl" title="Admit a student" description="Four short steps. Nothing is saved until you press Save on the review.">
          <StudentAdmissionWizard pending={create.isPending} error={err} canSearchGuardians={p.viewGuardians}
            onClearError={() => setErr(null)}
            onCancel={() => { setCreating(false); setErr(null); }}
            onSubmit={(data) => {
              setErr(null);
              create.mutate({ data }, {
                onSuccess: (s) => {
                  [getListStudentsQueryKey(), getGetDashboardSummaryQueryKey(), getListGuardiansQueryKey(), getListFamiliesQueryKey(), getListGradesQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
                  toast({ title: "Student admitted", description: `${s.fullName} · ${s.admissionNo}` });
                  setCreating(false);
                  nav(`/students/${s.id}`);
                },
                onError: (x) => setErr(errMsg(x)),
              });
            }} />
        </FormDialog>
      )}

      <Panel className="rise-1">
        <div className="border-b border-border/70 p-3">
          <Filters active={(gradeId ? 1 : 0) + (status ? 1 : 0)} onClear={() => { setGradeId(""); setStatus(""); }} lead={<div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input data-testid="input-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, admission no. or guardian phone"
              className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 max-md:h-11 max-md:text-base" />
          </div>}>
          <NativeSelect data-testid="filter-grade" value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="md:w-44"><option value="">All grades</option>{grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect>
          <NativeSelect data-testid="filter-status" value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-40"><option value="">Any status</option>{Object.values(StudentStatus).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</NativeSelect>
          </Filters>
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty icon={<GraduationCap className="h-5 w-5" />} title={debounced || gradeId || status ? "No matches" : "The register is empty"}
            body={debounced || gradeId || status ? "Try a different name, admission number or filter." : p.writeStudents ? "Admit your first learner or import the whole register from Excel." : "No learners have been assigned to you yet."}>
            {p.importStudents && !debounced && <Link href="/import" className="text-sm font-semibold text-primary hover:underline">Import from Excel</Link>}
          </Empty>
        ) : (<>
          {/* Phone: one slim row per learner. The full name on top; under it the admission number, class and
              boarding in three columns that line up down the list like a table; View opens the learner's page. */}
          <ul className="divide-y divide-border/60 md:hidden" data-testid="list-students">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/students/${s.id}`} data-testid={`row-student-${s.id}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-accent/40">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{s.fullName}</span>{s.status !== "active" && <Pill tone={s.status}>{s.status}</Pill>}</span>
                    <span className="mt-0.5 grid grid-cols-[4.75rem_minmax(0,1fr)_5.5rem] gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-mono">{s.admissionNo}</span>
                      <span className="truncate">{s.gradeName ? `${s.gradeName}${s.streamName ? ` ${s.streamName}` : ""}` : "Unassigned"}</span>
                      <span className="truncate">{s.boardingStatus === "boarder" ? "Boarder" : "Day scholar"}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">View<ChevronRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="max-md:hidden">
          <CardTable testid="table-students">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr className="border-b border-border/70"><th className="px-5 py-2.5 font-semibold">Adm. no</th><th className="px-3 py-2.5 font-semibold">Name</th><th className="px-3 py-2.5 font-semibold">Class</th><th className="hidden px-3 py-2.5 font-semibold md:table-cell">Guardian</th><th className="px-3 py-2.5 font-semibold">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} data-testid={`row-student-${s.id}`} onClick={() => nav(`/students/${s.id}`)} className="group cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40">
                    <td className="px-5 py-3 font-mono text-xs text-foreground/80">{s.admissionNo}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold group-hover:text-primary">{s.fullName}</div>
                      <div className="text-[11px] text-muted-foreground">{s.boardingStatus === "boarder" ? "Boarder" : "Day scholar"}{s.siblingCount > 0 && <span className="ml-2 inline-flex items-center gap-1 text-amber-800"><Users className="h-3 w-3" />{s.siblingCount} sibling{s.siblingCount > 1 ? "s" : ""}</span>}</div>
                    </td>
                    <td className="px-3 py-3">{s.gradeName ? <>{s.gradeName}{s.streamName && <span className="text-muted-foreground"> · {s.streamName}</span>}</> : <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="hidden px-3 py-3 md:table-cell">{s.guardianNames[0] ?? <span className="text-muted-foreground">—</span>}<div className="font-mono text-[11px] text-muted-foreground">{s.guardianPhones[0]}</div></td>
                    <td className="px-3 py-3"><Pill tone={s.status}>{s.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardTable>
          </div>
        </>)}
        <Pager {...pager} />
      </Panel>
      {p.writeStudents && <Fab testid="fab-new-student" label="Admit student" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} />}
    </div>
  );
}
