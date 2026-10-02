import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  useListAcademicYears, useCreateAcademicYear, useUpdateAcademicYear, useListTerms, useCreateTerm, useUpdateTerm,
  useListGrades, useCreateGrade, useUpdateGrade, useListStreams, useCreateStream, useUpdateStream, useListUsers,
  getListAcademicYearsQueryKey, getListTermsQueryKey, getListGradesQueryKey, getListStreamsQueryKey, getListUsersQueryKey, getGetDashboardSummaryQueryKey, getListStudentsQueryKey,
  LevelBand, type AcademicYear, type Term, type Grade, type Stream,
} from "@workspace/api-client-react";
import { CalendarRange, Check, Layers, Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

function useInv() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

function Inline({ children, onSubmit, pending, err, label, onCancel }: { children: ReactNode; onSubmit: () => void; pending: boolean; err: string | null; label: string; onCancel: () => void }) {
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }} className="space-y-4 border-b border-border/70 bg-accent/20 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" disabled={pending} data-testid={`button-${label.toLowerCase().replace(/\s/g, "-")}`}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</Btn>
        <Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function PeriodForm({ initial, label, pending, err, onSubmit, onCancel, extra }: { initial: { name: string; startDate: string; endDate: string; isCurrent: boolean }; label: string; pending: boolean; err: string | null; onSubmit: (v: typeof initial) => void; onCancel: () => void; extra?: ReactNode }) {
  const [v, setV] = useState(initial);
  return (
    <Inline label={label} pending={pending} err={err} onCancel={onCancel} onSubmit={() => onSubmit(v)}>
      {extra}
      <Field label="Name" required><TextInput data-testid="input-period-name" required minLength={2} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Starts" required><TextInput data-testid="input-start" type="date" required value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field>
      <Field label="Ends" required><TextInput data-testid="input-end" type="date" required value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input data-testid="check-current" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={v.isCurrent} onChange={(e) => setV({ ...v, isCurrent: e.target.checked })} /> Mark as current</label>
    </Inline>
  );
}

function Years() {
  const q = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const create = useCreateAcademicYear();
  const upd = useUpdateAcademicYear();
  const inv = useInv();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | AcademicYear | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const yr = new Date().getFullYear();
  const done = () => { inv(getListAcademicYearsQueryKey(), getListTermsQueryKey(), getGetDashboardSummaryQueryKey()); setMode(null); setErr(null); };
  return (
    <Panel title="Academic years" note="One year is current at a time." action={!mode && <Btn variant="outline" className="h-8" data-testid="button-new-year" onClick={() => setMode("new")}><Plus className="h-3.5 w-3.5" /> Year</Btn>}>
      {mode === "new" && <PeriodForm label="Create year" initial={{ name: String(yr), startDate: `${yr}-01-06`, endDate: `${yr}-11-28`, isCurrent: !q.data?.length }} pending={create.isPending} err={err} onCancel={() => setMode(null)}
        onSubmit={(v) => create.mutate({ data: v }, { onSuccess: () => { toast({ title: "Academic year created" }); done(); }, onError: (x) => setErr(errMsg(x)) })} />}
      {mode && mode !== "new" && <PeriodForm key={mode.id} label="Save year" initial={{ name: mode.name, startDate: mode.startDate.slice(0, 10), endDate: mode.endDate.slice(0, 10), isCurrent: mode.isCurrent }} pending={upd.isPending} err={err} onCancel={() => setMode(null)}
        onSubmit={(v) => upd.mutate({ yearId: mode.id, data: v }, { onSuccess: () => { toast({ title: "Academic year updated" }); done(); }, onError: (x) => setErr(errMsg(x)) })} />}
      {q.isLoading ? <SkeletonRows rows={2} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<CalendarRange className="h-5 w-5" />} title="No academic year" body="Start with the current calendar year — Kenyan schools typically run January to November." /> : (
        <ul className="divide-y divide-border/60">{q.data.map((y) => (
          <li key={y.id} data-testid={`row-year-${y.id}`} className="group flex items-center gap-3 px-5 py-3">
            <span className="font-display text-xl font-semibold">{y.name}</span>{y.isCurrent && <Pill tone="current">Current</Pill>}
            <span className="ml-auto font-mono text-xs text-muted-foreground">{fmtDate(y.startDate)} – {fmtDate(y.endDate)}</span>
            <button data-testid={`button-edit-year-${y.id}`} onClick={() => setMode(y)} className="rounded p-1.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
          </li>))}</ul>
      )}
    </Panel>
  );
}

function Terms() {
  const years = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const [yearId, setYearId] = useState("");
  const params = yearId ? { academicYearId: yearId } : undefined;
  const q = useListTerms(params, { query: { queryKey: getListTermsQueryKey(params) } });
  const create = useCreateTerm();
  const upd = useUpdateTerm();
  const inv = useInv();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | Term | null>(null);
  const [newYear, setNewYear] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = () => { inv(getListTermsQueryKey(), getGetDashboardSummaryQueryKey()); setMode(null); setErr(null); };
  const defaultYear = years.data?.find((y) => y.isCurrent)?.id ?? years.data?.[0]?.id ?? "";
  return (
    <Panel title="Terms" note="Usually three per year." action={<div className="flex gap-2">
      <NativeSelect data-testid="filter-term-year" value={yearId} onChange={(e) => setYearId(e.target.value)} className="h-8 w-32 text-xs"><option value="">All years</option>{years.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</NativeSelect>
      {!mode && <Btn variant="outline" className="h-8" data-testid="button-new-term" disabled={!years.data?.length} onClick={() => { setNewYear(yearId || defaultYear); setMode("new"); }}><Plus className="h-3.5 w-3.5" /> Term</Btn>}
    </div>}>
      {mode === "new" && <PeriodForm label="Create term" initial={{ name: `Term ${(q.data?.length ?? 0) + 1}`, startDate: "", endDate: "", isCurrent: false }} pending={create.isPending} err={err} onCancel={() => setMode(null)}
        extra={<Field label="Academic year" required><NativeSelect data-testid="select-term-year" value={newYear} onChange={(e) => setNewYear(e.target.value)}>{years.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</NativeSelect></Field>}
        onSubmit={(v) => create.mutate({ data: { ...v, academicYearId: newYear } }, { onSuccess: () => { toast({ title: "Term created" }); done(); }, onError: (x) => setErr(errMsg(x)) })} />}
      {mode && mode !== "new" && <PeriodForm key={mode.id} label="Save term" initial={{ name: mode.name, startDate: mode.startDate.slice(0, 10), endDate: mode.endDate.slice(0, 10), isCurrent: mode.isCurrent }} pending={upd.isPending} err={err} onCancel={() => setMode(null)}
        onSubmit={(v) => upd.mutate({ termId: mode.id, data: v }, { onSuccess: () => { toast({ title: "Term updated" }); done(); }, onError: (x) => setErr(errMsg(x)) })} />}
      {q.isLoading ? <SkeletonRows rows={3} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<CalendarRange className="h-5 w-5" />} title="No terms" body={years.data?.length ? "Add Term 1, 2 and 3 for the current year." : "Create an academic year first."} /> : (
        <ul className="divide-y divide-border/60">{q.data.map((t) => (
          <li key={t.id} data-testid={`row-term-${t.id}`} className="group flex items-center gap-3 px-5 py-3">
            <span className="font-semibold">{t.name}</span><span className="text-xs text-muted-foreground">{t.academicYearName}</span>{t.isCurrent && <Pill tone="current">Current</Pill>}
            <span className="ml-auto font-mono text-xs text-muted-foreground">{fmtDate(t.startDate)} – {fmtDate(t.endDate)}</span>
            <button data-testid={`button-edit-term-${t.id}`} onClick={() => setMode(t)} className="rounded p-1.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
          </li>))}</ul>
      )}
    </Panel>
  );
}

const BAND_LABEL: Record<string, string> = { pre_primary: "Pre-primary", lower_primary: "Lower primary", upper_primary: "Upper primary", junior: "Junior school", senior: "Senior school", other: "Other" };

function GradesStreams() {
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const cg = useCreateGrade();
  const cs = useCreateStream();
  const ug = useUpdateGrade();
  const us = useUpdateStream();
  const [editId, setEditId] = useState<string | null>(null);
  const editGrade = (x: Grade) => { setG({ name: x.name, levelBand: x.levelBand, order: String(x.order) }); setEditId(x.id); setErr(null); setMode("grade"); };
  const editStream = (x: Stream) => { setS({ gradeId: x.gradeId, name: x.name, classTeacherUserId: x.classTeacherUserId ?? "" }); setEditId(x.id); setErr(null); setMode("stream"); };
  const inv = useInv();
  const { toast } = useToast();
  const [mode, setMode] = useState<"grade" | "stream" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [g, setG] = useState({ name: "", levelBand: "lower_primary" as LevelBand, order: "" });
  const [s, setS] = useState({ gradeId: "", name: "", classTeacherUserId: "" });
  const teachers = users.data?.filter((u) => u.isActive && (u.role === "class_teacher" || u.role === "teacher")) ?? [];
  const done = () => { inv(getListGradesQueryKey(), getListStreamsQueryKey(), getGetDashboardSummaryQueryKey()); setMode(null); setErr(null); setEditId(null); };
  const cancel = () => { setMode(null); setEditId(null); setErr(null); };

  return (
    <Panel title="Grades & streams" note="Grades in teaching order; streams split a grade into classes." action={!mode && <div className="flex gap-2">
      <Btn variant="outline" className="h-8" data-testid="button-new-grade" onClick={() => { setG({ name: "", levelBand: "lower_primary", order: String((grades.data?.length ?? 0) + 1) }); setMode("grade"); }}><Plus className="h-3.5 w-3.5" /> Grade</Btn>
      <Btn variant="outline" className="h-8" data-testid="button-new-stream" disabled={!grades.data?.length} onClick={() => { setS({ gradeId: grades.data?.[0]?.id ?? "", name: "", classTeacherUserId: "" }); setMode("stream"); }}><Plus className="h-3.5 w-3.5" /> Stream</Btn>
    </div>}>
      {mode === "grade" && <Inline label={editId ? "Save grade" : "Create grade"} pending={cg.isPending || ug.isPending} err={err} onCancel={cancel} onSubmit={() => {
        const data = { name: g.name.trim(), levelBand: g.levelBand, order: Number(g.order) || 1 };
        const opts = { onSuccess: () => { toast({ title: editId ? "Grade updated" : "Grade created" }); inv(getListStudentsQueryKey()); done(); }, onError: (x: unknown) => setErr(errMsg(x)) };
        if (editId) ug.mutate({ gradeId: editId, data }, opts); else cg.mutate({ data }, opts);
      }}>
        <Field label="Name" required><TextInput data-testid="input-grade-name" required minLength={2} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Grade 4" /></Field>
        <Field label="Level band"><NativeSelect data-testid="select-band" value={g.levelBand} onChange={(e) => setG({ ...g, levelBand: e.target.value as LevelBand })}>{Object.values(LevelBand).map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}</NativeSelect></Field>
        <Field label="Order" required><TextInput data-testid="input-grade-order" type="number" min={1} required value={g.order} onChange={(e) => setG({ ...g, order: e.target.value })} /></Field>
      </Inline>}
      {mode === "stream" && <Inline label={editId ? "Save stream" : "Create stream"} pending={cs.isPending || us.isPending} err={err} onCancel={cancel} onSubmit={() => {
        const data = { gradeId: s.gradeId, name: s.name.trim(), classTeacherUserId: s.classTeacherUserId || null };
        const opts = { onSuccess: () => { toast({ title: editId ? "Stream updated" : "Stream created" }); inv(getListStudentsQueryKey()); done(); }, onError: (x: unknown) => setErr(errMsg(x)) };
        if (editId) us.mutate({ streamId: editId, data }, opts); else cs.mutate({ data }, opts);
      }}>
        <Field label="Grade" required><NativeSelect data-testid="select-stream-grade" value={s.gradeId} onChange={(e) => setS({ ...s, gradeId: e.target.value })}>{grades.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
        <Field label="Stream name" required><TextInput data-testid="input-stream-name" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="East" /></Field>
        <Field label="Class teacher" hint={teachers.length ? undefined : "Add teachers in Staff"}><NativeSelect data-testid="select-class-teacher" value={s.classTeacherUserId} onChange={(e) => setS({ ...s, classTeacherUserId: e.target.value })}><option value="">None yet</option>{teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
      </Inline>}
      {grades.isLoading ? <SkeletonRows rows={4} cols={3} /> : grades.isError ? <ErrorState msg={errMsg(grades.error)} onRetry={() => grades.refetch()} /> : !grades.data?.length ? <Empty icon={<Layers className="h-5 w-5" />} title="No grades yet" body="Create grades from PP1 upward, then add streams such as East, West or Blue." /> : (
        <ul className="divide-y divide-border/60">{[...grades.data].sort((a, b) => a.order - b.order).map((gr) => {
          const ss = streams.data?.filter((x) => x.gradeId === gr.id) ?? [];
          return (
            <li key={gr.id} data-testid={`row-grade-${gr.id}`} className="grid gap-2 px-5 py-3 md:grid-cols-[2.5rem_1fr_2fr] md:items-center">
              <span className="font-mono text-xs text-muted-foreground">{String(gr.order).padStart(2, "0")}</span>
              <div className="group/g flex items-start gap-1"><div><div className="font-semibold">{gr.name}</div><div className="text-[11px] text-muted-foreground">{BAND_LABEL[gr.levelBand]} · {gr.studentCount} learners</div></div><button data-testid={`button-edit-grade-${gr.id}`} title="Edit grade" onClick={() => editGrade(gr)} className="rounded p-1 text-muted-foreground opacity-50 hover:bg-muted hover:text-foreground group-hover/g:opacity-100"><Pencil className="h-3 w-3" /></button></div>
              <div className="flex flex-wrap gap-1.5">{ss.length === 0 ? <span className="text-xs text-muted-foreground">Single class</span> : ss.map((x) => (
                <button key={x.id} data-testid={`button-edit-stream-${x.id}`} title="Edit stream / reassign class teacher" onClick={() => editStream(x)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1 text-xs transition hover:border-primary/50 hover:bg-accent/40"><span className="font-semibold">{x.name}</span><span className="text-muted-foreground">{x.studentCount}</span>{x.classTeacherName && <span className="border-l border-border pl-1.5 text-muted-foreground">{x.classTeacherName}</span>}<Pencil className="h-2.5 w-2.5 text-muted-foreground" /></button>
              ))}</div>
            </li>);
        })}</ul>
      )}
    </Panel>
  );
}

export default function Academics() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="School calendar & classes" title="Academics" meta={<span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-primary" /> Structure used for admission and import matching</span>} />
      <div className="grid gap-6 lg:grid-cols-2"><Years /><Terms /></div>
      <GradesStreams />
    </div>
  );
}
