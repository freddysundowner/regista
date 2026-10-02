import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePreviewPromotion, useCommitPromotion, useListAcademicYears, useListStreams, getListAcademicYearsQueryKey, getListStreamsQueryKey, getListStudentsQueryKey, getListGradesQueryKey, getListFamiliesQueryKey, getGetDashboardSummaryQueryKey, getListAuditLogsQueryKey, type PromotionPreview, type PromotionInputAction } from "@workspace/api-client-react";
import { ArrowRight, GraduationCap, Loader2 } from "lucide-react";
import { Panel, Btn, Field, NativeSelect, TextInput, FormError, FormActions } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

export function PromotionsPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Year-end promotion" note="Preview the exact roster, then commit. Previews expire after 15 minutes; history is kept."
      action={<Btn variant="outline" className="h-8" data-testid="button-start-promotion" onClick={() => setOpen(true)}><GraduationCap className="h-3.5 w-3.5" /> Start promotion</Btn>}>
      <p className="px-5 py-4 text-sm text-muted-foreground">Move a stream's learners into the next grade, or graduate a final-year class. Opens a guided preview-then-commit workflow.</p>
      <FormDialog open={open} onOpenChange={setOpen} busy={busy} size="full" title="Year-end promotion" description="Preview the exact roster, then commit. Previews expire after 15 minutes; history is kept.">
        <PromotionWorkflow onBusy={setBusy} onDone={() => setOpen(false)} />
      </FormDialog>
    </Panel>
  );
}

function PromotionWorkflow({ onBusy, onDone }: { onBusy: (b: boolean) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const years = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const preview = usePreviewPromotion();
  const commit = useCommitPromotion();
  const [f, setF] = useState({ action: "promote" as PromotionInputAction, sourceYearId: "", targetYearId: "", sourceStreamId: "", targetStreamId: "" });
  const [p, setP] = useState<PromotionPreview | null>(null);
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setP(null); setTyped(""); };
  const yearName = (id: string) => years.data?.find((y) => y.id === id)?.name ?? "";
  const streamName = (id: string) => { const s = streams.data?.find((x) => x.id === id); return s ? `${s.gradeName} · ${s.name}` : ""; };
  const sortedYears = [...(years.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const runPreview = (e: FormEvent) => {
    e.preventDefault(); setErr(null); setP(null);
    if (!f.sourceYearId || !f.targetYearId || !f.sourceStreamId) return setErr("Choose source year, target year and source stream.");
    if (f.action === "promote" && !f.targetStreamId) return setErr("Choose the stream learners move into.");
    preview.mutate({ data: { action: f.action, sourceYearId: f.sourceYearId, targetYearId: f.targetYearId, sourceStreamId: f.sourceStreamId, ...(f.action === "promote" ? { targetStreamId: f.targetStreamId } : {}) } }, {
      onSuccess: (r) => { setP(r); setAt(Date.now()); setTyped(""); },
      onError: (x) => setErr(errMsg(x)),
    });
  };

  const runCommit = () => {
    if (!p) return;
    setErr(null);
    if (Date.now() - at > 15 * 60_000) { setP(null); return setErr("This preview has expired. Preview again."); }
    onBusy(true);
    commit.mutate({ data: { previewToken: p.previewToken, confirmation: "PROMOTE" } }, {
      onSuccess: (r) => {
        [getListStudentsQueryKey(), getListGradesQueryKey(), getListStreamsQueryKey(), getListFamiliesQueryKey(), getGetDashboardSummaryQueryKey(), getListAuditLogsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/students") });
        toast({ title: f.action === "promote" ? "Promotion committed" : "Graduation committed", description: `${r.updatedStudents} learner record${r.updatedStudents === 1 ? "" : "s"} updated.` });
        setP(null); setTyped(""); onBusy(false); onDone();
      },
      onError: (x) => { onBusy(false); setErr(`${errMsg(x)} Preview again if the roster changed.`); setP(null); },
    });
  };

  return (
    <div>
      <form onSubmit={runPreview} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Action" required><NativeSelect data-testid="select-promotion-action" value={f.action} onChange={set("action")}><option value="promote">Promote to next grade</option><option value="graduate">Graduate (final grade)</option></NativeSelect></Field>
          <Field label="From year" required><NativeSelect data-testid="select-source-year" value={f.sourceYearId} onChange={set("sourceYearId")}><option value="">Select</option>{sortedYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</NativeSelect></Field>
          <Field label="To year" required hint="Must come after the source year"><NativeSelect data-testid="select-target-year" value={f.targetYearId} onChange={set("targetYearId")}><option value="">Select</option>{sortedYears.map((y) => <option key={y.id} value={y.id} disabled={y.id === f.sourceYearId}>{y.name}</option>)}</NativeSelect></Field>
          <Field label="From stream" required><NativeSelect data-testid="select-source-stream" value={f.sourceStreamId} onChange={set("sourceStreamId")}><option value="">Select</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} · {s.name} ({s.studentCount})</option>)}</NativeSelect></Field>
          {f.action === "promote" && <Field label="To stream" required hint="Must be in a higher grade"><NativeSelect data-testid="select-target-stream" value={f.targetStreamId} onChange={set("targetStreamId")}><option value="">Select</option>{streams.data?.filter((s) => s.id !== f.sourceStreamId).map((s) => <option key={s.id} value={s.id}>{s.gradeName} · {s.name}</option>)}</NativeSelect></Field>}
        </div>
        {(years.isError || streams.isError) && <FormError msg={errMsg(years.error ?? streams.error)} />}
        {!p && <FormError msg={err} />}
        <FormActions>
          <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
          <Btn type="submit" variant="outline" data-testid="button-preview-promotion" disabled={preview.isPending}>{preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Preview roster</Btn>
        </FormActions>
      </form>
      {p && (
        <div className="border-t border-border/70 p-5" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold" data-testid="text-promotion-count">{p.count} learner{p.count === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground">{streamName(f.sourceStreamId)} ({yearName(f.sourceYearId)})</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{f.action === "promote" ? `${streamName(f.targetStreamId)} (${yearName(f.targetYearId)})` : `Graduated (${yearName(f.targetYearId)})`}</span>
          </div>
          {p.count === 0 ? <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No eligible learners. Learners already promoted from this year are excluded.</p> : (
            <div className="max-h-72 overflow-auto rounded border border-border">
              <table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr><th className="px-3 py-2">Adm. no.</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Current grade</th></tr></thead>
                <tbody>{p.students.map((s) => <tr key={s.id} data-testid={`row-promotion-${s.id}`} className="border-t border-border/50"><td className="px-3 py-1.5 font-mono text-xs">{s.admissionNo}</td><td className="px-3 py-1.5">{s.name}</td><td className="px-3 py-1.5 text-muted-foreground">{s.gradeName ?? "\u2014"}</td></tr>)}</tbody></table>
            </div>
          )}
          {p.count > 0 && (
            <div className="mt-4 space-y-3">
              <Field label="Type PROMOTE to commit" required><TextInput data-testid="input-promotion-confirm" autoComplete="off" className="max-w-xs font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
              <FormError msg={err} />
              <FormActions>
                <Btn data-testid="button-commit-promotion" disabled={typed !== "PROMOTE" || commit.isPending} onClick={runCommit}>{commit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}Commit {f.action === "promote" ? "promotion" : "graduation"}</Btn>
                <Btn variant="ghost" onClick={() => { setP(null); setTyped(""); }}>Discard preview</Btn>
                <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
              </FormActions>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
