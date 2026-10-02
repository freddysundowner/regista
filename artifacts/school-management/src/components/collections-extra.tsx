import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCollectionRefunds, useDecideCollectionRefund, usePayCollectionRefund, useListSponsorBatches, useGenerateSponsorAcknowledgement, useListApprovalInbox,
  getListCollectionRefundsQueryKey, getListSponsorBatchesQueryKey, getListApprovalInboxQueryKey, type CollectionRefundView, type ModuleDecisionInputDecision,
} from "@workspace/api-client-react";
import { Download, Loader2, Undo2, Users } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, TextInput, NativeSelect, Pill, Field, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { Money, Table, td, useStudentNames, useFinanceRecords } from "@/components/finance-kit";
import { usePerms, useSession, errMsg, fmtDateTime } from "@/lib/session";
import { useFinanceInvalidate } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

const TONE: Record<string, string> = { pending: "duplicate", requested: "duplicate", approved: "current", rejected: "error", paid: "active", held: "duplicate", completed: "active", partially_approved: "duplicate", acknowledged: "active" };
const tone = (s: string) => TONE[s] ?? "left";

function useInv() {
  const qc = useQueryClient(); const fin = useFinanceInvalidate();
  return () => { fin(); [getListCollectionRefundsQueryKey(), getListSponsorBatchesQueryKey(), getListApprovalInboxQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k })); qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/payments") }); };
}

function RefundActions({ r }: { r: CollectionRefundView }) {
  const p = usePerms(); const me = useSession().user; const { toast } = useToast(); const inv = useInv();
  const decide = useDecideCollectionRefund(); const pay = usePayCollectionRefund();
  const [d, setD] = useState<"" | ModuleDecisionInputDecision>(""); const [text, setText] = useState("");
  const [open, setOpen] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pending = ["pending", "requested"].includes(r.status);
  const openDlg = () => { setD(""); setText(""); setErr(null); setOpen(true); };
  if (pending && p.financeDecide) {
    if (r.requestedBy === me.id) return <Pill tone="left">Your request</Pill>;
    return <>
      <Btn variant="outline" className="h-7 px-2 text-xs" data-testid={`button-decide-refund-${r.id}`} onClick={openDlg}>Decide refund</Btn>
      <FormDialog open={open} onOpenChange={setOpen} busy={decide.isPending} title="Decide refund to payer" description={`KES ${r.amount}${r.reason ? ` · ${r.reason}` : ""}`}>
        <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); if (!d || text.trim().length < 3) return setErr("Choose a decision and give a reason of at least 3 characters.");
          decide.mutate({ id: r.id, data: { decision: d, reason: text.trim() } }, { onSuccess: () => { inv(); setOpen(false); toast({ title: `Refund ${d}` }); }, onError: (x) => setErr(errMsg(x)) }); }}>
          <Field label="Decision" required><NativeSelect data-testid="select-refund-decision" value={d} onChange={(e) => setD(e.target.value as typeof d)}><option value="">Select decision</option><option value="approved">Approve</option><option value="rejected">Reject</option></NativeSelect></Field>
          <Field label="Reason" required><TextInput data-testid="input-refund-decision-reason" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-refund-decision" disabled={decide.isPending}>{decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save decision</Btn><Btn type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
    </>;
  }
  if (r.status === "approved" && p.collect) return <>
    <Btn variant="outline" className="h-7 px-2 text-xs" data-testid={`button-pay-refund-${r.id}`} onClick={openDlg}>Record payout</Btn>
    <FormDialog open={open} onOpenChange={setOpen} busy={pay.isPending} size="sm" title="Record refund payout" description={`KES ${r.amount} approved. Enter the disbursement reference once money has left.`}>
      <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); if (text.trim().length < 3) return setErr("Enter the disbursement reference.");
        pay.mutate({ id: r.id, data: { reference: text.trim() } }, { onSuccess: () => { inv(); setOpen(false); toast({ title: "Refund recorded as paid" }); }, onError: (x) => setErr(errMsg(x)) }); }}>
        <Field label="Disbursement reference" required hint="M-Pesa or bank reference"><TextInput data-testid="input-refund-payout-ref" className="font-mono" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <FormError msg={err} />
        <FormActions><Btn type="submit" data-testid="button-save-refund-payout" disabled={pay.isPending}>{pay.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Mark refund paid</Btn><Btn type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn></FormActions>
      </form>
    </FormDialog>
  </>;
  return null;
}

/** Refunds of money that never belonged to a learner. A different person approves; only approved ones can be paid out. */
export function CollectionRefundsPanel() {
  const q = useListCollectionRefunds({ query: { queryKey: getListCollectionRefundsQueryKey() } });
  return (
    <Panel title="Refunds to payers" note="Requested from the unmatched queue. An independent checker approves, then the payout reference is recorded. No learner account is credited.">
      {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Undo2 className="h-5 w-5" />} title="No refund requests" body="Choose Refund to payer on an unmatched payment to start one." /> : (
        <Table head={["Amount", "Reason", "Status", "Payout ref", ""]}>{q.data.map((r) => (
          <tr key={r.id} data-testid={`row-refund-${r.id}`}><td className={td}><Money v={r.amount} /></td><td className={`${td} text-xs`}>{r.reason ?? "\u2014"}</td><td className={td}><Pill tone={tone(r.status)}>{r.status}</Pill></td><td className={`${td} font-mono text-xs`}>{r.paidReference ?? "\u2014"}</td><td className={td}><RefundActions r={r} /></td></tr>))}</Table>
      )}
    </Panel>
  );
}

export function SponsorBatchesPanel() {
  const q = useListSponsorBatches({ query: { queryKey: getListSponsorBatchesQueryKey() } });
  const sponsors = useFinanceRecords({ kind: "sponsor" });
  const ack = useGenerateSponsorAcknowledgement(); const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const sname = (id: string) => String(sponsors.data?.find((s) => s.id === id)?.data?.name ?? "Sponsor");
  return (
    <Panel title="Sponsor batches" note="Held amounts stay held until approved or explained; they are never spread automatically. Acknowledgement letters are available once every credit is approved.">
      {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Users className="h-5 w-5" />} title="No sponsor batches" body="Allocating a lump sum creates a batch here." /> : (
        <Table head={["Sponsor", "Allocated", "Held", "Status", ""]}>{q.data.map((b) => (
          <tr key={b.id} data-testid={`row-batch-${b.id}`}><td className={td}>{sname(b.sponsorId)}</td><td className={td}><Money v={b.allocatedAmount} /></td><td className={td}><Money v={b.heldAmount} />{b.remainderReason && <div className="text-[11px] text-muted-foreground">{b.remainderReason}</div>}</td><td className={td}><Pill tone={tone(b.status)}>{b.status.replace(/_/g, " ")}</Pill></td>
            <td className={td}><Btn variant="outline" className="h-7 px-2 text-xs" disabled={busy === b.id} onClick={() => { setBusy(b.id); ack.mutate({ id: b.id }, { onSuccess: (d) => { setBusy(null); window.open(d.downloadUrl, "_blank", "noopener"); }, onError: (x) => { setBusy(null); toast({ title: "Acknowledgement not available", description: errMsg(x), variant: "destructive" }); } }); }}>{busy === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Acknowledgement</Btn></td></tr>))}</Table>
      )}
    </Panel>
  );
}

const INBOX_LABEL: Record<string, string> = { collection_refund: "Refund to payer", payment_plan: "Payment plan" };
export function ApprovalInboxPanel() {
  const q = useListApprovalInbox({ query: { queryKey: getListApprovalInboxQueryKey() } });
  const sname = useStudentNames();
  return (
    <Panel title="Inbox" note="Everything waiting for a checker, across finance requests, refunds and plans. Refunds are decided under Reconciliation, plans under Payment plans.">
      {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <p className="p-5 text-sm text-muted-foreground">Nothing waiting.</p> : (
        <Table head={["Type", "Learner", "Amount", "Raised", ""]}>{q.data.map((i) => (
          <tr key={`${i.type}${i.id}`}><td className={td}>{INBOX_LABEL[i.type] ?? i.type.replace(/_/g, " ")}</td><td className={td}>{sname(i.studentId)}</td><td className={td}><Money v={i.amount} /></td><td className={`${td} text-xs`}>{fmtDateTime(i.createdAt)}</td><td className={td}>{i.canApprove ? <Pill tone="current">You can decide</Pill> : <Pill tone="left">Another checker</Pill>}</td></tr>))}</Table>
      )}
    </Panel>
  );
}
