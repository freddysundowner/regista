import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListReportCards, useSaveReportCard, useGenerateReportCardPdf, useSendReportCard, useGenerateBatchReportCards, useListStudents, getListReportCardsQueryKey, getListStudentsQueryKey, type ReportCardView, type Student } from "@workspace/api-client-react";
import { Download, FileBadge, Loader2, Send } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, FormActions, Pill } from "@/components/kit";
import { GradeSelect, TermSelect } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const area = "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

function CardRow({ s, card, termId }: { s: Student; card?: ReportCardView; termId: string }) {
  const p = usePerms(); const qc = useQueryClient(); const { toast } = useToast();
  const save = useSaveReportCard(); const pdf = useGenerateReportCardPdf(); const send = useSendReportCard();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ cls: card?.classTeacherComment ?? "", head: card?.headTeacherComment ?? "", opening: card?.nextTermOpeningDate?.slice(0, 10) ?? "", publish: false });
  const [err, setErr] = useState<string | null>(null);
  const published = card?.status === "published";
  const submit = () => {
    setErr(null);
    if (f.publish && !window.confirm(`Publish ${s.fullName}'s report card? It will be frozen and visible to the family.`)) return;
    save.mutate({ data: { studentId: s.id, termId, ...(f.cls.trim() ? { classTeacherComment: f.cls.trim() } : {}), ...(p.headRemarks && f.head.trim() ? { headTeacherComment: f.head.trim() } : {}), ...(f.opening ? { nextTermOpeningDate: f.opening } : {}), ...(f.publish ? { publish: true } : {}) } }, {
      onSuccess: (r) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/report-cards") }); toast({ title: r.status === "published" ? "Report card published" : "Comments saved" }); setOpen(false); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const download = () => card && pdf.mutate({ id: card.id }, {
    onSuccess: (d) => { const a = document.createElement("a"); a.href = d.downloadUrl; a.target = "_blank"; a.rel = "noopener"; a.download = `report-${s.admissionNo}.pdf`; a.click(); },
    onError: (x) => toast({ title: "PDF not generated", description: errMsg(x), variant: "destructive" }),
  });
  return (
    <li data-testid={`row-report-${s.id}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div className="min-w-[10rem] flex-1"><div className="font-medium">{s.fullName}</div><div className="font-mono text-[11px] text-muted-foreground">{s.admissionNo}{s.streamName ? ` · ${s.streamName}` : ""}</div></div>
        <Pill tone={published ? "active" : card ? "current" : "left"}>{card?.status ?? "not started"}</Pill>
        {card?.publishedAt && <span className="text-xs text-muted-foreground">{fmtDateTime(card.publishedAt)}</span>}
        <div className="flex gap-2">
          {!published && <Btn variant="outline" className="h-8" data-testid={`button-comments-${s.id}`} onClick={() => { setErr(null); setF({ cls: card?.classTeacherComment ?? "", head: card?.headTeacherComment ?? "", opening: card?.nextTermOpeningDate?.slice(0, 10) ?? "", publish: false }); setOpen(true); }}>Edit comments</Btn>}
          {card && <Btn variant="outline" className="h-8" disabled={pdf.isPending} onClick={download}>{pdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</Btn>}
          {published && <Btn variant="outline" className="h-8" data-testid={`button-send-report-${s.id}`} disabled={send.isPending} onClick={() => card && send.mutate({ id: card.id }, {
            onSuccess: (r) => toast({ title: `Report card ${r.status}`, description: r.message ?? "Sent to the primary guardian's outbox. Queued or submitted is not yet delivered; check Messages." }),
            onError: (x) => toast({ title: "Not sent", description: errMsg(x), variant: "destructive" }) })}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send</Btn>}
        </div>
      </div>
      {(published || card?.classTeacherComment || card?.headTeacherComment) && <div className="space-y-1 px-4 pb-3 text-xs text-muted-foreground">{card?.classTeacherComment && <p><span className="font-semibold text-foreground">Class teacher:</span> {card.classTeacherComment}</p>}{card?.headTeacherComment && <p><span className="font-semibold text-foreground">Head teacher:</span> {card.headTeacherComment}</p>}</div>}
      <FormDialog open={open} onOpenChange={setOpen} busy={save.isPending} size="lg" title={`Report card comments: ${s.fullName}`} description={`${s.admissionNo}${s.streamName ? ` · ${s.streamName}` : ""}. Publishing freezes the card and makes it visible to the family.`}>
        <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class teacher comment"><textarea rows={3} className={area} value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })} /></Field>
            <Field label="Head teacher remarks" hint={p.headRemarks ? undefined : "Principal or administrator only"}><textarea rows={3} className={area} disabled={!p.headRemarks} value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })} /></Field>
            <Field label="Next term opens"><TextInput type="date" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} /></Field>
            {p.headRemarks && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Publish now (assessments must be locked)</label>}
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-report-comments" disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{f.publish ? "Save and publish" : "Save comments"}</Btn><Btn type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
    </li>
  );
}

export default function ReportCards() {
  const p = usePerms();
  const [f, setF] = useState({ termId: "", gradeId: "" });
  const sp = f.gradeId ? { gradeId: f.gradeId } : undefined;
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp), enabled: !!f.gradeId } });
  const rp = f.termId ? { termId: f.termId } : undefined;
  const cards = useListReportCards(rp, { query: { queryKey: getListReportCardsQueryKey(rp), enabled: !!f.termId } });
  const byStudent = useMemo(() => new Map(cards.data?.map((c) => [c.studentId, c])), [cards.data]);
  const list = (students.data ?? []).filter((s) => s.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName));
  const batch = useGenerateBatchReportCards(); const { toast } = useToast();
  const [links, setLinks] = useState<{ studentId: string; downloadUrl: string }[]>([]);
  const withCards = list.filter((s) => byStudent.has(s.id));
  const runBatch = () => { const ids = withCards.slice(0, 100).map((s) => s.id); setLinks([]);
    batch.mutate({ data: { termId: f.termId, studentIds: ids } }, { onSuccess: (r) => { setLinks(r); toast({ title: `${r.length} PDFs ready`, description: "Links expire; download them now." }); }, onError: (x) => toast({ title: "Batch not generated", description: errMsg(x), variant: "destructive" }) }); };
  const nameOf = (id: string) => list.find((s) => s.id === id)?.fullName ?? "Learner";
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academics" title="Report cards" meta={`CBC report cards built from locked results. Fees never appear on them.${p.headRemarks ? "" : " Head remarks and publishing are for the principal or administrator."}`} />
      <Panel action={withCards.length > 0 ? <Btn variant="outline" className="h-8" data-testid="button-batch-pdf" disabled={batch.isPending} onClick={runBatch}>{batch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Batch PDF ({Math.min(withCards.length, 100)})</Btn> : undefined}>
        {links.length > 0 && <div className="flex flex-wrap gap-2 border-b border-border/70 bg-accent/20 p-4 text-xs">{links.map((l) => <a key={l.studentId} href={l.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 font-semibold hover:border-primary"><Download className="h-3 w-3" />{nameOf(l.studentId)}</a>)}</div>}
        <div className="grid gap-3 border-b border-border/70 p-4 sm:grid-cols-2"><TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} /><GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} /></div>
        {!f.termId || !f.gradeId ? <Empty icon={<FileBadge className="h-5 w-5" />} title="Choose term and grade" body="Learners in the grade are listed with their report card status." />
          : students.isLoading || cards.isLoading ? <SkeletonRows cols={3} /> : cards.isError ? <ErrorState msg={errMsg(cards.error)} onRetry={() => cards.refetch()} /> : students.isError ? <ErrorState msg={errMsg(students.error)} onRetry={() => students.refetch()} />
          : !list.length ? <Empty icon={<FileBadge className="h-5 w-5" />} title="No learners" body="No active learners in this grade." />
          : <ul className="divide-y divide-border/60">{list.map((s) => <CardRow key={`${s.id}${byStudent.get(s.id)?.status ?? ""}`} s={s} card={byStudent.get(s.id)} termId={f.termId} />)}</ul>}
      </Panel>
    </div>
  );
}
