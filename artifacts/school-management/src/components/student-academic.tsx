import { useGetAttendanceRegister, useListReportCards, useListPaymentPlans, useGenerateReportCardPdf, getGetAttendanceRegisterQueryKey, getListReportCardsQueryKey, getListPaymentPlansQueryKey } from "@workspace/api-client-react";
import { Download } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Pill, Btn } from "@/components/kit";
import { useTermNames } from "@/components/finance-kit";
import { PlanTable } from "@/pages/payment-plans";
import { usePerms, errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

export function StudentAcademicPanels({ studentId }: { studentId: string }) {
  const p = usePerms(); const term = useTermNames(); const { toast } = useToast();
  const ap = { studentId }; const att = useGetAttendanceRegister(ap, { query: { queryKey: getGetAttendanceRegisterQueryKey(ap), enabled: p.academicRead } });
  const rp = { studentId }; const cards = useListReportCards(rp, { query: { queryKey: getListReportCardsQueryKey(rp), enabled: p.academicRead } });
  const plans = useListPaymentPlans({ query: { queryKey: getListPaymentPlansQueryKey(), enabled: p.financeRead } });
  const pdf = useGenerateReportCardPdf();
  const recs = [...(att.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const count = (s: string) => recs.filter((r) => r.status === s).length;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {p.academicRead && <Panel title="Results" note="Published and draft report cards">
        {cards.isLoading ? <SkeletonRows cols={2} /> : cards.isError ? <ErrorState msg={errMsg(cards.error)} onRetry={() => cards.refetch()} /> : !cards.data?.length ? <p className="p-5 text-sm text-muted-foreground">No report cards yet.</p> : (
          <ul className="divide-y divide-border/60">{cards.data.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm md:px-5"><span className="flex-1">{term(c.termId)}</span><Pill tone={c.status === "published" ? "active" : "current"}>{c.status}</Pill>
            <Btn variant="outline" className="h-7 px-2 text-xs" disabled={pdf.isPending} onClick={() => pdf.mutate({ id: c.id }, { onSuccess: (d) => window.open(d.downloadUrl, "_blank", "noopener"), onError: (x) => toast({ title: "PDF failed", description: errMsg(x), variant: "destructive" }) })}><Download className="h-3.5 w-3.5" />PDF</Btn></li>)}</ul>)}
      </Panel>}
      {p.academicRead && <Panel title="Attendance" note={recs.length ? `Present ${count("present")} · Absent ${count("absent")} · Late ${count("late")} · Excused ${count("excused")}` : undefined}>
        {att.isLoading ? <SkeletonRows cols={2} /> : att.isError ? <ErrorState msg={errMsg(att.error)} onRetry={() => att.refetch()} /> : !recs.length ? <p className="p-5 text-sm text-muted-foreground">No attendance recorded.</p> : (
          <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">{recs.slice(0, 60).map((r) => <li key={r.id} className="flex justify-between px-5 py-2 text-sm"><span>{fmtDate(r.date)}</span><Pill tone={r.status === "present" ? "active" : r.status === "absent" ? "error" : "duplicate"}>{r.status}</Pill></li>)}</ul>)}
      </Panel>}
      {p.financeRead && <Panel title="Payment plans" className="lg:col-span-2">
        {plans.isLoading ? <SkeletonRows cols={3} /> : plans.isError ? <ErrorState msg={errMsg(plans.error)} onRetry={() => plans.refetch()} /> : !plans.data?.some((x) => x.studentId === studentId) ? <p className="p-5 text-sm text-muted-foreground">No payment plans.</p> : <PlanTable plans={plans.data.filter((x) => x.studentId === studentId)} decide={p.planDecide} />}
      </Panel>}
    </div>
  );
}
