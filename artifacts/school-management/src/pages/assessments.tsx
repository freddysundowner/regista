import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssessments, useCreateAssessment, useListAssessmentResults, useSetAssessmentLock, useListStudents, saveAssessmentResult,
  getListAssessmentsQueryKey, getListAssessmentResultsQueryKey, getListStudentsQueryKey,
  type AssessmentView, type AssessmentInputType, type ResultView, type ResultInput,
} from "@workspace/api-client-react";
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, CloudOff, Loader2, Lock, Plus, Unlock } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { GradeSelect, TermSelect } from "@/components/finance-kit";
import { useCurriculum } from "@/pages/curriculum";
import { usePerms, useSession, errMsg, fmtDate, localToday } from "@/lib/session";
import { MONEY_RE } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";
import { ClassBar, levelTone, useClassContext } from "@/components/class-bar";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { formative: "Classwork", summative: "Exam", project: "Project", sba: "SBA" };
const nice = (s: string) => TYPE_LABEL[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function NewAssessment({ onDone, onCancel, initial }: { onDone: (a: AssessmentView) => void; onCancel: () => void; initial?: { termId: string; gradeId: string; learningAreaId: string } }) {
  const m = useCreateAssessment(); const qc = useQueryClient(); const cur = useCurriculum();
  const [f, setF] = useState({ termId: initial?.termId ?? "", gradeId: initial?.gradeId ?? "", learningAreaId: initial?.learningAreaId ?? "", name: "", type: "formative" as AssessmentInputType, maxMarks: "", weight: "1", date: localToday() });
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const areas = (cur.data?.learningAreas ?? []).filter((a) => a.gradeId === f.gradeId);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.termId || !f.gradeId || !f.learningAreaId || !f.name.trim()) return setErr("Term, grade, subject and name are required.");
    if (f.type === "summative" && !f.maxMarks) return setErr("Summative assessments need maximum marks.");
    if ((f.maxMarks && !MONEY_RE.test(f.maxMarks)) || !MONEY_RE.test(f.weight)) return setErr("Marks and weight must be positive numbers.");
    m.mutate({ data: { termId: f.termId, gradeId: f.gradeId, learningAreaId: f.learningAreaId, name: f.name.trim(), type: f.type, weight: f.weight, date: f.date, ...(f.maxMarks ? { maxMarks: f.maxMarks } : {}) } }, {
      onSuccess: (a) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/assessments") }); onDone(a); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      {/* Four questions. The class and term come from the page behind this form, the date is today and the weight is
          the normal 1; those sit under "More options" for the rare time they need changing. */}
      {f.gradeId && !areas.length ? (
        <p className="rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2.5 text-sm" data-testid="notice-no-subjects">This grade has no subjects yet, and marks are recorded per subject. <Link href="/subjects" className="font-semibold text-primary hover:underline">Add subjects</Link>, then come back.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject" required><NativeSelect data-testid="select-new-subject" value={f.learningAreaId} disabled={!f.gradeId} onChange={(e) => setF({ ...f, learningAreaId: e.target.value })}><option value="">{!f.gradeId ? "Choose grade first" : "Select"}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
          <Field label="Name" required><TextInput data-testid="input-assessment-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Opener CAT" /></Field>
          <Field label="Kind" required><NativeSelect value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AssessmentInputType })}><option value="formative">Classwork or quiz</option><option value="summative">Exam or CAT</option><option value="project">Project</option><option value="sba">School-based (SBA)</option></NativeSelect></Field>
          <Field label="Out of" hint="Blank to use levels only"><TextInput inputMode="decimal" value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 50" /></Field>
        </div>
      )}
      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore((x) => !x)} data-testid="button-assessment-more" className="text-sm font-semibold text-primary hover:underline">{more ? "Fewer options" : "More options"}</button>
        {more && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
          <GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v, learningAreaId: "" })} />
          <Field label="Date" required><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Weight" required hint="How much it counts; 1 is normal"><TextInput inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        </div>}
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending || (!!f.gradeId && !areas.length)}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create and open</Btn><Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn></FormActions>
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

const pct = (n: number) => `${Math.round(n)}%`;

/** One assessment's mark sheet for one class: type a mark, press Enter for the next learner. Every cell saves on its own. */
function MarkSheet({ a, streamId, subject }: { a: AssessmentView; streamId: string; subject: string }) {
  const p = usePerms(); const session = useSession(); const qc = useQueryClient(); const { toast } = useToast();
  const cur = useCurriculum();
  const sp = { streamId };
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp) } });
  const res = useListAssessmentResults(a.id, { query: { queryKey: getListAssessmentResultsQueryKey(a.id) } });
  const lock = useSetAssessmentLock();
  const [sub, setSub] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [overriding, setOverriding] = useState<Record<string, boolean>>({});
  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [showComments, setShowComments] = useState(false);
  const timers = useRef<Record<string, number>>({});
  const scope = `${session.school.id}:${session.user.id}:${a.id}`;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: getListAssessmentResultsQueryKey(a.id) }), [qc, a.id]);
  const q = useResultQueue(scope, a.id, refresh);
  useEffect(() => { setDrafts({}); setOverriding({}); }, [scope, sub]);
  const scaleId = cur.data?.gradeScales.find((g) => g.gradeId === a.gradeId)?.scaleId;
  // Best level first (by band, not by the scale's own numbering), so colours and lists read EE → BE.
  const levels = useMemo(() => [...(cur.data?.scales.find((s) => s.id === scaleId)?.levels ?? [])].sort((x, y) => Number(y.minPercent) - Number(x.minPercent)), [cur.data, scaleId]);
  const toneOf = (id?: string) => { const i = levels.findIndex((l) => l.id === id); return i < 0 ? "" : levelTone(i, levels.length); };
  const subs = (cur.data?.strands ?? []).filter((s) => s.learningAreaId === a.learningAreaId && s.parentId);
  const byStudent = useMemo(() => { const m = new Map<string, ResultView>(); res.data?.filter((r) => (r.subStrandId ?? "") === sub).forEach((r) => m.set(r.studentId, r)); return m; }, [res.data, sub]);
  const locked = a.status === "locked";
  const rubric = !a.maxMarks;
  const learners = (students.data ?? []).filter((s) => s.status === "active").sort((x, y) => x.fullName.localeCompare(y.fullName));
  const draftOf = (sid: string): Draft => drafts[sid] ?? { marks: byStudent.get(sid)?.marks ?? "", levelId: byStudent.get(sid)?.performanceLevelId ?? "", overrideReason: "", comment: byStudent.get(sid)?.comment ?? "" };
  const computed = (marks: string) => { if (!a.maxMarks || !MONEY_RE.test(marks)) return undefined; const pc = (Number(marks) / Number(a.maxMarks)) * 100; return levels.find((l) => pc >= Number(l.minPercent) && (pc < Number(l.maxPercent) || Number(l.maxPercent) === 100)); };
  const schedule = (sid: string, d: Draft, delay = 900) => {
    const k = `${sid}:${sub}`; window.clearTimeout(timers.current[k]);
    timers.current[k] = window.setTimeout(() => {
      if (rubric ? !d.levelId : !MONEY_RE.test(d.marks)) return;
      if (!rubric && Number(d.marks) > Number(a.maxMarks)) return q.setCell(k, { status: "error", message: `Max ${a.maxMarks}` });
      const auto = computed(d.marks);
      const override = !rubric && d.levelId && auto && d.levelId !== auto.id;
      if (override && d.overrideReason.trim().length < 3) return q.setCell(k, { status: "error", message: "Give a reason for the level change" });
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
  const doLock = () => {
    if (lockReason.trim().length < 3) return void toast({ title: "Give a short reason", variant: "destructive" });
    if (!locked && q.pending) return void toast({ title: "Wait for unsaved marks to finish saving", variant: "destructive" });
    lock.mutate({ id: a.id, data: { locked: !locked, reason: lockReason.trim() } }, {
      onSuccess: () => { setLockReason(""); setLockOpen(false); qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("/api/assessments") }); toast({ title: locked ? "Marks unlocked" : "Marks locked" }); },
      onError: (x) => toast({ title: "Could not change lock", description: errMsg(x), variant: "destructive" }),
    });
  };
  // Enter (or ↓) moves to the same field on the next learner, so a whole class can be keyed without the mouse.
  const nextField = (e: React.KeyboardEvent<HTMLElement>, row: number, field: string) => {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const target = document.querySelector<HTMLElement>(`[data-cell="${field}-${row + (e.key === "ArrowUp" ? -1 : 1)}"]`);
    target?.focus(); if (target instanceof HTMLInputElement) target.select();
  };

  // Class picture for this assessment.
  const levelFor = (sid: string) => { const d = draftOf(sid); return d.levelId || computed(d.marks)?.id || ""; };
  const marked = learners.filter((s) => rubric ? !!levelFor(s.id) : MONEY_RE.test(draftOf(s.id).marks));
  const average = !rubric && marked.length ? marked.reduce((t, s) => t + Number(draftOf(s.id).marks), 0) / marked.length / Number(a.maxMarks) * 100 : null;
  const spread = levels.map((l, i) => ({ l, i, n: learners.filter((s) => levelFor(s.id) === l.id).length }));

  return (
    <Panel title={a.name} note={`${subject} · ${nice(a.type)} · ${fmtDate(a.date)} · ${a.maxMarks ? `out of ${Number(a.maxMarks)}` : "rubric levels"}${Number(a.weight) !== 1 ? ` · weight ${a.weight}` : ""}`}
      action={<div className="flex flex-wrap items-center gap-2 text-xs">
        {q.pending > 0 ? <span className="flex items-center gap-1 text-amber-800">{navigator.onLine === false ? <CloudOff className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}{q.pending} saving</span> : <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="h-3.5 w-3.5" />All saved</span>}
        {(!locked || p.academicAdmin) && <Btn variant="outline" className="h-8" data-testid="button-lock" onClick={() => setLockOpen(true)}>{locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}{locked ? "Unlock" : "Lock marks"}</Btn>}
        {locked && !p.academicAdmin && <Pill tone="inactive">Locked</Pill>}
      </div>}>
      <FormDialog open={lockOpen} onOpenChange={setLockOpen} busy={lock.isPending} size="sm" title={locked ? "Unlock these marks?" : "Lock these marks?"}
        description={locked ? "Unlocking lets marks be changed again. The reason is recorded." : "Locked marks can't be changed and can go on report cards. The reason is recorded."}>
        <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); doLock(); }}>
          <Field label="Reason" required><TextInput autoFocus value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder={locked ? "Correct a mis-keyed mark" : "Marks checked"} /></Field>
          <FormActions><Btn type="submit" disabled={lock.isPending}>{lock.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{locked ? "Unlock" : "Lock marks"}</Btn><Btn type="button" variant="ghost" onClick={() => setLockOpen(false)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border/70 px-5 py-2.5 text-xs" data-testid="marksheet-summary">
        <div className="min-w-[10rem]">
          <div className="mb-1 flex justify-between"><span className="text-muted-foreground">Marked</span><span className="font-semibold tabular-nums">{marked.length} of {learners.length}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: learners.length ? `${(marked.length / learners.length) * 100}%` : 0 }} /></div>
        </div>
        {average !== null && <div><span className="text-muted-foreground">Class average </span><span className="font-semibold tabular-nums">{pct(average)}</span></div>}
        {marked.length > 0 && <div className="flex flex-wrap gap-1">{spread.map(({ l, i, n }) => <span key={l.id} title={l.label} className={cn("rounded px-1.5 py-0.5 font-semibold tabular-nums", n ? levelTone(i, levels.length) : "bg-muted text-muted-foreground")}>{l.code} {n}</span>)}</div>}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} data-testid="toggle-comments" />Comments</label>
        {subs.length > 0 && <label className="flex items-center gap-2"><span className="text-muted-foreground">Part</span><NativeSelect className="h-8 w-48 text-xs" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">Whole assessment</option>{subs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></label>}
      </div>
      {!levels.length && !cur.isLoading && <p className="flex items-center gap-2 border-b border-border/70 bg-amber-50/60 px-5 py-2 text-xs text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />This grade has no rating scale yet. Choose one on the Subjects page before marks can be saved.</p>}
      {locked && <p className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-5 py-2 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />These marks are locked.{p.academicAdmin ? " Unlock to change them." : ""}</p>}

      {students.isLoading || res.isLoading ? <SkeletonRows cols={4} /> : res.isError ? <ErrorState msg={errMsg(res.error)} onRetry={() => res.refetch()} /> : !learners.length ? <Empty icon={<ClipboardCheck className="h-5 w-5" />} title="No learners" body="This class has no active learners, or none you teach this subject to." /> : (
        <div className="max-h-[calc(100dvh-17rem)] min-h-[16rem] overflow-auto">
          <table className="w-full text-sm" data-testid="marksheet">
            <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
              <tr><th className="w-10 px-2 py-2 text-right font-medium max-md:hidden">#</th><th className="px-3 py-2 font-medium">Learner</th>{!rubric && <th className="w-24 px-2 py-2 font-medium">Marks /{Number(a.maxMarks)}</th>}<th className={cn("px-2 py-2 font-medium", rubric ? "w-44" : "w-28")}>Level</th>{showComments && <th className="w-[30%] px-2 py-2 font-medium">Comment</th>}<th className="w-20 px-2 py-2 font-medium"><span className="sr-only">Saved</span></th></tr>
            </thead>
            <tbody className="divide-y divide-border/50">{learners.map((s, row) => {
              const d = draftOf(s.id); const k = `${s.id}:${sub}`; const c = q.cells[k]; const auto = computed(d.marks); const server = byStudent.get(s.id);
              const level = d.levelId || auto?.id || "";
              const isOverride = !rubric && !!d.levelId && !!auto && d.levelId !== auto.id;
              const showPicker = rubric || overriding[s.id] || isOverride;
              return (
                <tr key={s.id} data-testid={`row-result-${s.id}`} className={cn("h-10", c?.status === "conflict" && "bg-destructive/5", c?.status === "error" && "bg-rose-50/60")}>
                  <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground max-md:hidden">{row + 1}</td>
                  <td className="max-w-0 px-3 py-1"><div className="flex items-baseline gap-2 truncate"><span className="truncate font-medium">{s.fullName}</span><span className="shrink-0 font-mono text-[11px] text-muted-foreground max-md:hidden">{s.admissionNo}</span></div></td>
                  {!rubric && <td className="px-2 py-1"><TextInput data-cell={`marks-${row}`} aria-label={`Marks for ${s.fullName}`} inputMode="decimal" disabled={locked} className="h-8 w-20 text-right font-mono" value={d.marks} placeholder="—"
                    onKeyDown={(e) => nextField(e, row, "marks")} onChange={(e) => edit(s.id, { marks: e.target.value.replace(/[^\d.]/g, ""), levelId: "" })} /></td>}
                  <td className="px-2 py-1">
                    {showPicker ? <NativeSelect data-cell={rubric ? `level-${row}` : undefined} aria-label={`Level for ${s.fullName}`} disabled={locked || !levels.length} className="h-8 w-full max-w-[10rem] text-xs" value={level}
                      onKeyDown={rubric ? (e) => nextField(e, row, "level") : undefined} onChange={(e) => edit(s.id, { levelId: e.target.value }, rubric ? 300 : 1500)}>
                      <option value="">{rubric ? "Choose level" : auto ? `${auto.code} (from marks)` : "Level"}</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.label}</option>)}
                    </NativeSelect>
                      : level ? <button type="button" disabled={locked} onClick={() => setOverriding((o) => ({ ...o, [s.id]: true }))} title={locked ? undefined : "Change level"} className={cn("rounded px-2 py-0.5 text-xs font-semibold", toneOf(level))}>{levels.find((l) => l.id === level)?.code}</button>
                      : <span className="text-xs text-muted-foreground">—</span>}
                    {isOverride && <TextInput aria-label="Reason for changing the level" disabled={locked} className="mt-1 h-8 text-xs" placeholder="Why a different level?" value={d.overrideReason} onChange={(e) => edit(s.id, { overrideReason: e.target.value }, 1500)} />}
                  </td>
                  {showComments && <td className="px-2 py-1"><TextInput data-cell={`comment-${row}`} aria-label={`Comment for ${s.fullName}`} disabled={locked} className="h-8 w-full text-xs" placeholder="Optional" value={d.comment} onKeyDown={(e) => nextField(e, row, "comment")} onChange={(e) => edit(s.id, { comment: e.target.value }, 1500)} /></td>}
                  <td className="px-2 py-1 text-xs">
                    {!c ? (server ? <span className="flex items-center gap-1 text-muted-foreground"><Check className="h-3.5 w-3.5" /><span className="max-md:sr-only">Saved</span></span> : null)
                      : c.status === "conflict" ? <div className="space-y-1 text-destructive"><div>Changed elsewhere</div><div className="flex gap-1"><Btn variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => resolveConflict(s.id, false)}>Theirs</Btn><Btn className="h-6 px-1.5 text-[11px]" onClick={() => resolveConflict(s.id, true)}>Mine</Btn></div></div>
                      : c.status === "error" ? <div className="text-destructive">{c.message}<button type="button" className="ml-1 font-semibold underline" onClick={() => schedule(s.id, d, 0)}>Retry</button></div>
                      : <span className={cn("flex items-center gap-1", c.status === "saved" ? "text-primary" : "text-amber-800")}>{c.status === "saved" ? <Check className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}{c.status === "saving" ? "Saving" : c.status === "queued" ? c.message ? "Will retry" : "Queued" : "Saved"}</span>}
                  </td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Marks for one class and term: pick a subject, pick an assessment, key the marks. */
export default function Assessments() {
  const p = usePerms(); const cur = useCurriculum();
  const ctx = useClassContext(); const stream = ctx.stream, term = ctx.term;
  const params = { ...(term ? { termId: term.id } : {}), ...(stream ? { gradeId: stream.gradeId } : {}) };
  const q = useListAssessments(params, { query: { queryKey: getListAssessmentsQueryKey(params), enabled: !!stream && !!term } });
  const [subject, setSubject] = useState("");
  const [sel, setSel] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const areas = useMemo(() => (cur.data?.learningAreas ?? []).filter((x) => x.gradeId === stream?.gradeId).sort((x, y) => x.name.localeCompare(y.name)), [cur.data, stream?.gradeId]);
  const areaName = (id: string) => areas.find((x) => x.id === id)?.name ?? "Subject";
  const list = (q.data ?? []).filter((x) => !subject || x.learningAreaId === subject);
  const count = (id: string) => (q.data ?? []).filter((x) => x.learningAreaId === id).length;
  const a = list.find((x) => x.id === sel) ?? list[0];
  useEffect(() => { setSel(null); }, [stream?.id, term?.id, subject]);
  return (
    <div className="space-y-4">
      <PageHeader title="Marks" meta={p.limitedToAssigned ? "Your subjects only. Marks save as you type." : "Set an assessment, then key marks for the class. Every mark saves on its own."}>
        <Btn data-testid="button-new-assessment" className="max-md:hidden" disabled={!stream || !term} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New assessment</Btn>
      </PageHeader>
      <ClassBar ctx={ctx} />
      <FormDialog open={creating} onOpenChange={setCreating} size="lg" title="New assessment" description={stream && term ? `${stream.gradeName} · ${term.name}. The mark sheet opens once it's created.` : undefined}>
        {creating && <NewAssessment initial={{ termId: term?.id ?? "", gradeId: stream?.gradeId ?? "", learningAreaId: subject }} onCancel={() => setCreating(false)} onDone={(x) => { setCreating(false); setSubject(x.learningAreaId); setSel(x.id); }} />}
      </FormDialog>

      {/* Nothing to pick between until the class has an assessment this term. */}
      {(q.data?.length ?? 0) > 0 && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:border-0 max-md:bg-transparent max-md:p-0" data-testid="marks-toolbar">
        <label className="flex min-w-0 items-center gap-2 text-sm"><span className="text-muted-foreground max-md:sr-only">Subject</span>
          <NativeSelect data-testid="select-subject" aria-label="Subject" className="h-9 w-52 max-md:w-full" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>{areas.map((x) => <option key={x.id} value={x.id}>{x.name}{count(x.id) ? ` (${count(x.id)})` : ""}</option>)}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 items-center gap-2 text-sm"><span className="text-muted-foreground max-md:sr-only">Assessment</span>
          <NativeSelect data-testid="select-assessment" aria-label="Assessment" className="h-9 w-72 max-w-full max-md:w-full" value={a?.id ?? ""} disabled={!list.length} onChange={(e) => setSel(e.target.value)}>
            {!list.length && <option value="">{q.isLoading ? "Loading…" : "None yet"}</option>}
            {list.map((x) => <option key={x.id} value={x.id}>{x.name} · {subject ? "" : `${areaName(x.learningAreaId)} · `}{nice(x.type)} · {fmtDate(x.date)}{x.status === "locked" ? " · locked" : ""}</option>)}
          </NativeSelect>
        </label>
        </div>}

      {ctx.loading || q.isLoading ? <Panel><SkeletonRows rows={6} cols={4} /></Panel> : q.isError ? <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel>
        : a && stream ? <MarkSheet key={`${a.id}:${stream.id}`} a={a} streamId={stream.id} subject={areaName(a.learningAreaId)} />
        : <Panel><Empty icon={<ClipboardCheck className="h-5 w-5" />} title={stream ? `No assessments${subject ? ` for ${areaName(subject)}` : ""} this term` : "Choose a class"} body={stream ? "Create one to start entering marks." : "Pick a class above to start."}>{stream && term && <Btn className="max-md:hidden" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New assessment</Btn>}</Empty></Panel>}
      <Fab testid="fab-new-assessment" label="New assessment" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} />
    </div>
  );
}
