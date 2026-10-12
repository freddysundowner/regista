import { useGetStudentFinanceHistory, getGetStudentFinanceHistoryQueryKey } from "@workspace/api-client-react";
import { Pager, usePaged } from "@/components/pager";
import { Wallet } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty } from "@/components/kit";
import { StatusPill, Money, DocumentButton, Table, td } from "@/components/finance-kit";
import { errMsg, fmtDate, fmtDateTime } from "@/lib/session";
import { str, rd, toCents, fromCents, kes, recordTitle, KIND_LABEL } from "@/lib/finance";

export function StudentFinancePanel({ studentId }: { studentId: string }) {
  const q = useGetStudentFinanceHistory(studentId, { query: { queryKey: getGetStudentFinanceHistoryQueryKey(studentId) } });
  const h = q.data;
  const bal = h?.balance ?? "0.00";
  const owing = h ? toCents(bal) > 0n : false;
  let run = 0n;
  const ledger = (h?.ledger ?? []).map((e) => {
    const d = str(e, "debit") ?? "0", c = str(e, "credit") ?? "0";
    run += toCents(d) - toCents(c);
    return { e, d, c, run: fromCents(run) };
  });
  const records = [...(h?.records ?? [])].reverse();
  const lp = usePaged([...ledger].reverse()), rp = usePaged(records), ap = usePaged(h?.allocations);
  const ref = (id?: string) => { const r = h?.records.find((x) => x.id === id); return r ? recordTitle(r) : "Record"; };
  return (
    <Panel title="Financial history" note="Ledger is the source of truth. Pending requests are not posted." action={<DocumentButton type="statement" referenceId={studentId} />}>
      {q.isLoading ? <SkeletonRows rows={4} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !h ? null : (
        <div>
          <div className="flex flex-wrap items-end gap-6 border-b border-border/70 px-5 py-4">
            <div><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{toCents(bal) < 0n ? "Credit" : "Balance due"}</div>
              <div data-testid="text-student-balance" className={`font-display text-3xl font-semibold tabular-nums ${owing ? "text-amber-800" : "text-primary"}`}>{kes(toCents(bal) < 0n ? bal.slice(1) : bal)}</div></div>
            <div className="text-xs text-muted-foreground">{h.records.filter((r) => r.status === "pending").length} pending request(s) · {h.allocations.length} allocations</div>
          </div>
          {!ledger.length && !records.length ? <Empty icon={<Wallet className="h-5 w-5" />} title="No financial activity" body="Invoices and payments for this learner will appear here." /> : <>
            <h3 className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ledger</h3>
            <Table head={["Date", "Entry", "Debit", "Credit", "Running"]}>{lp.rows.map(({ e, d, c, run }, i) => (
              <tr key={str(e, "id") ?? i} className={str(e, "reversesId") ? "text-muted-foreground" : ""}><td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(str(e, "createdAt"))}</td><td className={td}>{str(e, "description") ?? str(e, "type")}<div className="text-[11px] capitalize text-muted-foreground">{str(e, "type")}{str(e, "reversesId") ? " (reversal)" : ""}</div></td>
                <td className={td}>{toCents(d) ? <Money v={d} /> : ""}</td><td className={td}>{toCents(c) ? <Money v={c} /> : ""}</td><td className={td}><Money v={run} /></td></tr>))}</Table>
            <Pager {...lp.pager} />
            <h3 className="px-5 pt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Records & requests</h3>
            <Table head={["When", "Record", "Amount", "Status", ""]}>{rp.rows.map((r) => (
              <tr key={r.id} data-testid={`row-student-finance-${r.id}`}><td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(r.createdAt)}</td><td className={td}>{recordTitle(r)}<div className="text-[11px] text-muted-foreground">{KIND_LABEL[r.kind] ?? r.kind}{rd(r, "reason") ? ` · ${rd(r, "reason")}` : ""}</div></td>
                <td className={td}><Money v={r.amount} /></td><td className={td}><StatusPill status={r.status} /></td><td className={td}>{r.kind === "payment" && r.status === "posted" && <DocumentButton type="receipt" referenceId={r.id} fileName={rd(r, "receiptNo") ?? "receipt"} />}{r.kind === "invoice" && <DocumentButton type="invoice" referenceId={r.id} fileName={`Invoice-${rd(r, "invoiceNo") ?? r.id}`} />}</td></tr>))}</Table>
            <Pager {...rp.pager} />
            {h.allocations.length > 0 && <>
              <h3 className="px-5 pt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Allocations</h3>
              <Table head={["Date", "Source", "Invoice", "Amount"]}>{ap.rows.map((a, i) => (
                <tr key={str(a, "id") ?? i} className={str(a, "reversesId") ? "text-muted-foreground line-through" : ""}><td className={`${td} text-xs`}>{fmtDate(str(a, "createdAt"))}</td><td className={`${td} font-mono text-xs`}>{ref(str(a, "sourceId"))}</td><td className={`${td} font-mono text-xs`}>{ref(str(a, "invoiceId"))}</td><td className={td}><Money v={str(a, "amount")} /></td></tr>))}</Table>
            <Pager {...ap.pager} />
            </>}
          </>}
        </div>
      )}
    </Panel>
  );
}
