import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListStudents, useCreateStudent, useListGrades, getListStudentsQueryKey, getGetDashboardSummaryQueryKey, getListGuardiansQueryKey, getListFamiliesQueryKey, getListGradesQueryKey, StudentStatus, type ListStudentsParams } from "@workspace/api-client-react";
import { GraduationCap, Plus, Search, Users } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Pill, Btn, NativeSelect } from "@/components/kit";
import { StudentForm, fromStudent, toPayload } from "@/components/student-form";
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
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateStudent();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admission register" title="Students" meta={p.limitedToAssigned ? "Showing learners in your assigned streams" : q.data ? `${q.data.length} record${q.data.length === 1 ? "" : "s"} match` : undefined}>
        {p.writeStudents && !creating && <Btn data-testid="button-new-student" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Admit student</Btn>}
      </PageHeader>

      {creating && (
        <Panel title="Admit a student" note="Essential details only — you can complete the record later.">
          <div className="p-5">
            <StudentForm initial={fromStudent()} withGuardian submitLabel="Save student" pending={create.isPending} error={err}
              onCancel={() => { setCreating(false); setErr(null); }}
              onSubmit={(v) => {
                setErr(null);
                const guardians = v.gName.trim() && v.gPhone.trim() ? [{ name: v.gName.trim(), phone: v.gPhone.trim(), relationship: v.gRelationship, isPrimary: true, receivesNotifications: true }] : undefined;
                create.mutate({ data: { ...toPayload(v), guardians } }, {
                  onSuccess: (s) => {
                    [getListStudentsQueryKey(), getGetDashboardSummaryQueryKey(), getListGuardiansQueryKey(), getListFamiliesQueryKey(), getListGradesQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
                    toast({ title: "Student admitted", description: `${s.fullName} · ${s.admissionNo}` });
                    setCreating(false);
                    nav(`/students/${s.id}`);
                  },
                  onError: (x) => setErr(errMsg(x)),
                });
              }} />
          </div>
        </Panel>
      )}

      <Panel className="rise-1">
        <div className="flex flex-col gap-2 border-b border-border/70 p-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input data-testid="input-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, admission no. or guardian phone"
              className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </div>
          <NativeSelect data-testid="filter-grade" value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="md:w-44"><option value="">All grades</option>{grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect>
          <NativeSelect data-testid="filter-status" value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-40"><option value="">Any status</option>{Object.values(StudentStatus).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</NativeSelect>
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty icon={<GraduationCap className="h-5 w-5" />} title={debounced || gradeId || status ? "No matches" : "The register is empty"}
            body={debounced || gradeId || status ? "Try a different name, admission number or filter." : p.writeStudents ? "Admit your first learner or import the whole register from Excel." : "No learners have been assigned to you yet."}>
            {p.importStudents && !debounced && <Link href="/import" className="text-sm font-semibold text-primary hover:underline">Import from Excel</Link>}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr className="border-b border-border/70"><th className="px-5 py-2.5 font-semibold">Adm. no</th><th className="px-3 py-2.5 font-semibold">Name</th><th className="px-3 py-2.5 font-semibold">Class</th><th className="hidden px-3 py-2.5 font-semibold md:table-cell">Guardian</th><th className="px-3 py-2.5 font-semibold">Status</th></tr>
              </thead>
              <tbody>
                {q.data.map((s) => (
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
          </div>
        )}
      </Panel>
    </div>
  );
}
