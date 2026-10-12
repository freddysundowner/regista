import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Pager, usePaged } from "@/components/pager";
import {
  useListStaffAssignments, useCreateTeacherAssignment, useDeleteTeacherAssignment, useDeleteSubjectAssignment, useUpdateStream, useSaveCurriculum,
  useListUsers, useListStreams, useListTerms, useGetCurriculum,
  getListStaffAssignmentsQueryKey, getListTeacherAssignmentsQueryKey, getListUsersQueryKey, getListStreamsQueryKey, getListTermsQueryKey,
  getGetCurriculumQueryKey, getListAuditLogsQueryKey, getGetDashboardSummaryQueryKey,
  type StaffAssignment,
} from "@workspace/api-client-react";
import { Layers, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, NativeSelect, FormError, FormActions, Filters, CardTable, Fab } from "@/components/kit";
import { ROLE_LABEL, errMsg, fmtDate } from "@/lib/session";
import { KIND_HELP, KIND_LABEL, KIND_ORDER, KIND_TONE } from "@/lib/assignments";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const role = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r;
type Kind = (typeof KIND_ORDER)[number];

function useRefresh() {
  const qc = useQueryClient();
  return () => [getListStaffAssignmentsQueryKey(), getListTeacherAssignmentsQueryKey(), getListStreamsQueryKey(), getGetCurriculumQueryKey(), getListAuditLogsQueryKey(), getGetDashboardSummaryQueryKey()]
    .forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

/** One dialog for all three assignment types. Subjects come from the class's grade curriculum. */
function AssignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const curriculum = useGetCurriculum({ query: { queryKey: getGetCurriculumQueryKey() } });
  const view = useCreateTeacherAssignment();
  const updateStream = useUpdateStream();
  const saveSubject = useSaveCurriculum();
  const [kind, setKind] = useState<Kind>("subject");
  const [f, setF] = useState({ userId: "", streamId: "", termId: "" });
  const [areas, setAreas] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const teachers = (users.data ?? []).filter((u) => u.isActive && (u.role === "teacher" || u.role === "class_teacher"));
  const stream = streams.data?.find((s) => s.id === f.streamId);
  const termId = f.termId || terms.data?.find((t) => t.isCurrent)?.id || "";
  const subjects = (curriculum.data?.learningAreas ?? []).filter((a) => stream && a.gradeId === stream.gradeId).sort((a, b) => a.name.localeCompare(b.name));
  const taken = new Set((curriculum.data?.assignments ?? []).filter((c) => c.userId === f.userId && c.streamId === f.streamId && c.termId === termId).map((c) => c.learningAreaId));
  const open_ = subjects.filter((a) => !taken.has(a.id));

  const close = () => { setKind("subject"); setF({ userId: "", streamId: "", termId: "" }); setAreas([]); setErr(null); onClose(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.userId || !stream) return setErr("Choose a teacher and a class.");
    const teacher = teachers.find((u) => u.id === f.userId)?.name ?? "Teacher";
    setBusy(true);
    try {
      if (kind === "subject") {
        if (!termId) throw new Error("Choose a term.");
        if (!areas.length) throw new Error("Tick at least one subject.");
        for (const learningAreaId of areas) await saveSubject.mutateAsync({ data: { kind: "assignment", userId: f.userId, streamId: stream.id, learningAreaId, termId } });
        toast({ title: `${teacher} now teaches ${areas.length} ${areas.length === 1 ? "subject" : "subjects"}`, description: `${stream.gradeName} ${stream.name}` });
      } else if (kind === "class_teacher") {
        await updateStream.mutateAsync({ streamId: stream.id, data: { gradeId: stream.gradeId, name: stream.name, classTeacherUserId: f.userId } });
        toast({ title: `${teacher} is class teacher`, description: `${stream.gradeName} ${stream.name}` });
      } else {
        await view.mutateAsync({ data: { userId: f.userId, streamId: stream.id } });
        toast({ title: `${teacher} can view the class`, description: `${stream.gradeName} ${stream.name}` });
      }
      refresh(); close();
    } catch (x) { setErr(x instanceof Error && !("status" in x) ? x.message : errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <FormDialog open={open} onOpenChange={(o) => { if (!o) close(); }} busy={busy} size="lg" title="Assign a teacher" description="Choose what they will do in the class.">
      <form onSubmit={submit} className="space-y-4 p-5">
        <fieldset className="grid gap-2 sm:grid-cols-3" data-testid="assignment-kind">
          <legend className="sr-only">Assignment type</legend>
          {KIND_ORDER.map((k) => (
            <label key={k} className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition ${kind === k ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => { setKind(k); setErr(null); }} className="sr-only" data-testid={`radio-kind-${k}`} />
              <span className="block font-semibold">{KIND_LABEL[k]}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{KIND_HELP[k]}</span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Teacher" required><NativeSelect data-testid="select-assignment-teacher" value={f.userId} onChange={(e) => { setF({ ...f, userId: e.target.value }); setAreas([]); }}><option value="">{users.isLoading ? "Loading staff" : teachers.length ? "Select teacher" : "No active teachers"}</option>{teachers.map((u) => <option key={u.id} value={u.id}>{u.name} ({role(u.role)})</option>)}</NativeSelect></Field>
          <Field label="Class" required><NativeSelect data-testid="select-assignment-stream" value={f.streamId} onChange={(e) => { setF({ ...f, streamId: e.target.value }); setAreas([]); }}><option value="">{streams.isLoading ? "Loading classes" : "Select class"}</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} {s.name}</option>)}</NativeSelect></Field>
          {kind === "subject" && <Field label="Term" required><NativeSelect data-testid="select-assignment-term" value={termId} onChange={(e) => { setF({ ...f, termId: e.target.value }); setAreas([]); }}><option value="">{terms.isLoading ? "Loading terms" : "Select term"}</option>{terms.data?.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.academicYearName}{t.isCurrent ? " (current)" : ""}</option>)}</NativeSelect></Field>}
        </div>
        {kind === "subject" && stream && (
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs">
              <span className="font-semibold">Subjects in {stream.gradeName}</span>
              {open_.length > 0 && <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setAreas(areas.length === open_.length ? [] : open_.map((a) => a.id))}>{areas.length === open_.length ? "Clear" : "Select all"}</button>}
            </div>
            {curriculum.isLoading ? <p className="px-3 py-3 text-xs text-muted-foreground">Loading subjects…</p> : !subjects.length ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">{stream.gradeName} has no subjects yet. Add them on <Link href="/subjects" className="font-semibold text-primary hover:underline">Subjects</Link>.</p>
            ) : (
              <div className="grid max-h-56 gap-x-4 overflow-y-auto px-3 py-2 sm:grid-cols-2" data-testid="assignment-subjects">{subjects.map((a) => {
                const has = taken.has(a.id);
                return (
                  <label key={a.id} className={`flex items-center gap-2 py-1 text-sm ${has ? "text-muted-foreground" : "cursor-pointer"}`}>
                    <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" disabled={has} checked={has || areas.includes(a.id)} onChange={(e) => setAreas(e.target.checked ? [...areas, a.id] : areas.filter((x) => x !== a.id))} data-testid={`check-subject-${a.id}`} />
                    {a.name}{has && <span className="text-[11px]">· already assigned</span>}
                  </label>
                );
              })}</div>
            )}
          </div>
        )}
        {kind === "class_teacher" && stream?.classTeacherName && stream.classTeacherUserId !== f.userId && <p className="rounded-md bg-amber-600/10 px-3 py-2 text-xs text-amber-900">{stream.gradeName} {stream.name} already has {stream.classTeacherName} as class teacher. Saving replaces them.</p>}
        <FormError msg={err || (users.isError ? errMsg(users.error) : streams.isError ? errMsg(streams.error) : null)} />
        <FormActions>
          <Btn type="submit" data-testid="button-save-assignment" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Assign</Btn>
          <Btn type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Btn>
        </FormActions>
      </form>
    </FormDialog>
  );
}

/** Every teaching assignment in one searchable table: subject teachers, class teachers and view-only access. */
export default function TeacherAssignments() {
  const refresh = useRefresh();
  const { toast } = useToast();
  const q = useListStaffAssignments({ query: { queryKey: getListStaffAssignmentsQueryKey() } });
  const delView = useDeleteTeacherAssignment();
  const delSubject = useDeleteSubjectAssignment();
  const updateStream = useUpdateStream();
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState("");
  const [teacher, setTeacher] = useState("");
  const [grade, setGrade] = useState("");
  const [period, setPeriod] = useState("current");

  const all = q.data ?? [];
  const options = useMemo(() => {
    const uniq = (pairs: [string, string][]) => [...new Map(pairs).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
    return {
      teachers: uniq(all.map((a) => [a.userId, a.userName])),
      grades: uniq(all.map((a) => [a.gradeId, a.gradeName])),
      terms: [...new Set(all.map((a) => a.termName).filter((t): t is string => !!t))].sort(),
    };
  }, [all]);
  const needle = term.trim().toLowerCase();
  const filtered = all.filter((a) => (!kind || a.kind === kind) && (!teacher || a.userId === teacher) && (!grade || a.gradeId === grade)
    && (period === "" || (period === "current" ? a.isCurrentTerm : a.termName === period))
    && (!needle || [a.userName, role(a.userRole), a.gradeName, a.streamName, `${a.gradeName} ${a.streamName}`, a.subject, a.termName, KIND_LABEL[a.kind]].some((v) => v?.toLowerCase().includes(needle))));
  const { rows, pager } = usePaged(filtered, [term, kind, teacher, grade, period]);
  const teacherCount = new Set(filtered.map((a) => a.userId)).size;
  const active = (kind ? 1 : 0) + (teacher ? 1 : 0) + (grade ? 1 : 0) + (period !== "current" ? 1 : 0);
  const removing = delView.isPending || delSubject.isPending || updateStream.isPending;

  const remove = (a: StaffAssignment) => {
    const opts = { onSuccess: () => { refresh(); setConfirmId(null); toast({ title: "Assignment removed", description: `${a.userName} · ${a.gradeName} ${a.streamName}` }); }, onError: (x: unknown) => toast({ title: "Could not remove", description: errMsg(x), variant: "destructive" }) };
    if (a.kind === "subject") delSubject.mutate({ assignmentId: a.recordId }, opts);
    else if (a.kind === "stream_access") delView.mutate({ assignmentId: a.recordId }, opts);
    else updateStream.mutate({ streamId: a.streamId, data: { gradeId: a.gradeId, name: a.streamName, classTeacherUserId: null } }, opts);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Teacher assignments" meta="Who teaches where, and what they are allowed to do there.">
        <Btn data-testid="button-new-assignment" className="max-md:hidden" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Assign teacher</Btn>
      </PageHeader>
      <AssignDialog open={adding} onClose={() => setAdding(false)} />

      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border/60 sm:grid-cols-3" data-testid="assignment-guide">{KIND_ORDER.map((k) => (
        <div key={k} className="bg-card px-4 py-2.5">
          <dt><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[k]}`}>{KIND_LABEL[k]}</span></dt>
          <dd className="mt-1 text-xs text-muted-foreground">{KIND_HELP[k]}</dd>
        </div>
      ))}</dl>

      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows rows={5} cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !all.length ? <Empty icon={<Layers className="h-5 w-5" />} title="No assignments yet" body="Assign subject teachers and class teachers so they can mark attendance and enter results." /> : (<>
          <div className="space-y-2 border-b border-border/60 px-4 py-3 sm:px-5">
            <Filters active={active} onClear={() => { setKind(""); setTeacher(""); setGrade(""); setPeriod("current"); }} lead={<div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input data-testid="input-assignment-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search teacher, class, subject…"
                className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 max-md:h-11 max-md:text-base" />
            </div>}>
              <NativeSelect data-testid="filter-assignment-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="md:w-40"><option value="">All types</option>{KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</NativeSelect>
              <NativeSelect data-testid="filter-assignment-teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)} className="md:w-44"><option value="">All teachers</option>{options.teachers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</NativeSelect>
              <NativeSelect data-testid="filter-assignment-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className="md:w-36"><option value="">All grades</option>{options.grades.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</NativeSelect>
              <NativeSelect data-testid="filter-assignment-term" value={period} onChange={(e) => setPeriod(e.target.value)} className="md:w-40"><option value="current">Current term</option><option value="">All terms</option>{options.terms.map((t) => <option key={t} value={t}>{t}</option>)}</NativeSelect>
            </Filters>
            <p className="text-xs text-muted-foreground" data-testid="assignment-count">{filtered.length} {filtered.length === 1 ? "assignment" : "assignments"} · {teacherCount} {teacherCount === 1 ? "teacher" : "teachers"}</p>
          </div>
          {!filtered.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No assignments match these filters.</p> : (
            <CardTable>
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-5 py-2.5 font-medium">Teacher</th><th className="px-3 py-2.5 font-medium">Class</th><th className="px-3 py-2.5 font-medium">Assignment</th><th className="px-3 py-2.5 font-medium">Term</th><th className="px-3 py-2.5 font-medium">Since</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">{rows.map((a) => (
                  <tr key={a.id} data-testid={`row-assignment-${a.recordId}`} className={a.userActive ? "" : "opacity-60"}>
                    <td className="px-5 py-2.5"><Link href={`/staff/${a.userId}`} className="font-medium hover:underline">{a.userName}</Link><div className="text-xs text-muted-foreground">{role(a.userRole)}{!a.userActive && " · inactive"}</div></td>
                    <td className="px-3 py-2.5"><Link href={`/classes/stream/${a.streamId}`} className="hover:underline">{a.gradeName} {a.streamName}</Link></td>
                    <td className="px-3 py-2.5"><span title={KIND_HELP[a.kind]} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[a.kind]}`}>{a.kind === "subject" ? a.subject : KIND_LABEL[a.kind]}</span></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{a.termName ?? "All terms"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(a.assignedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      {confirmId === a.id ? (
                        <span className="inline-flex items-center gap-1">
                          <Btn variant="danger" className="h-7 px-2 text-xs" data-testid={`button-confirm-remove-assignment-${a.recordId}`} disabled={removing} onClick={() => remove(a)}>Remove</Btn>
                          <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmId(null)}>Keep</Btn>
                        </span>
                      ) : <button data-testid={`button-remove-assignment-${a.recordId}`} aria-label={`Remove ${a.userName} as ${a.kind === "subject" ? `${a.subject} teacher` : KIND_LABEL[a.kind].toLowerCase()} of ${a.gradeName} ${a.streamName}`} onClick={() => setConfirmId(a.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </CardTable>
          )}
        </>)}
        <Pager {...pager} />
      </Panel>
      <Fab testid="fab-new-assignment" label="Assign teacher" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} />
    </div>
  );
}
