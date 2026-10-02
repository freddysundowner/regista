import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssessments, useCreateAssessment, useListAssessmentResults, useSetAssessmentLock, useSaveLearnerRating, useListLearnerRatings, getListLearnerRatingsQueryKey, useListStudents, saveAssessmentResult,
  getListAssessmentsQueryKey, getListAssessmentResultsQueryKey, getListStudentsQueryKey,
  type AssessmentView, type AssessmentInputType, type ResultView, type ResultInput, type RatingInputCategory,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, CloudOff, Loader2, Lock, Plus, Unlock } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { GradeSelect, TermSelect } from "@/components/finance-kit";
import { useCurriculum } from "@/pages/curriculum";
import { usePerms, useSession, errMsg, fmtDate, nairobiToday } from "@/lib/session";
import { MONEY_RE } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const COMPETENCIES = ["communication", "critical_thinking", "creativity", "citizenship", "digital_literacy", "learning_to_learn", "self_efficacy"];
const VALUES = ["love", "responsibility", "respect", "unity", "peace", "patriotism", "social_justice", "integrity"];
const nice = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function NewAssessment({ onDone, onCancel }: { onDone: (a: AssessmentView) => void; onCancel: () => void }) {
  const m = useCreateAssessment(); const qc = useQueryClient(); const cur = useCurriculum();
  const [f, setF] = useState({ termId: "", gradeId: "", learningAreaId: "", name: "", type: "formative" as AssessmentInputType, maxMarks: "", weight: "1", date: nairobiToday() });
  const [err, setErr] = useState<string | null>(null);
  const areas = (cur.data?.learningAreas ?? []).filter((a) => a.gradeId === f.gradeId);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.termId || !f.gradeId || !f.learningAreaId || !f.name.trim()) return setErr("Term, grade, learning area and name are required.");
    if (f.type === "summative" && !f.maxMarks) return setErr("Summative assessments need maximum marks.");
    if ((f.maxMarks && !MONEY_RE.test(f.maxMarks)) || !MONEY_RE.test(f.weight)) return setErr("Marks and weight must be positive numbers.");
    m.mutate({ data: { termId: f.termId, gradeId: f.gradeId, learningAreaId: f.learningAreaId, name: f.name.trim(), type: f.type, weight: f.weight, date: f.date, ...(f.maxMarks ? { maxMarks: f.maxMarks } : {}) } }, {
      onSuccess: (a) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/assessments") }); onDone(a); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
        <GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v, learningAreaId: "" })} />
        <Field label="Learning area" required><NativeSelect value={f.learningAreaId} disabled={!f.gradeId} onChange={(e) => setF({ ...f, learningAreaId: e.target.value })}><option value="">{!f.gradeId ? "Choose grade first" : areas.length ? "Select" : "None for this grade"}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
        <Field label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Opener CAT" /></Field>
        <Field label="Type" required><NativeSelect value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AssessmentInputType })}><option value="formative">Formative</option><option value="summative">Summative</option><option value="project">Project</option><option value="sba">School-based (SBA)</option></NativeSelect></Field>
        <Field label="Maximum marks" hint="Blank = rubric levels only"><TextInput inputMode="decimal" value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        <Field label="Weight" required><TextInput inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        <Field label="Date" required><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create assessment</Btn><Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn></FormActions>
    </form>
  );
}

type Draft = { marks: string; levelId: string; overrideReason: string; comment: string };
type CellState = { status: "queued" | "saving" | "saved" | "error" | "conflict"; message?: string };
type Job = { cellKey: string; input: ResultInput };

/**
 * Per-cell autosave queue. Held only in memory and scoped to school + user + assessment, so nothing
 * sensitive is written to browser storage. Survives flaky networks by retrying when the browser reports
 * it is back online; leaving the page with unsaved cells triggers a browser warning.
 */
function useResultQueue(scope: string, assessmentId: string, onSaved: () => void) {
  const queue = useRef<Map<string, Job>>(new Map());
  const running = useRef(false);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const savedRef = useRef(onSaved); savedRef.current = onSaved;
  const setCell = (k: string, s: CellState) => setCells((c) => ({ ...c, [k]: s }));
  useEffect(() => { queue.current.clear(); setCells({}); }, [scope]);
  const pump = useCallback(async () => {
    if (running.current) return; running.current = true;
    try {
      while (queue.current.size && navigator.onLine !== false) {
        const [k, job] = queue.current.entries().next().value as [string, Job];
        queue.current.delete(k); setCell(k, { status: "saving" });
        try { await saveAssessmentResult(assessmentId, job.input); setCell(k, { status: "saved" }); savedRef.current(); }
        catch (x) {
          const status = (x as { status?: number }).status;
          if (status === 409 && /changed elsewhere|reload/i.test(errMsg(x))) { setCell(k, { status: "conflict", message: errMsg(x) }); savedRef.current(); }
          else if (!status || status >= 500) { if (!queue.current.has(k)) queue.current.set(k, job); setCell(k, { status: "queued", message: "Offline or server busy; will retry" }); break; }
          else setCell(k, { status: "error", message: errMsg(x) });
        }
      }
    } finally { running.current = false; }
  }, [assessmentId]);
  useEffect(() => {
    const on = () => void pump(); window.addEventListener("online", on);
    const t = window.setInterval(on, 15000);
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.size) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("online", on); window.removeEventListener("beforeunload", warn); window.clearInterval(t); };
  }, [pump]);
  const enqueue = (k: string, input: ResultInput) => { queue.current.set(k, { cellKey: k, input }); setCell(k, { status: "queued" }); void pump(); };
  const pending = Object.values(cells).filter((c) => c.status === "queued" || c.status === "saving").length;
  return { cells, enqueue, pending, setCell };
}

function Grid({ a }: { a: AssessmentView }) {
  const p = usePerms(); const session = useSession(); const qc = useQueryClient(); const { toast } = useToast();
  const cur = useCurriculum();
  const sp = { gradeId: a.gradeId };
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp) } });
  const res = useListAssessmentResults(a.id, { query: { queryKey: getListAssessmentResultsQueryKey(a.id) } });
  const lock = useSetAssessmentLock();
  const [sub, setSub] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [lockReason, setLockReason] = useState("");
  const timers = useRef<Record<string, number>>({});
  const scope = `${session.school.id}:${session.user.id}:${a.id}`;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: getListAssessmentResultsQueryKey(a.id) }), [qc, a.id]);
  const q = useResultQueue(scope, a.id, refresh);
  useEffect(() => { setDrafts({}); }, [scope, sub]);
  const scaleId = cur.data?.gradeScales.find((g) => g.gradeId === a.gradeId)?.scaleId;
  const levels = useMemo(() => [...(cur.data?.scales.find((s) => s.id === scaleId)?.levels ?? [])].sort((x, y) => x.order - y.order), [cur.data, scaleId]);
  const subs = (cur.data?.strands ?? []).filter((s) => s.learningAreaId === a.learningAreaId && s.parentId);
  const byStudent = useMemo(() => { const m = new Map<string, ResultView>(); res.data?.filter((r) => (r.subStrandId ?? "") === sub).forEach((r) => m.set(r.studentId, r)); return m; }, [res.data, sub]);
  const locked = a.status === "locked";
  const rubric = !a.maxMarks;
  const learners = (students.data ?? []).filter((s) => s.status === "active").sort((x, y) => x.fullName.localeCompare(y.fullName));
  const draftOf = (sid: string): Draft => drafts[sid] ?? { marks: byStudent.get(sid)?.marks ?? "", levelId: byStudent.get(sid)?.performanceLevelId ?? "", overrideReason: "", comment: byStudent.get(sid)?.comment ?? "" };
  const computed = (marks: string) => { if (!a.maxMarks || !MONEY_RE.test(marks)) return undefined; const pct = (Number(marks) / Number(a.maxMarks)) * 100; return levels.find((l) => pct >= Number(l.minPercent) && (pct < Number(l.maxPercent) || Number(l.maxPercent) === 100)); };
  const schedule = (sid: string, d: Draft, delay = 900) => {
    const k = `${sid}:${sub}`; window.clearTimeout(timers.current[k]);
    timers.current[k] = window.setTimeout(() => {
      if (rubric ? !d.levelId : !MONEY_RE.test(d.marks)) return;
      if (!rubric && Number(d.marks) > Number(a.maxMarks)) return q.setCell(k, { status: "error", message: `Max ${a.maxMarks}` });
      const auto = computed(d.marks);
      const override = !rubric && d.levelId && auto && d.levelId !== auto.id;
      if (override && d.overrideReason.trim().length < 3) return q.setCell(k, { status: "error", message: "Override needs a reason" });
      q.enqueue(k, { studentId: sid, expectedRevision: byStudent.get(sid)?.revision ?? 0, ...(sub ? { subStrandId: sub } : {}), ...(rubric ? { performanceLevelId: d.levelId } : { marks: d.marks }),
        ...(override ? { performanceLevelId: d.levelId, overrideReason: d.overrideReason.trim() } : {}), ...(d.comment.trim() ? { comment: d.comment.trim() } : {}) });
      return undefined;
    }, delay);
  };
  const edit = (sid: string, patch: Partial<Draft>, delay?: number) => { const d = { ...draftOf(sid), ...patch }; setDrafts((x) => ({ ...x, [sid]: d })); if (!locked) schedule(sid, d, delay); };
  const resolveConflict = (sid: string, keepMine: boolean) => {
    const k = `${sid}:${sub}`;
    if (keepMine) { q.setCell(k, { status: "queued" }); schedule(sid, draftOf(sid), 0); }
    else { setDrafts((x) => { const n = { ...x }; delete n[sid]; return n; }); q.setCell(k, { status: "saved", message: "Server value kept" }); }
  };
  const doLock = (locking: boolean) => {
    if (lockReason.trim().length < 3) return void toast({ title: "Give a reason", variant: "destructive" });
    if (locking && q.pending) return void toast({ title: "Wait for unsaved marks to finish saving", variant: "destructive" });
    lock.mutate({ id: a.id, data: { locked: locking, reason: lockReason.trim() } }, {
      onSuccess: () => { setLockReason(""); qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("/api/assessments") }); toast({ title: locking ? "Assessment locked" : "Assessment unlocked" }); },
      onError: (x) => toast({ title: "Could not change lock", description: errMsg(x), variant: "destructive" }),
    });
  };
  return (
    <Panel title={a.name} note={`${nice(a.type)} · ${fmtDate(a.date)} · ${a.maxMarks ? `out of ${a.maxMarks}` : "rubric levels"} · weight ${a.weight}`}
      action={<div className="flex items-center gap-2 text-xs">{q.pending > 0 ? <span className="flex items-center gap-1 text-amber-800">{navigator.onLine === false ? <CloudOff className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}{q.pending} unsaved</span> : <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="h-3.5 w-3.5" />All saved</span>}{locked && <Pill tone="inactive">Locked</Pill>}</div>}>
      <div className="flex flex-wrap items-end gap-3 border-b border-border/70 p-4">
        {subs.length > 0 && <Field label="Sub-strand" className="w-60"><NativeSelect value={sub} onChange={(e) => setSub(e.target.value)}><option value="">Whole assessment</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>}
        {(!locked || p.academicAdmin) && <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label={locked ? "Unlock reason" : "Lock reason"}><TextInput value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder={locked ? "Correct a mis-keyed mark" : "Marks verified"} /></Field>
          <Btn variant="outline" disabled={lock.isPending} onClick={() => doLock(!locked)}>{locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{locked ? "Unlock" : "Lock marks"}</Btn>
        </div>}
      </div>
      {!levels.length && !cur.isLoading && <p className="flex items-center gap-2 border-b border-border/70 bg-amber-50/60 px-4 py-2 text-xs text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />This grade has no performance scale. An administrator must assign one under Curriculum before results can be saved.</p>}
      {students.isLoading || res.isLoading ? <SkeletonRows cols={3} /> : res.isError ? <ErrorState msg={errMsg(res.error)} onRetry={() => res.refetch()} /> : !learners.length ? <Empty icon={<ClipboardCheck className="h-5 w-5" />} title="No learners" body="No active learners in this grade, or none in your assigned streams." /> : (
        <ul className="divide-y divide-border/60">{learners.map((s) => {
          const d = draftOf(s.id); const k = `${s.id}:${sub}`; const c = q.cells[k]; const auto = computed(d.marks); const server = byStudent.get(s.id);
          const overriding = !rubric && d.levelId && auto && d.levelId !== auto.id;
          return (
            <li key={s.id} data-testid={`row-result-${s.id}`} className={`grid gap-2 px-4 py-3 sm:grid-cols-[1.4fr_0.8fr_1fr_1.4fr_auto] sm:items-center ${c?.status === "conflict" ? "bg-destructive/5" : ""}`}>
              <div className="text-sm"><div className="font-medium">{s.fullName}</div><div className="font-mono text-[11px] text-muted-foreground">{s.admissionNo}{s.streamName ? ` · ${s.streamName}` : ""}{server ? ` · rev ${server.revision}` : ""}</div></div>
              {rubric ? <div className="hidden sm:block" /> : <TextInput aria-label={`Marks for ${s.fullName}`} inputMode="decimal" disabled={locked} className="font-mono" value={d.marks} placeholder={`/ ${a.maxMarks}`} onChange={(e) => edit(s.id, { marks: e.target.value.replace(/[^\d.]/g, ""), levelId: "" })} />}
              <NativeSelect aria-label={`Level for ${s.fullName}`} disabled={locked || !levels.length} value={rubric ? d.levelId : d.levelId || auto?.id || ""} onChange={(e) => edit(s.id, { levelId: e.target.value }, rubric ? 300 : 1500)}>
                <option value="">{rubric ? "Level" : auto ? `${auto.code} (auto)` : "Level from marks"}</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.label}</option>)}
              </NativeSelect>
              <div className="space-y-1">
                {overriding && <TextInput aria-label="Override reason" disabled={locked} placeholder="Reason for level override" value={d.overrideReason} onChange={(e) => edit(s.id, { overrideReason: e.target.value }, 1500)} />}
                <TextInput aria-label={`Comment for ${s.fullName}`} disabled={locked} placeholder="Comment" value={d.comment} onChange={(e) => edit(s.id, { comment: e.target.value }, 1500)} />
              </div>
              <div className="min-w-[6rem] text-xs">
                {!c ? (server ? <span className="text-muted-foreground">Saved</span> : <span className="text-muted-foreground">Empty</span>)
                  : c.status === "conflict" ? <div className="space-y-1 text-destructive"><div>Changed elsewhere{server ? `: ${server.marks ?? levels.find((l) => l.id === server.performanceLevelId)?.code ?? ""}` : ""}</div><div className="flex gap-1"><Btn variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => resolveConflict(s.id, false)}>Use theirs</Btn><Btn className="h-6 px-1.5 text-[11px]" onClick={() => resolveConflict(s.id, true)}>Keep mine</Btn></div></div>
                  : c.status === "error" ? <div className="text-destructive">{c.message}<Btn variant="ghost" className="ml-1 h-6 px-1.5 text-[11px]" onClick={() => schedule(s.id, d, 0)}>Retry</Btn></div>
                  : <span className={c.status === "saved" ? "text-primary" : "text-amber-800"}>{c.status === "saving" ? "Saving" : c.status === "queued" ? c.message ?? "Queued" : "Saved"}</span>}
              </div>
            </li>);
        })}</ul>
      )}
    </Panel>
  );
}

function Ratings({ gradeId, termId }: { gradeId: string; termId: string }) {
  const cur = useCurriculum(); const m = useSaveLearnerRating(); const { toast } = useToast();
  const sp = { gradeId }; const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp) } });
  const [sid, setSid] = useState(""); const [saved, setSaved] = useState<Record<string, string>>({});
  const rp = { studentId: sid, termId }; const existing = useListLearnerRatings(rp, { query: { queryKey: getListLearnerRatingsQueryKey(rp), enabled: !!sid } });
  const current = (code: string) => saved[`${sid}:${code}`] ?? existing.data?.find((r) => r.code === code)?.performanceLevelId ?? "";
  const scaleId = cur.data?.gradeScales.find((g) => g.gradeId === gradeId)?.scaleId;
  const levels = [...(cur.data?.scales.find((s) => s.id === scaleId)?.levels ?? [])].sort((a, b) => a.order - b.order);
  const rate = (category: RatingInputCategory, code: string, performanceLevelId: string) => {
    if (!performanceLevelId) return;
    m.mutate({ data: { studentId: sid, termId, category, code, performanceLevelId } }, {
      onSuccess: () => setSaved((x) => ({ ...x, [`${sid}:${code}`]: performanceLevelId })),
      onError: (x) => toast({ title: "Rating not saved", description: errMsg(x), variant: "destructive" }),
    });
  };
  return (
    <Panel title="Core competencies and values" note="Rated per learner per term for the report card. Saved ratings load when you pick a learner; each change saves immediately.">
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Learner" required><NativeSelect value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Select</option>{students.data?.filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.fullName} · {s.admissionNo}</option>)}</NativeSelect></Field>
      </div>
      {sid && existing.isError && <ErrorState msg={errMsg(existing.error)} onRetry={() => existing.refetch()} />}
      {sid && existing.isLoading && <SkeletonRows cols={2} />}
      {sid && existing.isSuccess && (levels.length ? <div className="grid gap-6 px-5 pb-5 md:grid-cols-2">{([["competency", COMPETENCIES], ["value", VALUES]] as const).map(([cat, codes]) => (
        <div key={cat}><h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{cat === "competency" ? "Competencies" : "Values"}</h3>
          {codes.map((code) => <div key={code} className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 text-sm"><span>{nice(code)}</span>
            <NativeSelect aria-label={nice(code)} className="h-8 w-40 text-xs" value={current(code)} disabled={m.isPending} onChange={(e) => rate(cat, code, e.target.value)}><option value="">Not rated</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.label}</option>)}</NativeSelect></div>)}
        </div>))}</div> : <p className="px-5 pb-5 text-sm text-muted-foreground">Assign a performance scale to this grade first.</p>)}
    </Panel>
  );
}

export default function Assessments() {
  const p = usePerms(); const cur = useCurriculum();
  const [f, setF] = useState({ termId: "", gradeId: "" });
  const params = { ...(f.termId ? { termId: f.termId } : {}), ...(f.gradeId ? { gradeId: f.gradeId } : {}) };
  const q = useListAssessments(params, { query: { queryKey: getListAssessmentsQueryKey(params) } });
  const [sel, setSel] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const area = useMemo(() => new Map(cur.data?.learningAreas.map((a) => [a.id, a.name])), [cur.data]);
  const a = q.data?.find((x) => x.id === sel);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academics" title="Assessments" meta={p.limitedToAssigned ? "Your assigned learning areas only. Marks save per learner as you type." : "Marks and rubric levels. Every cell saves on its own and never overwrites a newer change."}>
        {<Btn data-testid="button-new-assessment" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New assessment</Btn>}
      </PageHeader>
      <FormDialog open={creating} onOpenChange={setCreating} size="lg" title="Create an assessment" description="Opens the marks register for the new assessment once created."><NewAssessment onCancel={() => setCreating(false)} onDone={(x) => { setCreating(false); setSel(x.id); }} /></FormDialog>
      <Panel title="Assessments">
        <div className="grid gap-3 border-b border-border/70 p-4 sm:grid-cols-2"><TermSelect allowNone="All terms" value={f.termId} onChange={(v) => setF({ ...f, termId: v })} /><GradeSelect allowNone="All grades" value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} /></div>
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<ClipboardCheck className="h-5 w-5" />} title="No assessments" body="Create one to start entering marks." /> : (
          <ul className="divide-y divide-border/60">{q.data.map((x) => (
            <li key={x.id}><button type="button" data-testid={`button-open-assessment-${x.id}`} onClick={() => setSel(x.id)} className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 ${sel === x.id ? "bg-primary/5" : ""}`}>
              <span className="font-medium">{x.name}</span><span className="text-muted-foreground">{area.get(x.learningAreaId) ?? "Learning area"}</span><span className="text-xs text-muted-foreground">{nice(x.type)} · {fmtDate(x.date)}</span><span className="ml-auto"><Pill tone={x.status === "locked" ? "inactive" : "current"}>{x.status}</Pill></span>
            </button></li>))}</ul>
        )}
      </Panel>
      {a && <Grid key={a.id} a={a} />}
      {a && <Ratings key={`r${a.gradeId}${a.termId}`} gradeId={a.gradeId} termId={a.termId} />}
    </div>
  );
}
