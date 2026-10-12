import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditCurriculum, getGetCurriculumQueryKey, type CurriculumEditInput, type CurriculumView, type LevelInput } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { MONEY_RE, toCents } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

export type EditTarget = { kind: "learning-area" | "strand" | "scale"; id: string };

/** Edits one subject, topic or rating scale in place. Scale edits create a revision; past assessments keep theirs. */
export function CurriculumEditor({ t, c, senior, close }: { t: EditTarget; c: CurriculumView; senior?: boolean; close: () => void }) {
  const m = useEditCurriculum(); const qc = useQueryClient(); const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  const area = c.learningAreas.find((x) => x.id === t.id);
  const strand = c.strands.find((x) => x.id === t.id);
  const scale = c.scales.find((x) => x.id === t.id);
  const [f, setF] = useState({ name: area?.name ?? strand?.name ?? scale?.name ?? "", code: area?.code ?? "", order: String(strand?.order ?? 1), core: area?.isCore === false ? "no" : "yes", pathway: area?.pathway ?? "" });
  const [levels, setLevels] = useState<LevelInput[]>(() => [...(scale?.levels ?? [])].sort((a, b) => a.order - b.order).map((l) => ({ code: l.code, label: l.label, points: l.points, minPercent: l.minPercent, maxPercent: l.maxPercent, order: l.order })));
  const showPathway = senior || !!area?.pathway;

  const save = (data: CurriculumEditInput) => { setErr(null); m.mutate({ kind: t.kind, id: t.id, data }, {
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: getGetCurriculumQueryKey() }); toast({ title: "Saved", description: r.message ?? (t.kind === "scale" ? "Used from now on; assessments already set keep their original bands." : undefined) }); close(); },
    onError: (x) => setErr(errMsg(x)) }); };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!f.name.trim()) return setErr("Name is required.");
    if (t.kind === "learning-area") {
      if (!f.code.trim()) return setErr("Short code is required.");
      return save({ name: f.name.trim(), code: f.code.trim().toUpperCase(), isCore: f.core === "yes", ...(showPathway ? { pathway: f.pathway.trim() || null } : {}) });
    }
    if (t.kind === "strand") return save({ name: f.name.trim(), order: Number(f.order) || 1 });
    if (levels.some((l) => !l.code.trim() || !l.label.trim() || ![l.points, l.minPercent, l.maxPercent].every((v) => MONEY_RE.test(v)))) return setErr("Every level needs a code, meaning, points and band.");
    const asc = [...levels].sort((a, b) => Number(toCents(a.minPercent) - toCents(b.minPercent)));
    if (toCents(asc[0].minPercent) !== 0n || toCents(asc[asc.length - 1].maxPercent) !== 10000n || asc.some((l, i) => toCents(l.maxPercent) <= toCents(l.minPercent) || (i > 0 && toCents(l.minPercent) !== toCents(asc[i - 1].maxPercent)))) return setErr("Bands must run 0 to 100 with no gaps or overlaps.");
    save({ name: f.name.trim(), levels });
  };
  const setLevel = (i: number, k: keyof LevelInput, v: string) => setLevels(levels.map((y, j) => (j === i ? { ...y, [k]: v } : y)));

  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.kind === "scale" ? "Scale name" : t.kind === "strand" ? "Topic name" : "Subject name"} required><TextInput value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        {t.kind === "learning-area" && <>
          <Field label="Short code" required><TextInput className="font-mono uppercase" value={f.code} onChange={(x) => setF({ ...f, code: x.target.value })} /></Field>
          <Field label="Taken by" hint="Optional subjects are chosen by some learners only"><NativeSelect value={f.core} onChange={(x) => setF({ ...f, core: x.target.value })}><option value="yes">Every learner (core)</option><option value="no">Some learners (optional)</option></NativeSelect></Field>
          {showPathway && <Field label="Senior pathway" hint="Leave empty if it belongs to no pathway"><TextInput value={f.pathway} onChange={(x) => setF({ ...f, pathway: x.target.value })} placeholder="STEM" /></Field>}
        </>}
        {t.kind === "strand" && <Field label="Position" hint="1 shows first"><TextInput type="number" min={1} value={f.order} onChange={(x) => setF({ ...f, order: x.target.value })} /></Field>}
      </div>
      {t.kind === "scale" && <>
        <p className="rounded-md bg-amber-600/10 px-3 py-2 text-xs text-amber-900">Changes apply to new assessments. Assessments already set keep the bands they were marked with.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1.5 pr-2 font-medium">Code</th><th className="pb-1.5 pr-2 font-medium">Meaning</th><th className="pb-1.5 pr-2 font-medium">Points</th><th className="pb-1.5 pr-2 font-medium">From %</th><th className="pb-1.5 font-medium">To %</th></tr></thead>
            <tbody>{levels.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><TextInput aria-label={`Level ${i + 1} code`} className="w-20 font-mono" value={l.code} onChange={(x) => setLevel(i, "code", x.target.value)} /></td>
                <td className="py-1 pr-2"><TextInput aria-label={`Level ${i + 1} meaning`} value={l.label} onChange={(x) => setLevel(i, "label", x.target.value)} /></td>
                <td className="py-1 pr-2"><TextInput aria-label={`Level ${i + 1} points`} className="w-16" inputMode="decimal" value={l.points} onChange={(x) => setLevel(i, "points", x.target.value)} /></td>
                <td className="py-1 pr-2"><TextInput aria-label={`Level ${i + 1} from`} className="w-20" inputMode="decimal" value={l.minPercent} onChange={(x) => setLevel(i, "minPercent", x.target.value)} /></td>
                <td className="py-1"><TextInput aria-label={`Level ${i + 1} to`} className="w-20" inputMode="decimal" value={l.maxPercent} onChange={(x) => setLevel(i, "maxPercent", x.target.value)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</Btn><Btn type="button" variant="ghost" onClick={close}>Cancel</Btn></FormActions>
    </form>
  );
}
