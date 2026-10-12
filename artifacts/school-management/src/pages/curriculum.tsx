import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCurriculum, useSaveCurriculum, useSeedCurriculumScales, useListGrades, useListUsers, useListTerms, useListStreams,
  getGetCurriculumQueryKey, getListGradesQueryKey, getListUsersQueryKey, getListTermsQueryKey, getListStreamsQueryKey,
  type CurriculumInput, type CurriculumInputLevelsItem, type CurriculumView,
} from "@workspace/api-client-react";
import { BookOpen, ChevronRight, Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { usePerms, errMsg } from "@/lib/session";
import { MONEY_RE, toCents } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { CurriculumEditor, type EditTarget } from "@/components/curriculum-edit";
import { FormDialog } from "@/components/form-dialog";
import { cn } from "@/lib/utils";

export function useCurriculum() { return useGetCurriculum({ query: { queryKey: getGetCurriculumQueryKey() } }); }

/** Saves one curriculum input and refreshes the tree. */
function useSave(onDone: () => void) {
  const m = useSaveCurriculum(); const qc = useQueryClient(); const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const save = (data: CurriculumInput, title: string) => { setErr(null); m.mutate({ data }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title }); onDone(); },
    onError: (x) => setErr(errMsg(x)) }); };
  return { save, err, setErr, pending: m.isPending, m };
}

function Actions({ pending, close, label }: { pending: boolean; close: () => void; label: string }) {
  return <FormActions><Btn type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</Btn><Btn type="button" variant="ghost" onClick={close}>Cancel</Btn></FormActions>;
}

const codeFor = (name: string) => name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((w, i, all) => all.length > 1 ? w.slice(0, 3) : w.slice(0, 4)).join("").toUpperCase().slice(0, 8);

/** Adds one subject to one or more grades in a single step. */
function SubjectForm({ grades, initialGrade, c, close }: { grades: { id: string; name: string }[]; initialGrade: string; c: CurriculumView; close: () => void }) {
  const s = useSave(close); const qc = useQueryClient(); const { toast } = useToast();
  const [f, setF] = useState({ name: "", code: "" });
  const [picked, setPicked] = useState<string[]>(initialGrade ? [initialGrade] : []);
  const [busy, setBusy] = useState(false);
  const code = (f.code || codeFor(f.name)).trim().toUpperCase();
  const clash = picked.filter((g) => c.learningAreas.some((a) => a.gradeId === g && (a.code === code || a.name.toLowerCase() === f.name.trim().toLowerCase())));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); s.setErr(null);
    if (!f.name.trim() || !code) return s.setErr("Give the subject a name.");
    if (!picked.length) return s.setErr("Tick at least one grade.");
    if (clash.length) return s.setErr(`Already exists in ${clash.map((g) => grades.find((x) => x.id === g)?.name).join(", ")}.`);
    setBusy(true);
    try {
      for (const gradeId of picked) await s.m.mutateAsync({ data: { kind: "learning_area", gradeId, name: f.name.trim(), code } });
      qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() });
      toast({ title: `${f.name.trim()} added`, description: `${picked.length} ${picked.length === 1 ? "grade" : "grades"}` }); close();
    } catch (x) { s.setErr(errMsg(x)); qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-4 p-5">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Subject name" required><TextInput data-testid="input-subject-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Computer Studies" autoFocus /></Field>
      <Field label="Short code" hint="Used on exports and report cards"><TextInput data-testid="input-subject-code" className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder={codeFor(f.name) || "COMP"} /></Field>
    </div>
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-medium">Grades that learn it<button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setPicked(picked.length === grades.length ? [] : grades.map((g) => g.id))}>{picked.length === grades.length ? "Clear" : "All grades"}</button></legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="subject-grades">{grades.map((g) => (
        <label key={g.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm", picked.includes(g.id) ? "border-primary bg-primary/5" : "border-border")}>
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.includes(g.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))} />{g.name}
        </label>
      ))}</div>
    </fieldset>
    <FormError msg={s.err} /><Actions pending={busy} close={close} label={picked.length > 1 ? `Add to ${picked.length} grades` : "Add subject"} />
  </form>;
}

/** Adds a topic (strand) or a sub-topic under one, for the chosen subject. */
function TopicForm({ c, areaId, close }: { c: CurriculumView; areaId: string; close: () => void }) {
  const s = useSave(close);
  const tops = c.strands.filter((x) => x.learningAreaId === areaId && !x.parentId).sort((a, b) => a.order - b.order);
  const [f, setF] = useState({ parentId: "", name: "" });
  const siblings = c.strands.filter((x) => x.learningAreaId === areaId && (f.parentId ? x.parentId === f.parentId : !x.parentId));
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.name.trim()) return s.setErr("Name the topic.");
    s.save({ kind: f.parentId ? "sub_strand" : "strand", learningAreaId: areaId, ...(f.parentId ? { parentId: f.parentId } : {}), name: f.name.trim(), order: siblings.length + 1 }, f.parentId ? "Sub-topic added" : "Topic added"); };
  return <form onSubmit={submit} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Name" required><TextInput data-testid="input-topic-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fractions" autoFocus /></Field>
    <Field label="Where" hint="A sub-topic sits under a main topic"><NativeSelect value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Main topic</option>{tops.map((t) => <option key={t.id} value={t.id}>Under: {t.name}</option>)}</NativeSelect></Field>
  </div><FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Add topic" /></form>;
}

const blankLevels = (n: number): CurriculumInputLevelsItem[] => Array.from({ length: n }, (_, i) => ({ code: "", label: "", points: String(n - i), minPercent: "", maxPercent: "", order: i + 1 }));
function ScaleForm({ close }: { close: () => void }) {
  const s = useSave(close); const [name, setName] = useState(""); const [levels, setLevels] = useState(blankLevels(4));
  const set = (i: number, p: Partial<CurriculumInputLevelsItem>) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return s.setErr("Name the scale.");
    if (levels.some((l) => !l.code.trim() || !l.label.trim() || ![l.points, l.minPercent, l.maxPercent].every((v) => MONEY_RE.test(v)))) return s.setErr("Every level needs a code, label, points and a percentage band.");
    const asc = [...levels].sort((a, b) => Number(toCents(a.minPercent) - toCents(b.minPercent)));
    if (toCents(asc[0].minPercent) !== 0n || toCents(asc[asc.length - 1].maxPercent) !== 10000n) return s.setErr("Bands must start at 0 and end at 100.");
    if (asc.some((l, i) => toCents(l.maxPercent) <= toCents(l.minPercent) || (i > 0 && toCents(l.minPercent) !== toCents(asc[i - 1].maxPercent)))) return s.setErr("Bands must be contiguous with no gaps or overlaps.");
    s.save({ kind: "scale", name: name.trim(), levels: levels.map((l) => ({ ...l, code: l.code.trim(), label: l.label.trim() })) }, "Scale saved");
  };
  return <form onSubmit={submit} className="space-y-4 p-5">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Scale name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Junior School 8-level" /></Field>
      <Field label="Levels" required><NativeSelect value={levels.length} onChange={(e) => setLevels(blankLevels(Number(e.target.value)))}><option value={4}>4 levels (EE, ME, AE, BE)</option><option value={8}>8 levels (EE1 to BE2)</option></NativeSelect></Field></div>
    <div className="space-y-2">{levels.map((l, i) => (
      <div key={i} className="grid gap-2 rounded-md border border-border/70 p-2 sm:grid-cols-5">
        <Field label={`Level ${i + 1} code`} required><TextInput className="font-mono" value={l.code} onChange={(e) => set(i, { code: e.target.value })} /></Field>
        <Field label="Label" required><TextInput value={l.label} onChange={(e) => set(i, { label: e.target.value })} /></Field>
        <Field label="Points" required><TextInput inputMode="decimal" value={l.points} onChange={(e) => set(i, { points: e.target.value })} /></Field>
        <Field label="From %" required><TextInput inputMode="decimal" value={l.minPercent} onChange={(e) => set(i, { minPercent: e.target.value })} /></Field>
        <Field label="To %" required><TextInput inputMode="decimal" value={l.maxPercent} onChange={(e) => set(i, { maxPercent: e.target.value })} /></Field>
      </div>))}</div>
    <FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Save scale" /></form>;
}

function GradeScaleForm({ c, gradeId, gradeName, close, onNew }: { c: CurriculumView; gradeId: string; gradeName: string; close: () => void; onNew: () => void }) {
  const s = useSave(close); const [scaleId, setScaleId] = useState(c.gradeScales.find((g) => g.gradeId === gradeId)?.scaleId ?? "");
  const submit = (e: FormEvent) => { e.preventDefault(); if (!scaleId) return s.setErr("Choose a scale."); s.save({ kind: "grade_scale", gradeId, scaleId }, `${gradeName} scale set`); };
  return <form onSubmit={submit} className="space-y-4 p-5"><Field label={`Scale for ${gradeName}`} required><NativeSelect value={scaleId} onChange={(e) => setScaleId(e.target.value)}><option value="">Select</option>{c.scales.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.levels.length} levels)</option>)}</NativeSelect></Field><p className="text-xs text-muted-foreground">None of these fit? <button type="button" className="font-semibold text-primary hover:underline" onClick={onNew}>Create a new scale</button></p><FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Use this scale" /></form>;
}

const LEVEL_MEANING: Record<string, string> = { EE: "Exceeding expectations", ME: "Meeting expectations", AE: "Approaching expectations", BE: "Below expectations" };
const meaning = (code: string, label: string) => label && label !== code ? label : LEVEL_MEANING[code.replace(/\d+$/, "")] ? `${LEVEL_MEANING[code.replace(/\d+$/, "")]}${/\d$/.test(code) ? ` ${code.slice(-1)}` : ""}` : label;
const BAND_TONES = ["bg-emerald-600", "bg-emerald-500", "bg-sky-500", "bg-sky-400", "bg-amber-400", "bg-amber-500", "bg-orange-500", "bg-rose-500"];
/** The grade's scale as one bar, best level first; each level's width is its percentage band. */
function ScaleBar({ levels }: { levels: CurriculumView["scales"][number]["levels"] }) {
  const desc = [...levels].sort((a, b) => Number(toCents(b.minPercent) - toCents(a.minPercent)));
  const tone = (i: number) => BAND_TONES[Math.round((i * (BAND_TONES.length - 1)) / Math.max(1, desc.length - 1))];
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-md text-[11px] font-semibold text-white">{desc.map((l, i) => (
        <div key={l.id} title={`${l.code} · ${meaning(l.code, l.label)}: ${Number(l.minPercent)}–${Number(l.maxPercent)}%`} className={cn("flex min-w-0 items-center justify-center border-r border-white/40 last:border-0", tone(i))} style={{ flexGrow: Math.max(1, Number(l.maxPercent) - Number(l.minPercent)) }}>{l.code}</div>
      ))}</div>
      <div className={cn("mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2", desc.length > 4 && "lg:grid-cols-4")}>{desc.map((l, i) => (
        <div key={l.id} className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", tone(i))} />
          <span className="font-mono font-semibold">{l.code}</span>
          <span className="min-w-0 truncate text-muted-foreground">{meaning(l.code, l.label)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{Number(l.minPercent)}–{Number(l.maxPercent)}%</span>
        </div>
      ))}</div>
    </div>
  );
}

type Dialog = { kind: "subject" } | { kind: "topic" } | { kind: "scale" } | { kind: "grade-scale" } | { kind: "edit"; target: EditTarget };

/** Subjects one grade at a time: pick a grade, see its subjects, open one for its topics. Scales sit underneath. */
export default function Curriculum() {
  const p = usePerms();
  const q = useCurriculum();
  const seed = useSeedCurriculumScales(); const qc = useQueryClient(); const { toast } = useToast();
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: p.academicAdmin } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey(), enabled: p.academicAdmin } });
  const [gradeId, setGradeId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [openTopics, setOpenTopics] = useState<Set<string>>(() => new Set());
  const toggleTopic = (id: string) => setOpenTopics((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const close = () => setDialog(null);
  const c = q.data;

  const sortedGrades = useMemo(() => [...(grades.data ?? [])].sort((a, b) => a.order - b.order), [grades.data]);
  const grade = sortedGrades.find((g) => g.id === gradeId) ?? sortedGrades.find((g) => c?.learningAreas.some((a) => a.gradeId === g.id)) ?? sortedGrades[0];
  const subjects = (c?.learningAreas ?? []).filter((a) => a.gradeId === grade?.id).sort((a, b) => Number(b.isCore !== false) - Number(a.isCore !== false) || a.name.localeCompare(b.name));
  const subject = subjects.find((a) => a.id === areaId) ?? subjects[0];
  const topics = (c?.strands ?? []).filter((s) => s.learningAreaId === subject?.id);
  const mains = topics.filter((s) => !s.parentId).sort((a, b) => a.order - b.order);
  const scaleId = c?.gradeScales.find((g) => g.gradeId === grade?.id)?.scaleId;
  const scale = c?.scales.find((s) => s.id === scaleId);
  const currentTerm = terms.data?.find((t) => t.isCurrent)?.id;
  const teachersOf = (id: string) => [...new Set((c?.assignments ?? []).filter((a) => a.learningAreaId === id && a.termId === currentTerm).map((a) => {
    const name = users.data?.find((u) => u.id === a.userId)?.name; const st = streams.data?.find((s) => s.id === a.streamId);
    return name ? `${name}${st ? ` (${st.name})` : ""}` : null;
  }).filter(Boolean))] as string[];
  const count = (gid: string) => c?.learningAreas.filter((a) => a.gradeId === gid).length ?? 0;
  const runSeed = () => seed.mutate(undefined, {
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title: "CBC starter subjects added", description: r.message ?? "Existing subjects and edits were kept." }); },
    onError: (x) => toast({ title: "Could not add starters", description: errMsg(x), variant: "destructive" }),
  });
  const edit = (kind: EditTarget["kind"], id: string) => p.academicAdmin ? (
    <button type="button" aria-label="Edit" className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/edit:opacity-100 max-md:opacity-60" onClick={(e) => { e.stopPropagation(); setDialog({ kind: "edit", target: { kind, id } }); }}><Pencil className="h-3.5 w-3.5" /></button>
  ) : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Subjects" meta="What each grade learns, the topics in each subject, and how marks turn into CBC levels.">
        {p.academicAdmin && c && c.learningAreas.length > 0 && <>
          <Btn variant="outline" disabled={seed.isPending} data-testid="button-seed-scales" title="Adds any missing CBC starter subjects, topics and rating scales. Your own edits are kept." onClick={runSeed}>{seed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Fill CBC starters</Btn>
          <Btn data-testid="button-new-subject" onClick={() => setDialog({ kind: "subject" })}><Plus className="h-4 w-4" />Add subject</Btn>
        </>}
      </PageHeader>

      {q.isLoading || grades.isLoading ? <Panel><SkeletonRows cols={3} /></Panel> : q.isError ? <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel> : !c ? null : !c.learningAreas.length ? (
        <Panel>
          <Empty icon={<BookOpen className="h-5 w-5" />} title="No subjects yet" body={p.academicAdmin ? "Start with the CBC starter set: every grade gets its usual subjects, topics and the 4- or 8-level rating scale. You can rename, add or remove anything afterwards." : "Your administrator has not set up subjects yet."}>
            {p.academicAdmin && <div className="flex flex-wrap justify-center gap-2">
              <Btn data-testid="button-seed-scales" disabled={seed.isPending} onClick={runSeed}>{seed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Add CBC starter subjects</Btn>
              <Btn variant="outline" onClick={() => setDialog({ kind: "subject" })}><Plus className="h-4 w-4" />Add my own</Btn>
            </div>}
          </Empty>
        </Panel>
      ) : (<>
        <nav aria-label="Grades" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0 [scrollbar-width:none]" data-testid="grade-picker">{sortedGrades.map((g) => (
          <button key={g.id} type="button" aria-pressed={g.id === grade?.id} onClick={() => { setGradeId(g.id); setAreaId(""); }} data-testid={`grade-chip-${g.id}`}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors", g.id === grade?.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>
            {g.name}<span className={cn("ml-1.5 text-xs tabular-nums", g.id === grade?.id ? "text-primary-foreground/75" : "text-muted-foreground")}>{count(g.id)}</span>
          </button>
        ))}</nav>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Panel title={`${grade?.name ?? ""} subjects`} note={`${subjects.length} ${subjects.length === 1 ? "subject" : "subjects"}`}
            action={p.academicAdmin ? <Btn variant="outline" className="h-8" onClick={() => setDialog({ kind: "subject" })}><Plus className="h-3.5 w-3.5" />Add</Btn> : undefined}>
            {!subjects.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No subjects for {grade?.name} yet.</p> : (
              <ul className="divide-y divide-border/60" data-testid="subject-list">{subjects.map((a) => {
                const n = c.strands.filter((s) => s.learningAreaId === a.id && !s.parentId).length, on = a.id === subject?.id;
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => { setAreaId(a.id); if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById("subject-topics")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} aria-current={on ? "true" : undefined} data-testid={`subject-${a.id}`}
                      className={cn("flex w-full items-center gap-3 px-5 py-2.5 text-left transition", on ? "bg-primary/[0.07]" : "hover:bg-muted/40")}>
                      <span className={cn("h-8 w-1 shrink-0 rounded-full", on ? "bg-primary" : "bg-transparent")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {a.code.length <= 8 && <><span className="font-mono">{a.code}</span>·</>}<span>{n} {n === 1 ? "topic" : "topics"}</span>
                          {a.isCore === false && <span className="rounded bg-amber-600/15 px-1.5 font-semibold text-amber-900">Optional</span>}
                          {a.pathway && <span className="rounded bg-sky-800/10 px-1.5 font-semibold text-sky-900">{a.pathway}</span>}
                        </span>
                      </span>
                      <ChevronRight className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground/50")} />
                    </button>
                  </li>
                );
              })}</ul>
            )}
          </Panel>

          <div id="subject-topics" className="min-w-0 scroll-mt-20">
          <Panel title={subject ? subject.name : "Topics"} note={subject ? (p.academicAdmin ? (teachersOf(subject.id).length ? `Taught by ${teachersOf(subject.id).join(", ")}` : "No teacher assigned this term") : `${mains.length} topics`) : undefined}
            action={subject && p.academicAdmin ? <div className="flex gap-2"><Btn variant="ghost" className="h-8" data-testid="button-edit-subject" onClick={() => { setAreaId(subject.id); setDialog({ kind: "edit", target: { kind: "learning-area", id: subject.id } }); }}><Pencil className="h-3.5 w-3.5" />Edit subject</Btn><Btn variant="outline" className="h-8" data-testid="button-new-topic" onClick={() => { setAreaId(subject.id); setDialog({ kind: "topic" }); }}><Plus className="h-3.5 w-3.5" />Add topic</Btn></div> : undefined}>
            {!subject ? <p className="px-5 py-4 text-sm text-muted-foreground">Pick a subject to see its topics.</p> : !mains.length ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No topics yet. Topics are optional; with them, report cards can show how a learner did in each part of the subject.</p>
            ) : (
              <ol className="divide-y divide-border/60" data-testid="topic-list">{mains.map((t, i) => {
                const subs = topics.filter((x) => x.parentId === t.id).sort((a, b) => a.order - b.order);
                return (
                  <li key={t.id} className="flex gap-3 px-5 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="group/edit flex items-center gap-1"><span className="font-medium">{t.name}</span>{edit("strand", t.id)}</div>
                      {subs.length > 0 && <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={openTopics.has(t.id)} onClick={() => toggleTopic(t.id)} data-testid={`button-subtopics-${t.id}`}>
                        <ChevronRight className={cn("h-3 w-3 transition-transform", openTopics.has(t.id) && "rotate-90")} />{subs.length} {subs.length === 1 ? "sub-topic" : "sub-topics"}</button>}
                      {openTopics.has(t.id) && <div className="mt-1.5 flex flex-wrap gap-1.5">{subs.map((x) => (
                        <span key={x.id} className="group/edit inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs text-muted-foreground">{x.name}{edit("strand", x.id) ?? <span className="w-1.5" />}</span>
                      ))}</div>}
                    </div>
                  </li>
                );
              })}</ol>
            )}
          </Panel>
          </div>
        </div>

        <Panel title={`How ${grade?.name ?? "this grade"} is graded`} note={scale ? scale.name : "No rating scale chosen yet, so marks cannot become levels."}
          action={p.academicAdmin ? <div className="flex flex-wrap gap-2">
            {c.scales.length > 0 && <Btn variant="outline" className="h-8" data-testid="button-grade-scale" onClick={() => setDialog({ kind: "grade-scale" })}>{scale ? "Change scale" : "Choose scale"}</Btn>}
            {scale && <Btn variant="ghost" className="h-8" onClick={() => setDialog({ kind: "edit", target: { kind: "scale", id: scale.id } })}><Pencil className="h-3.5 w-3.5" />Edit bands</Btn>}
            {!c.scales.length && <Btn variant="outline" className="h-8" onClick={() => setDialog({ kind: "scale" })}><Plus className="h-3.5 w-3.5" />Create a scale</Btn>}
          </div> : undefined}>
          <div className="px-5 py-4" data-testid="grade-scale">
            {scale ? <ScaleBar levels={scale.levels} /> : <p className="text-sm text-muted-foreground">{c.scales.length ? "Choose one of your scales for this grade." : "Use “Fill CBC starters” to add the standard 4- and 8-level scales."}</p>}
          </div>
        </Panel>
      </>)}

      <FormDialog open={dialog?.kind === "subject"} onOpenChange={(o) => { if (!o) close(); }} size="lg" title="Add a subject" description="Pick every grade that learns it. You can add topics afterwards.">
        {dialog?.kind === "subject" && c && <SubjectForm c={c} grades={sortedGrades} initialGrade={grade?.id ?? ""} close={close} />}
      </FormDialog>
      <FormDialog open={dialog?.kind === "topic"} onOpenChange={(o) => { if (!o) close(); }} title={`Add a topic to ${subject?.name ?? "subject"}`} description={`${grade?.name ?? ""} · topics are the main parts of a subject; sub-topics break them down.`}>
        {dialog?.kind === "topic" && c && subject && <TopicForm c={c} areaId={subject.id} close={close} />}
      </FormDialog>
      <FormDialog open={dialog?.kind === "scale"} onOpenChange={(o) => { if (!o) close(); }} size="lg" title="Create a rating scale" description="Bands must run from 0 to 100% with no gaps or overlaps.">
        {dialog?.kind === "scale" && <ScaleForm close={close} />}
      </FormDialog>
      <FormDialog open={dialog?.kind === "grade-scale"} onOpenChange={(o) => { if (!o) close(); }} title={`Rating scale for ${grade?.name ?? ""}`}>
        {dialog?.kind === "grade-scale" && c && grade && <GradeScaleForm c={c} gradeId={grade.id} gradeName={grade.name} close={close} onNew={() => setDialog({ kind: "scale" })} />}
      </FormDialog>
      {p.academicAdmin && c && <FormDialog open={dialog?.kind === "edit"} onOpenChange={(o) => { if (!o) close(); }} size={dialog?.kind === "edit" && dialog.target.kind === "scale" ? "lg" : "md"}
        title={dialog?.kind === "edit" ? ({ "learning-area": "Edit subject", strand: "Edit topic", scale: "Edit rating scale" } as Record<string, string>)[dialog.target.kind] : "Edit"}>
        {dialog?.kind === "edit" && <CurriculumEditor key={dialog.target.id} t={dialog.target} c={c} senior={!!grade?.levelBand.startsWith("senior")} close={close} />}
      </FormDialog>}
    </div>
  );
}

