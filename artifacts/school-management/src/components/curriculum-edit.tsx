import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditCurriculum, useListUsers, useListStreams, getGetCurriculumQueryKey, getListUsersQueryKey, getListStreamsQueryKey, type CurriculumEditInput, type CurriculumView, type LevelInput } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { TermSelect } from "@/components/finance-kit";
import { errMsg } from "@/lib/session";
import { MONEY_RE, toCents } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

export type EditTarget = { kind: "learning-area" | "strand" | "scale" | "assignment"; id: string };

function useEdit(t: EditTarget, close: () => void) {
  const m = useEditCurriculum(); const qc = useQueryClient(); const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const save = (data: CurriculumEditInput) => { setErr(null); m.mutate({ kind: t.kind, id: t.id, data }, {
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title: "Saved", description: r.message ?? (t.kind === "scale" ? "A new revision is used from now on; existing assessments keep their original scale." : undefined) }); close(); },
    onError: (x) => setErr(errMsg(x)) }); };
  return { save, err, setErr, pending: m.isPending };
}

function Shell({ children, err, pending, close, onSubmit }: { children: ReactNode; err: string | null; pending: boolean; close: () => void; onSubmit: (e: FormEvent) => void }) {
  return <form onSubmit={onSubmit} className="space-y-4 border-t border-dashed border-border bg-accent/20 p-5">{children}<FormError msg={err} />
    <FormActions><Btn type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</Btn><Btn type="button" variant="ghost" onClick={close}>Cancel</Btn></FormActions></form>;
}

export function CurriculumEditor({ t, c, close }: { t: EditTarget; c: CurriculumView; close: () => void }) {
  const e = useEdit(t, close);
  const area = c.learningAreas.find((x) => x.id === t.id);
  const strand = c.strands.find((x) => x.id === t.id);
  const scale = c.scales.find((x) => x.id === t.id);
  const asg = c.assignments.find((x) => x.id === t.id);
  const [f, setF] = useState({ name: area?.name ?? strand?.name ?? scale?.name ?? "", code: area?.code ?? "", order: String(strand?.order ?? 1), core: "", pathway: "",
    userId: asg?.userId ?? "", streamId: asg?.streamId ?? "", learningAreaId: asg?.learningAreaId ?? "", termId: asg?.termId ?? "" });
  const [levels, setLevels] = useState<LevelInput[]>(() => [...(scale?.levels ?? [])].sort((a, b) => a.order - b.order).map((l) => ({ code: l.code, label: l.label, points: l.points, minPercent: l.minPercent, maxPercent: l.maxPercent, order: l.order })));
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: t.kind === "assignment" } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey(), enabled: t.kind === "assignment" } });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (t.kind !== "assignment" && !f.name.trim()) return e.setErr("Name is required.");
    if (t.kind === "learning-area") return e.save({ name: f.name.trim(), code: f.code.trim().toUpperCase(), ...(f.core ? { isCore: f.core === "yes" } : {}), ...(f.pathway === "-" ? { pathway: null } : f.pathway.trim() ? { pathway: f.pathway.trim() } : {}) });
    if (t.kind === "strand") return e.save({ name: f.name.trim(), order: Number(f.order) || 1 });
    if (t.kind === "assignment") return Object.values({ a: f.userId, b: f.streamId, c: f.learningAreaId, d: f.termId }).some((v) => !v) ? e.setErr("All fields are required.") : e.save({ userId: f.userId, streamId: f.streamId, learningAreaId: f.learningAreaId, termId: f.termId });
    if (levels.some((l) => !l.code.trim() || !l.label.trim() || ![l.points, l.minPercent, l.maxPercent].every((v) => MONEY_RE.test(v)))) return e.setErr("Every level needs a code, label, points and band.");
    const asc = [...levels].sort((a, b) => Number(toCents(a.minPercent) - toCents(b.minPercent)));
    if (toCents(asc[0].minPercent) !== 0n || toCents(asc[asc.length - 1].maxPercent) !== 10000n || asc.some((l, i) => toCents(l.maxPercent) <= toCents(l.minPercent) || (i > 0 && toCents(l.minPercent) !== toCents(asc[i - 1].maxPercent)))) return e.setErr("Bands must run 0 to 100 with no gaps or overlaps.");
    e.save({ name: f.name.trim(), levels });
  };
  const stream = streams.data?.find((s) => s.id === f.streamId);
  return (
    <Shell err={e.err} pending={e.pending} close={close} onSubmit={submit}>
      {t.kind !== "assignment" && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" required><TextInput value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        {t.kind === "learning-area" && <><Field label="Code" required><TextInput className="font-mono" value={f.code} onChange={(x) => setF({ ...f, code: x.target.value })} /></Field>
          <Field label="Core subject" hint="Leave unchanged to keep"><NativeSelect value={f.core} onChange={(x) => setF({ ...f, core: x.target.value })}><option value="">Unchanged</option><option value="yes">Core</option><option value="no">Optional</option></NativeSelect></Field>
          <Field label="Senior pathway" hint="Blank keeps; '-' clears"><TextInput value={f.pathway} onChange={(x) => setF({ ...f, pathway: x.target.value })} placeholder="STEM" /></Field></>}
        {t.kind === "strand" && <Field label="Order" required><TextInput type="number" min={1} value={f.order} onChange={(x) => setF({ ...f, order: x.target.value })} /></Field>}
      </div>}
      {t.kind === "scale" && <><p className="text-xs text-amber-800">Saving creates a new revision. Grades using this scale move to it; assessments already created keep the original bands.</p>
        <div className="space-y-2">{levels.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-5">{(["code", "label", "points", "minPercent", "maxPercent"] as const).map((k) => (
            <Field key={k} label={k === "minPercent" ? "From %" : k === "maxPercent" ? "To %" : k[0].toUpperCase() + k.slice(1)} required><TextInput value={l[k]} onChange={(x) => setLevels(levels.map((y, j) => (j === i ? { ...y, [k]: x.target.value } : y)))} /></Field>))}</div>))}</div></>}
      {t.kind === "assignment" && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Teacher" required><NativeSelect value={f.userId} onChange={(x) => setF({ ...f, userId: x.target.value })}><option value="">Select</option>{(users.data ?? []).filter((u) => u.isActive && ["teacher", "class_teacher"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
        <Field label="Stream" required><NativeSelect value={f.streamId} onChange={(x) => setF({ ...f, streamId: x.target.value })}><option value="">Select</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} {s.name}</option>)}</NativeSelect></Field>
        <Field label="Learning area" required><NativeSelect value={f.learningAreaId} onChange={(x) => setF({ ...f, learningAreaId: x.target.value })}><option value="">Select</option>{c.learningAreas.filter((a) => !stream || a.gradeId === stream.gradeId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
        <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
      </div>}
    </Shell>
  );
}
