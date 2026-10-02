import { useState, type FormEvent } from "react";
import { useCreateFinanceRecord, useDecideFinanceRecord, type FinanceRecord, type FinanceInputAdjustmentType } from "@workspace/api-client-react";
import { CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useFinanceRecords, useStudentNames, useTermNames, useFeeItemNames, StatusPill, Money, MoneyInput, StudentPicker, TermSelect, RecordSelect, Table, td } from "@/components/finance-kit";
import { usePerms, useSession, errMsg, fmtDateTime } from "@/lib/session";
import { useFinanceInvalidate, useIdemKey, validMoney, rd, recLines, recordTitle, KIND_LABEL, ADJ_LABEL, SPONSOR_LABEL } from "@/lib/finance";
import { ApprovalInboxPanel } from "@/components/collections-extra";
import { useToast } from "@/hooks/use-toast";

const REQUEST_KINDS = ["adjustment", "refund", "reversal", "fee_structure", "cheque_status"];

function Detail({ r, label }: { r: FinanceRecord; label: (id: string) => string }) {
  const sname = useStudentNames(); const term = useTermNames(); const item = useFeeItemNames();
  const bits: [string, string | undefined][] = [
    ["Student", r.studentId ? sname(r.studentId) : undefined], ["Term", r.termId ? term(r.termId) : undefined],
    ["Type", rd(r, "adjustmentType") ? ADJ_LABEL[rd(r, "adjustmentType")!] : undefined], ["Reason", rd(r, "reason")], ["Method", rd(r, "method")],
    ["Reference", rd(r, "reference")], ["Cheque status", rd(r, "chequeStatus")], ["Recurring", r.data?.recurring ? "Yes, future term invoices" : undefined],
    ["Original record", r.parentId ? label(r.parentId) : undefined], ["Version", rd(r, "version")], ["Decision note", rd(r, "decisionReason")], ["Payout reference", r.kind === "refund_paid" ? rd(r, "reference") : undefined],
  ];
  return <div className="space-y-0.5 text-xs">{bits.filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{k}:</span> {v}</div>)}
    {recLines(r).map((l, i) => <div key={i} className="font-mono">{item(l.feeItemId)} {l.amount}</div>)}</div>;
}

function Decide({ r }: { r: FinanceRecord }) {
  const decide = useDecideFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const go = (decision: "approved" | "rejected") => {
    if (reason.trim().length < 3) return void toast({ title: "Give a reason for your decision", variant: "destructive" });
    decide.mutate({ id: r.id, data: { decision, reason: reason.trim() } }, {
      onSuccess: () => { inv(); toast({ title: decision === "approved" ? "Approved and posted" : "Rejected" }); },
      onError: (x) => toast({ title: "Decision failed", description: errMsg(x), variant: "destructive" }),
    });
  };
  return <div className="flex min-w-[14rem] flex-col gap-1">
    <TextInput aria-label="Decision reason" data-testid={`input-decision-${r.id}`} placeholder="Reason (required)" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} />
    <div className="flex gap-1"><Btn className="h-7 px-2 text-xs" data-testid={`button-approve-${r.id}`} disabled={decide.isPending} onClick={() => go("approved")}>Approve</Btn><Btn variant="danger" className="h-7 px-2 text-xs" data-testid={`button-reject-${r.id}`} disabled={decide.isPending} onClick={() => go("rejected")}>Reject</Btn></div>
  </div>;
}

type Req = "adjustment" | "reversal" | "refund" | "refund_paid";
const emptyF = { studentId: "", amount: "", adjustmentType: "discount" as FinanceInputAdjustmentType, reason: "", sponsorId: "", recurring: false, termId: "", parentId: "", reference: "", method: "mpesa" };

function RequestForm({ kind, onDone }: { kind: Req; onDone: () => void }) {
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const sponsors = useFinanceRecords({ kind: "sponsor" });
  const refunds = useFinanceRecords({ kind: "refund" });
  const paid = useFinanceRecords({ kind: "refund_paid" });
  const sname = useStudentNames();
  const { toast } = useToast();
  const [f, setF] = useState(emptyF);
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify([kind, f]));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const isCorrection = kind === "adjustment" && f.adjustmentType === "correction";
  const needsSponsor = kind === "adjustment" && (f.adjustmentType === "bursary" || f.adjustmentType === "sponsorship");
  const paidIds = new Set((paid.data ?? []).map((r) => r.parentId));
  const payable = (refunds.data ?? []).filter((r) => r.status === "approved" && !paidIds.has(r.id));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const reason = f.reason.trim();
    let data: Parameters<typeof create.mutate>[0]["data"];
    if (kind === "refund_paid") {
      const ref = payable.find((r) => r.id === f.parentId);
      if (!ref || !f.reference.trim()) return setErr("Choose the approved refund and enter the payout reference.");
      data = { kind, idempotencyKey: idem.key, parentId: ref.id, studentId: ref.studentId ?? undefined, reference: f.reference.trim() };
    } else {
      if (!f.studentId) return setErr("Choose the student.");
      if (reason.length < 3) return setErr("Give a reason; the checker sees it.");
      if (kind === "reversal") {
        if (!f.parentId) return setErr("Choose the payment or adjustment to reverse.");
        data = { kind, idempotencyKey: idem.key, studentId: f.studentId, parentId: f.parentId, reason };
      } else {
        if (!validMoney(f.amount)) return setErr("Enter an exact amount, e.g. 2500 or 2500.50.");
        if (kind === "refund") data = { kind, idempotencyKey: idem.key, studentId: f.studentId, amount: f.amount.trim(), reason, method: f.method, ...(f.parentId ? { parentId: f.parentId } : {}) };
        else {
          if (needsSponsor && !f.sponsorId) return setErr("Bursaries and sponsorships need a sponsor.");
          if (isCorrection && !f.parentId) return setErr("Corrections need the original payment or adjustment.");
          data = { kind, idempotencyKey: idem.key, studentId: f.studentId, amount: f.amount.trim(), adjustmentType: f.adjustmentType, reason, recurring: f.recurring,
            ...(needsSponsor ? { sponsorId: f.sponsorId } : {}), ...(f.termId ? { termId: f.termId } : {}), ...(f.parentId ? { parentId: f.parentId } : {}), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}) };
        }
      }
    }
    create.mutate({ data }, {
      onSuccess: (r) => { idem.renew(); inv(); toast({ title: r.status === "pending" ? "Request sent for approval" : "Recorded", description: r.status === "pending" ? "Nothing is posted until a principal or admin approves." : undefined }); setF(emptyF); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "refund_paid" ? <>
          <Field label="Approved refund" required className="sm:col-span-2"><NativeSelect data-testid="select-refund" value={f.parentId} onChange={set("parentId")}><option value="">{payable.length ? "Select" : "No approved unpaid refunds"}</option>{payable.map((r) => <option key={r.id} value={r.id}>{sname(r.studentId)} · {r.amount} · {rd(r, "method")}</option>)}</NativeSelect></Field>
          <Field label="Payout reference" required hint="M-Pesa code or cheque no."><TextInput data-testid="input-payout-ref" className="font-mono" value={f.reference} onChange={set("reference")} /></Field>
        </> : <>
          <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v, parentId: "" })} />
          {kind === "adjustment" && <Field label="Type" required><NativeSelect data-testid="select-adjustment-type" value={f.adjustmentType} onChange={(e) => setF({ ...f, adjustmentType: e.target.value as FinanceInputAdjustmentType, parentId: "" })}>{Object.entries(ADJ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>}
          {kind !== "reversal" && <Field label="Amount (KES)" required hint={isCorrection ? "Must equal the original exactly" : undefined}><MoneyInput testid="input-request-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>}
          {needsSponsor && <Field label="Sponsor" required><NativeSelect data-testid="select-sponsor" value={f.sponsorId} onChange={set("sponsorId")}><option value="">{sponsors.data?.length ? "Select sponsor" : "Add a sponsor first"}</option>{sponsors.data?.map((s) => <option key={s.id} value={s.id}>{rd(s, "name")} ({SPONSOR_LABEL[rd(s, "sponsorType") ?? ""] ?? rd(s, "sponsorType")})</option>)}</NativeSelect></Field>}
          {kind === "adjustment" && !isCorrection && <RecordSelect studentId={f.studentId} kinds={["invoice"]} label="Against invoice" value={f.parentId} onChange={(r) => setF({ ...f, parentId: r?.id ?? "" })} />}
          {(isCorrection || kind === "reversal") && <RecordSelect studentId={f.studentId} kinds={kind === "reversal" ? ["payment", "adjustment", "invoice"] : ["payment", "adjustment"]} filter={(r) => ["posted", "approved", "open", "partially_paid", "paid"].includes(r.status) && !(r.kind === "adjustment" && r.data?.recurring)} label={isCorrection ? "Original to correct" : "Record to reverse"} required value={f.parentId} onChange={(r) => setF({ ...f, parentId: r?.id ?? "", amount: isCorrection && r ? r.amount : f.amount })} />}
          {kind === "refund" && <>
            <Field label="Method" required><NativeSelect data-testid="select-refund-method" value={f.method} onChange={set("method")}><option value="mpesa">M-Pesa</option><option value="cheque">Cheque</option><option value="bank">Bank transfer</option><option value="cash">Cash</option></NativeSelect></Field>
            <RecordSelect studentId={f.studentId} kinds={["payment"]} filter={(r) => r.status === "posted"} label="From payment" value={f.parentId} onChange={(r) => setF({ ...f, parentId: r?.id ?? "" })} />
          </>}
          {kind === "adjustment" && <>
            <TermSelect value={f.termId} allowNone="No specific term" onChange={(v) => setF({ ...f, termId: v })} />
            <Field label="Reference"><TextInput value={f.reference} onChange={set("reference")} placeholder="Letter or board minute no." /></Field>
            {!isCorrection && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input data-testid="check-recurring" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} /> Recurring: apply to future term invoices</label>}
          </>}
          <Field label="Reason" required className="sm:col-span-2"><TextInput data-testid="input-request-reason" value={f.reason} onChange={set("reason")} /></Field>
        </>}
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-submit-request" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{kind === "refund_paid" ? "Record payout" : "Submit for approval"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Approvals() {
  const p = usePerms();
  const me = useSession().user;
  const q = useFinanceRecords();
  const sname = useStudentNames();
  const [req, setReq] = useState<Req | null>(null);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const all = (q.data ?? []).filter((r) => REQUEST_KINDS.includes(r.kind) && (r.kind !== "cheque_status" || r.status !== "posted"));
  const pending = all.filter((r) => r.status === "pending");
  const decided = all.filter((r) => r.status !== "pending");
  const rows = tab === "pending" ? pending : decided;
  const label = (id: string) => { const x = q.data?.find((y) => y.id === id); return x ? `${recordTitle(x)} (${KIND_LABEL[x.kind] ?? x.kind}, KES ${x.amount})` : "Linked record"; };
  const REQ_LABEL: Record<Req, string> = { adjustment: "Adjustment", reversal: "Reversal", refund: "Refund", refund_paid: "Refund payout" };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Maker-checker" title="Approvals" meta={p.financeDecide ? "Review requests. You cannot decide a request you raised." : p.bursar ? "Raise adjustments, reversals and refunds. A principal or admin approves them." : "Read-only."}>
        {p.bursar && (Object.keys(REQ_LABEL) as Req[]).map((k) => <Btn key={k} variant={req === k ? "primary" : "outline"} data-testid={`button-request-${k}`} onClick={() => setReq(req === k ? null : k)}>{REQ_LABEL[k]}</Btn>)}
      </PageHeader>
      {req && <Panel title={req === "refund_paid" ? "Record approved refund as paid" : `Request ${REQ_LABEL[req].toLowerCase()}`} note={req === "reversal" ? "Reversing an invoice cancels it; payments and adjustments are reversed with a new entry." : req === "adjustment" ? "Discount, sibling discount, waiver, bursary, sponsorship, write-off or correction. Corrections reverse the original on approval." : req === "refund_paid" ? "Marks it paid; no second ledger debit." : "Pending until approved."}><RequestForm key={req} kind={req} onDone={() => setReq(null)} /></Panel>}
      {p.financeRead && <ApprovalInboxPanel />}
      <Panel title={tab === "pending" ? "Awaiting decision" : "Decided"} action={<div className="flex gap-1" role="tablist">
        <Btn role="tab" aria-selected={tab === "pending"} variant={tab === "pending" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("pending")}>Pending ({pending.length})</Btn>
        <Btn role="tab" aria-selected={tab === "decided"} variant={tab === "decided" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("decided")}>History</Btn></div>}>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? <Empty icon={tab === "pending" ? <CheckCircle2 className="h-5 w-5" /> : <Inbox className="h-5 w-5" />} title={tab === "pending" ? "Inbox clear" : "No decisions yet"} body={tab === "pending" ? "Nothing waits for approval." : "Approved and rejected requests appear here."} /> : (
          <Table head={["Request", "Student", "Amount", "Details", "Raised", "Status", ""]}>{rows.map((r) => {
            const mine = r.requestedBy === me.id;
            return <tr key={r.id} data-testid={`row-request-${r.id}`}>
              <td className={`${td} font-semibold`}>{recordTitle(r)}<div className="text-xs font-normal text-muted-foreground">{KIND_LABEL[r.kind]}</div></td>
              <td className={td}>{sname(r.studentId)}</td><td className={td}><Money v={r.amount} /></td><td className={td}><Detail r={r} label={label} /></td>
              <td className={`${td} text-xs`}>{fmtDateTime(r.createdAt)}<div className="text-muted-foreground">{mine ? "by you" : "by another staff member"}</div>{r.approvedAt && <div className="text-muted-foreground">Decided {fmtDateTime(r.approvedAt)}</div>}</td>
              <td className={td}><StatusPill status={r.status} /></td>
              <td className={td}>{r.status === "pending" && p.financeDecide && (mine ? <Pill tone="left">Your request</Pill> : <Decide r={r} />)}</td>
            </tr>;
          })}</Table>
        )}
      </Panel>
    </div>
  );
}
