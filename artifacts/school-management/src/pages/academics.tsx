import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  useListAcademicYears, useCreateAcademicYear, useUpdateAcademicYear, useListTerms, useCreateTerm, useUpdateTerm,
  useListGrades, useCreateGrade, useUpdateGrade, useListStreams, useCreateStream, useUpdateStream, useDeleteGrade, useDeleteStream, useListUsers,
  getListAcademicYearsQueryKey, getListTermsQueryKey, getListGradesQueryKey, getListStreamsQueryKey, getListUsersQueryKey, getGetDashboardSummaryQueryKey, getListStudentsQueryKey,
  LevelBand, type AcademicYear, type Term, type Grade, type Stream,
} from "@workspace/api-client-react";
import { ChevronRight, Layers, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClassesStep } from "@/pages/term-setup";
import { FormDialog } from "@/components/form-dialog";

function useInv() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

function Inline({ children, onSubmit, pending, err, label, onCancel }: { children: ReactNode; onSubmit: () => void; pending: boolean; err: string | null; label: string; onCancel: () => void }) {
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
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
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input data-testid="check-current" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={v.isCurrent} onChange={(e) => setV({ ...v, isCurrent: e.target.checked })} /> Mark as current</label>
    </Inline>
  );
}

const BAND_LABEL: Record<string, string> = { pre_primary: "Pre-primary", lower_primary: "Lower primary", upper_primary: "Upper primary", junior: "Junior school", senior: "Senior school", other: "Other" };

/** Grades in teaching order, folded by default. A grade with classes opens to list them; a class (or a grade with none) opens its own page. */
export function GradesStreams() {
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const cg = useCreateGrade();
  const cs = useCreateStream();
  const ug = useUpdateGrade();
  const us = useUpdateStream();
  const dg = useDeleteGrade();
  const ds = useDeleteStream();
  const [del, setDel] = useState<{ kind: "grade" | "stream"; id: string; label: string } | null>(null);
  const removing = dg.isPending || ds.isPending;
  const [, navigate] = useLocation();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
    <Panel title="Grades and classes" action={<div className="flex gap-2">
      <Btn variant="outline" className="h-8" data-testid="button-new-grade" onClick={() => { setEditId(null); setErr(null); setG({ name: "", levelBand: "lower_primary", order: String((grades.data?.length ?? 0) + 1) }); setMode("grade"); }}><Plus className="h-3.5 w-3.5" /> Grade</Btn>
      <Btn variant="outline" className="h-8" data-testid="button-new-stream" disabled={!grades.data?.length} onClick={() => { setEditId(null); setErr(null); setS({ gradeId: grades.data?.[0]?.id ?? "", name: "", classTeacherUserId: "" }); setMode("stream"); }}><Plus className="h-3.5 w-3.5" /> Class</Btn>
    </div>}>
      <FormDialog phonePage open={!!mode} onOpenChange={(o) => { if (!o) cancel(); }} busy={cg.isPending || ug.isPending || cs.isPending || us.isPending}
        title={mode === "grade" ? (editId ? "Edit grade" : "Add a grade") : editId ? "Edit class" : "Add a class"}
        description={mode === "grade" ? "Grades are listed in teaching order." : "A class is one stream of a grade, e.g. Grade 4 East."}>
      {mode === "grade" && <Inline label={editId ? "Save grade" : "Create grade"} pending={cg.isPending || ug.isPending} err={err} onCancel={cancel} onSubmit={() => {
        const data = { name: g.name.trim(), levelBand: g.levelBand, order: Number(g.order) || 1 };
        const opts = { onSuccess: () => { toast({ title: editId ? "Grade updated" : "Grade created" }); inv(getListStudentsQueryKey()); done(); }, onError: (x: unknown) => setErr(errMsg(x)) };
        if (editId) ug.mutate({ gradeId: editId, data }, opts); else cg.mutate({ data }, opts);
      }}>
        <Field label="Name" required><TextInput data-testid="input-grade-name" required minLength={2} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Grade 4" /></Field>
        <Field label="Level band"><NativeSelect data-testid="select-band" value={g.levelBand} onChange={(e) => setG({ ...g, levelBand: e.target.value as LevelBand })}>{Object.values(LevelBand).map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}</NativeSelect></Field>
        <Field label="Order" required><TextInput data-testid="input-grade-order" type="number" min={1} required value={g.order} onChange={(e) => setG({ ...g, order: e.target.value })} /></Field>
      </Inline>}
      {mode === "stream" && <Inline label={editId ? "Save class" : "Add class"} pending={cs.isPending || us.isPending} err={err} onCancel={cancel} onSubmit={() => {
        const data = { gradeId: s.gradeId, name: s.name.trim(), classTeacherUserId: s.classTeacherUserId || null };
        const opts = { onSuccess: () => { toast({ title: editId ? "Class saved" : "Class added" }); inv(getListStudentsQueryKey()); done(); }, onError: (x: unknown) => setErr(errMsg(x)) };
        if (editId) us.mutate({ streamId: editId, data }, opts); else cs.mutate({ data }, opts);
      }}>
        <Field label="Grade" required><NativeSelect data-testid="select-stream-grade" value={s.gradeId} onChange={(e) => setS({ ...s, gradeId: e.target.value })}>{grades.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
        <Field label="Class (stream) name" required><TextInput data-testid="input-stream-name" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="East" /></Field>
        <Field label="Class teacher" hint={teachers.length ? undefined : "Add teachers in Staff"}><NativeSelect data-testid="select-class-teacher" value={s.classTeacherUserId} onChange={(e) => setS({ ...s, classTeacherUserId: e.target.value })}><option value="">None yet</option>{teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
      </Inline>}
      </FormDialog>
      <FormDialog open={!!del} onOpenChange={(o) => { if (!o && !removing) setDel(null); }} busy={removing} size="sm"
        title={del?.kind === "grade" ? `Delete ${del.label}?` : `Delete class ${del?.label ?? ""}?`}
        description={del?.kind === "grade" ? "The grade and its starter curriculum are removed. A grade with classes, learners, assessments or fees cannot be deleted." : "A class with learners, attendance or subject teachers cannot be deleted."}>
        <div className="space-y-4 p-5">
          <FormError msg={err} />
          <FormActions>
            <Btn variant="danger" disabled={removing} data-testid="button-confirm-delete" onClick={() => {
              if (!del) return;
              const opts = { onSuccess: () => { toast({ title: del.kind === "grade" ? "Grade deleted" : "Class deleted" }); inv(getListStudentsQueryKey()); done(); setDel(null); }, onError: (x: unknown) => setErr(errMsg(x)) };
              if (del.kind === "grade") dg.mutate({ gradeId: del.id }, opts); else ds.mutate({ streamId: del.id }, opts);
            }}>{removing && <Loader2 className="h-4 w-4 animate-spin" />}Delete</Btn>
            <Btn variant="ghost" disabled={removing} onClick={() => setDel(null)}>Keep</Btn>
          </FormActions>
        </div>
      </FormDialog>
      {grades.isLoading ? <SkeletonRows rows={4} cols={3} /> : grades.isError ? <ErrorState msg={errMsg(grades.error)} onRetry={() => grades.refetch()} /> : !grades.data?.length ? <Empty icon={<Layers className="h-5 w-5" />} title="No grades yet" body="Add grades from PP1 upward, then classes such as East, West or Blue." /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-5 py-2.5 font-medium">Grade</th><th className="px-3 py-2.5 font-medium">Classes</th><th className="px-3 py-2.5 font-medium">Class teacher</th><th className="px-3 py-2.5 text-right font-medium">Learners</th><th className="w-20 px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>{[...grades.data].sort((a, b) => a.order - b.order).map((gr) => {
              const ss = streams.data?.filter((x) => x.gradeId === gr.id) ?? [];
              const isOpen = open.has(gr.id);
              const addClass = () => { setEditId(null); setErr(null); setS({ gradeId: gr.id, name: "", classTeacherUserId: "" }); setMode("stream"); };
              // A grade with classes folds open; one without is itself the class and opens its page.
              const activate = () => ss.length ? toggle(gr.id) : navigate(`/classes/grade/${gr.id}`);
              return (
                <Fragment key={gr.id}>
                  <tr data-testid={`row-grade-${gr.id}`} className="cursor-pointer border-b border-border/60 hover:bg-muted/30" onClick={activate}>
                    <td className="px-5 py-3">
                      <button type="button" className="flex items-center gap-2 text-left font-semibold" aria-expanded={ss.length ? isOpen : undefined} onClick={(e) => { e.stopPropagation(); activate(); }} data-testid={`button-open-grade-${gr.id}`}>
                        {ss.length ? <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} /> : <span className="w-4" />}
                        {gr.name}
                      </button>
                      <span className="ml-6 block text-xs text-muted-foreground">{BAND_LABEL[gr.levelBand] ?? gr.levelBand}</span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{ss.length ? `${ss.length} ${ss.length === 1 ? "class" : "classes"}` : "Single class"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{ss.length === 1 ? ss[0].classTeacherName ?? "Not set" : ss.length ? "" : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{gr.studentCount}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${gr.name}`} data-testid={`button-actions-grade-${gr.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onSelect={addClass} data-testid={`button-add-stream-${gr.id}`}><Plus className="h-4 w-4" />Add a class</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => editGrade(gr)} data-testid={`button-edit-grade-${gr.id}`}><Pencil className="h-4 w-4" />Rename {gr.name}</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => { setErr(null); setDel({ kind: "grade", id: gr.id, label: gr.name }); }} className="text-destructive focus:text-destructive" data-testid={`button-delete-grade-${gr.id}`}><Trash2 className="h-4 w-4" />Delete {gr.name}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {isOpen && ss.map((x) => (
                    <tr key={x.id} data-testid={`row-stream-${x.id}`} className="cursor-pointer border-b border-border/40 bg-muted/15 hover:bg-muted/40" onClick={() => navigate(`/classes/stream/${x.id}`)}>
                      <td className="py-2.5 pl-11 pr-3"><Link href={`/classes/stream/${x.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline" data-testid={`link-stream-${x.id}`}>{gr.name} {x.name}</Link></td>
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5">{x.classTeacherName ?? <span className="text-muted-foreground">Not set</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{x.studentCount}</td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <button type="button" onClick={() => editStream(x)} aria-label={`Edit ${gr.name} ${x.name} or its class teacher`} data-testid={`button-edit-stream-${x.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => { setErr(null); setDel({ kind: "stream", id: x.id, label: `${gr.name} ${x.name}` }); }} aria-label={`Delete ${gr.name} ${x.name}`} data-testid={`button-delete-stream-${x.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/15"><td colSpan={5} className="py-2 pl-11"><button type="button" onClick={addClass} data-testid={`link-add-stream-${gr.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><Plus className="h-3.5 w-3.5" />Add class to {gr.name}</button></td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** The Classes tab: every class in one table. A school with none starts with the quick level-and-stream setup. */
export default function ClassesPage() {
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  return (
    <div className="space-y-6">
      <PageHeader title="Classes" meta="Your grades, the classes (streams) in each, and their class teachers." />
      {grades.isLoading ? <SkeletonRows rows={4} cols={4} /> : (grades.data?.length ?? 0) > 0 ? <GradesStreams />
        : <Panel title="Add your classes"><div className="p-5"><ClassesStep embedded onNext={() => undefined} /></div></Panel>}
    </div>
  );
}
