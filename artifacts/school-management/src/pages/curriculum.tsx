import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCurriculum, useSaveCurriculum, useSeedCurriculumScales, useListGrades, useListStreams, useListUsers, useListTerms,
  getGetCurriculumQueryKey, getListGradesQueryKey, getListStreamsQueryKey, getListUsersQueryKey, getListTermsQueryKey,
  type CurriculumInput, type CurriculumInputLevelsItem, type CurriculumView,
} from "@workspace/api-client-react";
import { BookOpen, Loader2, Plus, Sprout } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { GradeSelect, TermSelect, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg } from "@/lib/session";
import { MONEY_RE, toCents } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { CurriculumEditor, type EditTarget } from "@/components/curriculum-edit";
import { FormDialog } from "@/components/form-dialog";

export function useCurriculum() { return useGetCurriculum({ query: { queryKey: getGetCurriculumQueryKey() } }); }

/** One continuous create form; posts a curriculum input and refreshes the tree. */
function useSave(onDone: () => void) {
  const m = useSaveCurriculum(); const qc = useQueryClient(); const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const save = (data: CurriculumInput, title: string) => { setErr(null); m.mutate({ data }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title }); onDone(); },
    onError: (x) => setErr(errMsg(x)) }); };
  return { save, err, setErr, pending: m.isPending };
}

function Adder({ label, title, description, size = "md", children }: { label: string; title: string; description?: string; size?: "md" | "lg"; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="border-t border-border/70 px-5 py-3"><Btn variant="ghost" className="h-8" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />{label}</Btn>
    <FormDialog open={open} onOpenChange={setOpen} size={size} title={title} description={description}>{children(() => setOpen(false))}</FormDialog></div>;
}

function Actions({ pending, close, label }: { pending: boolean; close: () => void; label: string }) {
  return <FormActions><Btn type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</Btn><Btn type="button" variant="ghost" onClick={close}>Cancel</Btn></FormActions>;
}

function AreaForm({ close }: { close: () => void }) {
  const s = useSave(close); const [f, setF] = useState({ gradeId: "", name: "", code: "" });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.gradeId || !f.name.trim() || !f.code.trim()) return s.setErr("Grade, name and code are required."); s.save({ kind: "learning_area", gradeId: f.gradeId, name: f.name.trim(), code: f.code.trim().toUpperCase() }, "Learning area added"); };
  return <form onSubmit={submit} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} /><Field label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Mathematics" /></Field><Field label="Code" required><TextInput className="font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MATH" /></Field></div><FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Add learning area" /></form>;
}

function StrandForm({ c, close }: { c: CurriculumView; close: () => void }) {
  const s = useSave(close); const [f, setF] = useState({ learningAreaId: "", parentId: "", name: "", order: "1" });
  const tops = c.strands.filter((x) => x.learningAreaId === f.learningAreaId && !x.parentId);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.learningAreaId || !f.name.trim()) return s.setErr("Learning area and name are required.");
    s.save({ kind: f.parentId ? "sub_strand" : "strand", learningAreaId: f.learningAreaId, ...(f.parentId ? { parentId: f.parentId } : {}), name: f.name.trim(), order: Number(f.order) || 1 }, f.parentId ? "Sub-strand added" : "Strand added"); };
  return <form onSubmit={submit} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Learning area" required><NativeSelect value={f.learningAreaId} onChange={(e) => setF({ ...f, learningAreaId: e.target.value, parentId: "" })}><option value="">Select</option>{c.learningAreas.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}</NativeSelect></Field>
    <Field label="Under strand" hint="Leave blank for a top-level strand"><NativeSelect value={f.parentId} disabled={!tops.length} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Top-level strand</option>{tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
    <Field label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Order" required><TextInput type="number" min={1} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} /></Field>
  </div><FormError msg={s.err} /><Actions pending={s.pending} close={close} label={f.parentId ? "Add sub-strand" : "Add strand"} /></form>;
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

function GradeScaleForm({ c, close }: { c: CurriculumView; close: () => void }) {
  const s = useSave(close); const [f, setF] = useState({ gradeId: "", scaleId: "" });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.gradeId || !f.scaleId) return s.setErr("Choose grade and scale."); s.save({ kind: "grade_scale", ...f }, "Grade scale set"); };
  return <form onSubmit={submit} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} /><Field label="Scale" required><NativeSelect value={f.scaleId} onChange={(e) => setF({ ...f, scaleId: e.target.value })}><option value="">Select</option>{c.scales.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.levels.length} levels)</option>)}</NativeSelect></Field></div><FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Set scale" /></form>;
}

function AssignForm({ c, close }: { c: CurriculumView; close: () => void }) {
  const s = useSave(close); const [f, setF] = useState({ userId: "", streamId: "", learningAreaId: "", termId: "" });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const stream = streams.data?.find((x) => x.id === f.streamId);
  const areas = c.learningAreas.filter((a) => !stream || a.gradeId === stream.gradeId);
  const submit = (e: FormEvent) => { e.preventDefault(); if (Object.values(f).some((v) => !v)) return s.setErr("Choose teacher, stream, learning area and term."); s.save({ kind: "assignment", ...f }, "Teacher assigned"); };
  return <form onSubmit={submit} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Teacher" required><NativeSelect value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Select</option>{(users.data ?? []).filter((u) => u.isActive && ["teacher", "class_teacher"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
    <Field label="Stream" required><NativeSelect value={f.streamId} onChange={(e) => setF({ ...f, streamId: e.target.value, learningAreaId: "" })}><option value="">Select</option>{streams.data?.map((x) => <option key={x.id} value={x.id}>{x.gradeName} {x.name}</option>)}</NativeSelect></Field>
    <Field label="Learning area" required><NativeSelect value={f.learningAreaId} disabled={!stream} onChange={(e) => setF({ ...f, learningAreaId: e.target.value })}><option value="">{stream ? "Select" : "Choose stream first"}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
    <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
  </div><FormError msg={s.err} /><Actions pending={s.pending} close={close} label="Assign teacher" /></form>;
}

export default function Curriculum() {
  const p = usePerms();
  const q = useCurriculum();
  const seed = useSeedCurriculumScales(); const qc = useQueryClient(); const { toast } = useToast();
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey(), enabled: p.academicAdmin } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: p.academicAdmin } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const [area, setArea] = useState("");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const ed = (kind: EditTarget["kind"], id: string) => p.academicAdmin ? <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setEditing({ kind, id }); }}>Edit</button> : null;
    const c = q.data;
  const gname = useMemo(() => new Map(grades.data?.map((g) => [g.id, g.name])), [grades.data]);
  const aname = useMemo(() => new Map(c?.learningAreas.map((a) => [a.id, a.name])), [c]);
  const shown = area || c?.learningAreas[0]?.id || "";
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academics" title="Curriculum" meta={p.academicAdmin ? "Learning areas, strands, performance scales and teacher assignments. Edit any entry; scale edits keep history for existing assessments." : "Read-only. Teachers see the learning areas and assignments given to them."}>
        {p.academicAdmin && <Btn variant="outline" disabled={seed.isPending} data-testid="button-seed-scales" onClick={() => seed.mutate(undefined, { onSuccess: (r) => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title: "CBC scales seeded", description: r.message ?? "Grades, learning areas, strands, starter sub-strands, 4- and 8-level scales and pathways added. Existing edits kept. These are editable planning starters, not the official KICD syllabus." }); }, onError: (x) => toast({ title: "Seeding failed", description: errMsg(x), variant: "destructive" }) })}>{seed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sprout className="h-4 w-4" />}Seed CBC starters</Btn>}
      </PageHeader>
      {q.isLoading ? <Panel><SkeletonRows cols={3} /></Panel> : q.isError ? <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel> : !c ? null : <>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Learning areas">
            {!c.learningAreas.length ? <Empty icon={<BookOpen className="h-5 w-5" />} title="No learning areas" body="Add Mathematics, English, Kiswahili and others per grade." /> : (
              <Table head={["Grade", "Learning area", "Code", "Strands", ""]}>{[...c.learningAreas].sort((a, b) => (gname.get(a.gradeId) ?? "").localeCompare(gname.get(b.gradeId) ?? "")).map((a) => (
                <tr key={a.id} className={`cursor-pointer ${shown === a.id ? "bg-primary/5" : ""}`} onClick={() => setArea(a.id)}><td className={`${td} text-xs`}>{gname.get(a.gradeId) ?? "Grade"}</td><td className={td}>{a.name}</td><td className={`${td} font-mono text-xs`}>{a.code}</td><td className={td}>{c.strands.filter((s) => s.learningAreaId === a.id && !s.parentId).length}</td><td className={td}>{ed("learning-area", a.id)}</td></tr>))}</Table>
            )}
                        {p.academicAdmin && <Adder label="Add learning area" title="Add a learning area">{(close) => <AreaForm close={close} />}</Adder>}
          </Panel>
          <Panel title={`Strands${shown ? ` · ${aname.get(shown) ?? ""}` : ""}`} note="Select a learning area to see its strands and sub-strands.">
            {!c.strands.some((s) => s.learningAreaId === shown) ? <p className="p-5 text-sm text-muted-foreground">No strands yet.</p> : (
              <ol className="space-y-2 p-5 text-sm">{c.strands.filter((s) => s.learningAreaId === shown && !s.parentId).sort((a, b) => a.order - b.order).map((s) => (
                <li key={s.id}><span className="font-semibold">{s.order}. {s.name}</span> {ed("strand", s.id)}<ul className="ml-5 mt-1 list-disc text-muted-foreground">{c.strands.filter((x) => x.parentId === s.id).sort((a, b) => a.order - b.order).map((x) => <li key={x.id}>{x.name} {ed("strand", x.id)}</li>)}</ul></li>))}</ol>
            )}
                        {p.academicAdmin && <Adder label="Add strand or sub-strand" title="Add a strand or sub-strand">{(close) => <StrandForm c={c} close={close} />}</Adder>}
          </Panel>
        </div>
        <Panel title="Performance scales" note="Percentage bands map marks to levels. Each grade uses one scale.">
          {!c.scales.length ? <Empty icon={<Sprout className="h-5 w-5" />} title="No scales" body="Seed the CBC 4- and 8-level scales or define your own." /> : (
            <div className="grid gap-4 p-5 md:grid-cols-2">{c.scales.map((s) => (
              <div key={s.id} className="min-w-0 rounded-md border border-border/70">
                <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2"><span className="font-semibold">{s.name}</span><Pill tone="current">{s.levels.length} levels</Pill>{ed("scale", s.id)}<span className="ml-auto text-xs text-muted-foreground">{c.gradeScales.filter((g) => g.scaleId === s.id).map((g) => gname.get(g.gradeId)).filter(Boolean).join(", ") || "No grades"}</span></div>
                <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{[...s.levels].sort((a, b) => a.order - b.order).map((l) => <tr key={l.id} className="border-b border-border/40 last:border-0"><td className="px-3 py-1 font-mono font-semibold">{l.code}</td><td className="px-3 py-1">{l.label}</td><td className="px-3 py-1 tabular-nums">{l.minPercent}–{l.maxPercent}%</td><td className="px-3 py-1 tabular-nums">{l.points} pts</td></tr>)}</tbody></table></div>
              </div>))}</div>
          )}
                    {p.academicAdmin && <Adder label="New scale" title="Create a performance scale" description="Bands must run 0 to 100 with no gaps or overlaps." size="lg">{(close) => <ScaleForm close={close} />}</Adder>}
          {p.academicAdmin && c.scales.length > 0 && <Adder label="Assign scale to grade" title="Assign a scale to a grade">{(close) => <GradeScaleForm c={c} close={close} />}</Adder>}
        </Panel>
        <Panel title="Subject teaching assignments" note="Teachers only see and mark learners in the streams and learning areas assigned to them.">
          {!c.assignments.length ? <p className="p-5 text-sm text-muted-foreground">No assignments.</p> : (
            <Table head={["Teacher", "Stream", "Learning area", "Term", ""]}>{c.assignments.map((a) => { const st = streams.data?.find((x) => x.id === a.streamId); const t = terms.data?.find((x) => x.id === a.termId); return (
              <tr key={a.id}><td className={td}>{users.data?.find((u) => u.id === a.userId)?.name ?? (p.academicAdmin ? "Teacher" : "You")}</td><td className={td}>{st ? `${st.gradeName} ${st.name}` : "Stream"}</td><td className={td}>{aname.get(a.learningAreaId) ?? "Learning area"}</td><td className={`${td} text-xs`}>{t ? `${t.name} ${t.academicYearName}` : "Term"}</td><td className={td}>{ed("assignment", a.id)}</td></tr>); })}</Table>
          )}
                    {p.academicAdmin && <Adder label="Assign teacher" title="Assign a subject teacher" description="Teachers only see and mark learners in the streams and learning areas assigned to them.">{(close) => <AssignForm c={c} close={close} />}</Adder>}
        </Panel>
      </>}
      {p.academicAdmin && c && <FormDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} size={editing?.kind === "scale" ? "lg" : "md"} title={editing ? `Edit ${editing.kind.replace("-", " ")}` : "Edit"}>
        {editing && <CurriculumEditor key={editing.id} t={editing} c={c} close={() => setEditing(null)} />}
      </FormDialog>}
    </div>
  );
}
