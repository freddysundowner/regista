import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListReportCards, useSaveReportCard, useGenerateReportCardPdf, useSendReportCard, useGenerateBatchReportCards, useListStudents, useSaveLearnerRating, useListLearnerRatings,
  getListReportCardsQueryKey, getListStudentsQueryKey, getListLearnerRatingsQueryKey,
  type ReportCardView, type Student, type RatingInputCategory,
} from "@workspace/api-client-react";
import { Check, ChevronLeft, ChevronRight, Download, FileBadge, Loader2, Send } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, Pill, NativeSelect } from "@/components/kit";
import { ClassBar, levelTone, useClassContext } from "@/components/class-bar";
import { useCurriculum } from "@/pages/curriculum";
import { usePerms, errMsg, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";
import { cn } from "@/lib/utils";

const COMPETENCIES = ["communication", "critical_thinking", "creativity", "citizenship", "digital_literacy", "learning_to_learn", "self_efficacy"];
const VALUES = ["love", "responsibility", "respect", "unity", "peace", "patriotism", "social_justice", "integrity"];
const nice = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const area = "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const STATUS: Record<string, { label: string; tone: string }> = { published: { label: "Published", tone: "active" }, draft: { label: "Draft", tone: "current" } };

/** Competencies and values for one learner; each choice saves at once. */
function Ratings({ student, gradeId, termId, readOnly }: { student: Student; gradeId: string; termId: string; readOnly: boolean }) {
  const cur = useCurriculum(); const m = useSaveLearnerRating(); const { toast } = useToast(); const qc = useQueryClient();
  const rp = { studentId: student.id, termId };
  const existing = useListLearnerRatings(rp, { query: { queryKey: getListLearnerRatingsQueryKey(rp) } });
  const [saving, setSaving] = useState<string | null>(null);
  const scaleId = cur.data?.gradeScales.find((g) => g.gradeId === gradeId)?.scaleId;
  // Best level first, so colours and lists read EE → BE.
  const levels = [...(cur.data?.scales.find((s) => s.id === scaleId)?.levels ?? [])].sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  const current = (code: string) => existing.data?.find((r) => r.code === code)?.performanceLevelId ?? "";
  const rate = (category: RatingInputCategory, code: string, performanceLevelId: string) => {
    if (!performanceLevelId) return; setSaving(code);
    m.mutate({ data: { studentId: student.id, termId, category, code, performanceLevelId } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListLearnerRatingsQueryKey(rp) }),
      onError: (x) => toast({ title: "Rating not saved", description: errMsg(x), variant: "destructive" }),
      onSettled: () => setSaving(null),
    });
  };
  if (existing.isLoading || cur.isLoading) return <SkeletonRows rows={5} cols={2} />;
  if (existing.isError) return <ErrorState msg={errMsg(existing.error)} onRetry={() => existing.refetch()} />;
  if (!levels.length) return <p className="text-sm text-muted-foreground">This grade has no rating scale yet. Choose one on the Subjects page.</p>;
  const rated = [...COMPETENCIES, ...VALUES].filter((c) => current(c)).length;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{rated} of {COMPETENCIES.length + VALUES.length} rated. Each choice saves straight away.</p>
      {([["competency", "Core competencies", COMPETENCIES], ["value", "Values", VALUES]] as const).map(([cat, title, codes]) => (
        <div key={cat}>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h4>
          <ul className="divide-y divide-border/50 rounded-md border border-border/70">{codes.map((code) => {
            const v = current(code), i = levels.findIndex((l) => l.id === v);
            return (
              <li key={code} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="flex-1">{nice(code)}</span>
                {saving === code ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : v && <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", levelTone(i, levels.length))}>{levels[i]?.code}</span>}
                <NativeSelect aria-label={nice(code)} className="h-8 w-36 text-xs" value={v} disabled={readOnly || saving === code} onChange={(e) => rate(cat, code, e.target.value)}>
                  <option value="">Not rated</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.label}</option>)}
                </NativeSelect>
              </li>);
          })}</ul>
        </div>
      ))}
    </div>
  );
}

/** Everything for one learner's report card, with previous/next to move through the class. */
function Workspace({ s, card, termId, gradeId, index, total, onMove, onClose }: { s: Student; card?: ReportCardView; termId: string; gradeId: string; index: number; total: number; onMove: (by: number) => void; onClose: () => void }) {
  const p = usePerms(); const qc = useQueryClient(); const { toast } = useToast();
  const save = useSaveReportCard(); const pdf = useGenerateReportCardPdf(); const send = useSendReportCard();
  const published = card?.status === "published";
  const initial = () => ({ cls: card?.classTeacherComment ?? "", head: card?.headTeacherComment ?? "", opening: card?.nextTermOpeningDate?.slice(0, 10) ?? "" });
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF(initial()); setErr(null); }, [s.id, card?.id, card?.status]);
  const canClass = p.academicAdmin || p.limitedToAssigned, canHead = p.headRemarks;
  const dirty = f.cls !== (card?.classTeacherComment ?? "") || f.head !== (card?.headTeacherComment ?? "") || f.opening !== (card?.nextTermOpeningDate?.slice(0, 10) ?? "");
  const persist = (publish: boolean, then?: () => void) => {
    setErr(null);
    if (publish && !window.confirm(`Publish ${s.fullName}'s report card? It is frozen and can be sent to the family. This can't be undone.`)) return;
    save.mutate({ data: { studentId: s.id, termId, ...(canClass ? { classTeacherComment: f.cls.trim() } : {}), ...(canHead ? { headTeacherComment: f.head.trim() } : {}), ...(f.opening ? { nextTermOpeningDate: f.opening } : {}), ...(publish ? { publish: true } : {}) } }, {
      onSuccess: (r) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/report-cards") }); toast({ title: r.status === "published" ? "Report card published" : "Saved" }); then?.(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const move = (by: number) => { if (dirty && !published) persist(false, () => onMove(by)); else onMove(by); };
  const download = () => card && pdf.mutate({ id: card.id }, {
    onSuccess: (d) => { const a = document.createElement("a"); a.href = d.downloadUrl; a.download = `Report-card-${s.admissionNo}-${s.fullName.replace(/\s+/g, "-")}.pdf`; document.body.appendChild(a); a.click(); a.remove(); },
    onError: (x) => toast({ title: "PDF not made", description: errMsg(x), variant: "destructive" }),
  });
  return (
    <div className="flex max-h-[80dvh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-2.5 text-sm">
        <span className="font-mono text-xs text-muted-foreground">{s.admissionNo}</span>
        <Pill tone={STATUS[card?.status ?? ""]?.tone ?? "left"}>{STATUS[card?.status ?? ""]?.label ?? "Not started"}</Pill>
        {card?.publishedAt && <span className="text-xs text-muted-foreground">{fmtDateTime(card.publishedAt)}</span>}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-xs tabular-nums text-muted-foreground">{index + 1} of {total}</span>
          <Btn variant="outline" className="h-8 w-8 p-0" aria-label="Previous learner" disabled={index === 0 || save.isPending} onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Btn>
          <Btn variant="outline" className="h-8 w-8 p-0" aria-label="Next learner" disabled={index === total - 1 || save.isPending} onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Btn>
        </div>
      </div>
      <div className="grid flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-2">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Comments</h3>
          <Field label="Class teacher's comment" hint={canClass ? undefined : "Written by the class teacher"}><textarea rows={4} disabled={published || !canClass} className={area} value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })} placeholder="How the learner did this term" /></Field>
          <Field label="Head teacher's remarks" hint={canHead ? undefined : "Written by the head teacher"}><textarea rows={3} disabled={published || !canHead} className={area} value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })} /></Field>
          <Field label="Next term opens"><TextInput type="date" disabled={published} value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} /></Field>
          {published && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Published report cards are frozen and can't be edited.</p>}
          <FormError msg={err} />
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Competencies and values</h3>
          <Ratings key={s.id} student={s} gradeId={gradeId} termId={termId} readOnly={published} />
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-5 py-3">
        {!published && <Btn data-testid="button-save-report" disabled={save.isPending || !dirty} onClick={() => persist(false)}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{dirty ? "Save" : "Saved"}</Btn>}
        {!published && canHead && <Btn variant="outline" data-testid="button-publish-report" disabled={save.isPending} onClick={() => persist(true)}><Check className="h-4 w-4" />Publish</Btn>}
        {card && <Btn variant="outline" disabled={pdf.isPending} onClick={download}>{pdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</Btn>}
        {published && <Btn variant="outline" data-testid={`button-send-report-${s.id}`} disabled={send.isPending} onClick={() => card && send.mutate({ id: card.id }, {
          onSuccess: (r) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/notifications") }); toast({ title: `Report card ${r.status}`, description: r.message ?? "Sent to the primary guardian. Check Messages for delivery." }); },
          onError: (x) => toast({ title: "Not sent", description: errMsg(x), variant: "destructive" }) })}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send to parent</Btn>}
        {!published && canHead && <span className="text-xs text-muted-foreground">Publishing needs the term's marks locked.</span>}
        <Btn variant="ghost" className="ml-auto" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

/** Report cards for one class and term: see who is done at a glance, then work through learners one by one. */
export default function ReportCards() {
  const p = usePerms(); const { toast } = useToast();
  const ctx = useClassContext(); const stream = ctx.stream, term = ctx.term;
  const sp = { streamId: stream?.id ?? "" };
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp), enabled: !!stream } });
  const rp = term ? { termId: term.id } : undefined;
  const cards = useListReportCards(rp, { query: { queryKey: getListReportCardsQueryKey(rp), enabled: !!term, staleTime: 0, refetchInterval: 30000 } });
  const byStudent = useMemo(() => new Map(cards.data?.map((c) => [c.studentId, c])), [cards.data]);
  const list = (students.data ?? []).filter((s) => s.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName));
  const batch = useGenerateBatchReportCards();
  const [open, setOpen] = useState<number | null>(null);
  const withCards = list.filter((s) => byStudent.has(s.id));
  const published = list.filter((s) => byStudent.get(s.id)?.status === "published").length;
  const commented = list.filter((s) => byStudent.get(s.id)?.classTeacherComment).length;
  const runBatch = () => {
    if (!term) return;
    batch.mutate({ data: { termId: term.id, studentIds: withCards.slice(0, 100).map((s) => s.id) } }, {
      onSuccess: (r) => { r.forEach((l, i) => window.setTimeout(() => { const a = document.createElement("a"); a.href = l.downloadUrl; a.download = `Report-card-${list.find((s) => s.id === l.studentId)?.admissionNo ?? i}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }, i * 400)); toast({ title: `${r.length} report cards downloading` }); },
      onError: (x) => toast({ title: "Not generated", description: errMsg(x), variant: "destructive" }),
    });
  };
  const current = open !== null ? list[open] : undefined;
  return (
    <div className="space-y-4">
      <PageHeader title="Report cards" meta={`Write comments and rate competencies for each learner, then publish.${p.headRemarks ? "" : " The head teacher adds remarks and publishes."}`} />
      <ClassBar ctx={ctx}>
        {withCards.length > 0 && <Btn variant="outline" className="h-8" data-testid="button-batch-pdf" disabled={batch.isPending} onClick={runBatch}>{batch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download all ({Math.min(withCards.length, 100)})</Btn>}
      </ClassBar>

      {list.length > 0 && <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border/60 text-center" data-testid="report-progress">
        {[["Learners", list.length], ["Comments written", commented], ["Published", published]].map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-2.5"><p className="text-lg font-semibold tabular-nums">{v}</p><p className="text-[11px] text-muted-foreground">{k}</p></div>
        ))}
      </div>}

      <Panel>
        {ctx.loading || students.isLoading || cards.isLoading ? <SkeletonRows cols={4} /> : cards.isError ? <ErrorState msg={errMsg(cards.error)} onRetry={() => cards.refetch()} /> : !stream || !term ? <Empty icon={<FileBadge className="h-5 w-5" />} title="Choose a class and term" body="Pick them above to see the class's report cards." />
          : !list.length ? <Empty icon={<FileBadge className="h-5 w-5" />} title="No learners" body="This class has no active learners." /> : (
            <div className="max-h-[calc(100dvh-20rem)] min-h-[16rem] overflow-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="report-table">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]"><tr><th className="w-10 px-2 py-2 text-right font-medium">#</th><th className="px-3 py-2 font-medium">Learner</th><th className="w-28 px-3 py-2 font-medium">Class teacher</th><th className="w-28 px-3 py-2 font-medium">Head teacher</th><th className="w-28 px-3 py-2 font-medium">Status</th><th className="w-20 px-3 py-2" /></tr></thead>
                <tbody className="divide-y divide-border/50">{list.map((s, i) => {
                  const c = byStudent.get(s.id), st = STATUS[c?.status ?? ""];
                  const tick = (v?: string | null) => v ? <span className="flex items-center gap-1 text-primary"><Check className="h-3.5 w-3.5" />Written</span> : <span className="text-muted-foreground">—</span>;
                  return (
                    <tr key={s.id} data-testid={`row-report-${s.id}`} className="h-10 cursor-pointer hover:bg-muted/30" onClick={() => setOpen(i)}>
                      <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="max-w-0 px-3 py-1"><div className="flex items-baseline gap-2 truncate"><span className="truncate font-medium">{s.fullName}</span><span className="shrink-0 font-mono text-[11px] text-muted-foreground">{s.admissionNo}</span></div></td>
                      <td className="px-3 py-1 text-xs">{tick(c?.classTeacherComment)}</td>
                      <td className="px-3 py-1 text-xs">{tick(c?.headTeacherComment)}</td>
                      <td className="px-3 py-1"><Pill tone={st?.tone ?? "left"}>{st?.label ?? "Not started"}</Pill></td>
                      <td className="px-3 py-1 text-right"><Btn variant="outline" className="h-7 px-2.5 text-xs" data-testid={`button-comments-${s.id}`} onClick={(e) => { e.stopPropagation(); setOpen(i); }}>Open</Btn></td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
      </Panel>

      <FormDialog open={!!current} onOpenChange={(o) => { if (!o) setOpen(null); }} size="xl" title={current ? `${current.fullName} · report card` : "Report card"} description={stream && term ? `${stream.gradeName} ${stream.name} · ${term.name}` : undefined}>
        {current && stream && term && <Workspace s={current} card={byStudent.get(current.id)} termId={term.id} gradeId={stream.gradeId} index={open!} total={list.length} onMove={(by) => setOpen((i) => Math.min(list.length - 1, Math.max(0, (i ?? 0) + by)))} onClose={() => setOpen(null)} />}
      </FormDialog>
    </div>
  );
}
