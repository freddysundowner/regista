import { useState, type FormEvent } from "react";
import { useCreateFinanceRecord, type FinanceRecord, type FinanceInputChequeStatus } from "@workspace/api-client-react";
import { Banknote, Loader2, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useFinanceRecords, useStudentNames, StatusPill, Money, MoneyInput, StudentPicker, DocumentButton, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime, TZ } from "@/lib/session";

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
import { useFinanceInvalidate, useIdemKey, validMoney, rd } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { StkPanel } from "@/components/stk";
import { FormDialog } from "@/components/form-dialog";


const empty = { studentId: "", amount: "", channel: "cash" as "cash" | "cheque", providerTxnId: "", transactionTime: "", payerName: "", payerPhone: "", chequeNo: "", bank: "", drawer: "" };

function RecordPayment({ onDone }: { onDone: () => void }) {
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId) return setErr("Choose the student.");
    if (!validMoney(f.amount)) return setErr("Enter the exact amount received, e.g. 15000 or 15000.50.");
    if (!f.providerTxnId.trim()) return setErr("Enter the receipt book or reference number.");
    if (f.channel === "cheque" && (!f.chequeNo.trim() || !f.bank.trim() || !f.drawer.trim())) return setErr("Cheques need cheque number, bank and drawer.");
    create.mutate({ data: {
      kind: "payment", idempotencyKey: idem.key, studentId: f.studentId, amount: f.amount.trim(), channel: f.channel, providerTxnId: f.providerTxnId.trim(),
      ...(f.transactionTime ? { transactionTime: new Date(`${f.transactionTime}:00+03:00`).toISOString() } : {}),
      ...(f.payerName.trim() ? { payerName: f.payerName.trim() } : {}), ...(f.payerPhone.trim() ? { payerPhone: f.payerPhone.trim() } : {}),
      ...(f.channel === "cheque" ? { chequeNo: f.chequeNo.trim(), bank: f.bank.trim(), drawer: f.drawer.trim() } : {}),
    } }, {
      onSuccess: (r) => { idem.renew(); inv(); toast({ title: "Payment posted", description: `Receipt ${rd(r, "receiptNo") ?? ""}. Download it from the list.` }); setF(empty); onDone(); },
      onError: (x) => setErr(`${errMsg(x)} Retrying with the same details is safe; it will not post twice.`),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
        <Field label="Amount (KES)" required><MoneyInput testid="input-payment-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Channel" required><NativeSelect data-testid="select-channel" value={f.channel} onChange={set("channel")}><option value="cash">Cash</option><option value="cheque">Cheque</option></NativeSelect></Field>
        <Field label="Receipt book / reference no." required><TextInput data-testid="input-provider-ref" value={f.providerTxnId} onChange={set("providerTxnId")} className="font-mono" /></Field>
        <Field label="Received at" hint="Nairobi time; blank = now"><TextInput type="datetime-local" value={f.transactionTime} onChange={set("transactionTime")} /></Field>
        <Field label="Payer name"><TextInput value={f.payerName} onChange={set("payerName")} /></Field>
        <Field label="Payer phone"><TextInput type="tel" value={f.payerPhone} onChange={set("payerPhone")} /></Field>
        {f.channel === "cheque" && <>
          <Field label="Cheque no." required><TextInput data-testid="input-cheque-no" value={f.chequeNo} onChange={set("chequeNo")} className="font-mono" /></Field>
          <Field label="Bank" required><TextInput data-testid="input-bank" value={f.bank} onChange={set("bank")} placeholder="KCB, Equity" /></Field>
          <Field label="Drawer" required><TextInput data-testid="input-drawer" value={f.drawer} onChange={set("drawer")} /></Field>
        </>}
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-payment" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Post payment</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function ChequeAction({ r, onDone }: { r: FinanceRecord; onDone: () => void }) {
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [st, setSt] = useState<"" | FinanceInputChequeStatus>("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(`${r.id}${st}${reason}`);
  const cur = rd(r, "chequeStatus") ?? "received";
  const next: FinanceInputChequeStatus[] = cur === "received" ? ["banked", "bounced"] : cur === "banked" ? ["cleared", "bounced"] : cur === "cleared" ? ["bounced"] : [];
  if (!next.length) return null;
  return (
    <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); if (!st || reason.trim().length < 3) return setErr("Choose a status and give a reason of at least 3 characters.");
      create.mutate({ data: { kind: "cheque_status", idempotencyKey: idem.key, parentId: r.id, studentId: r.studentId ?? undefined, chequeStatus: st, reason: reason.trim() } }, {
        onSuccess: (x) => { idem.renew(); inv(); setSt(""); setReason(""); toast({ title: x.status === "pending" ? "Bounce sent for approval" : `Cheque marked ${st}`, description: x.status === "pending" ? "The payment is reversed only after a checker approves." : undefined }); onDone(); },
        onError: (x) => setErr(errMsg(x)) }); }}>
      <p className="text-sm text-muted-foreground">Cheque #{rd(r, "chequeNo")} · {rd(r, "bank")} · currently <strong className="capitalize">{cur}</strong>. Bouncing a cheque needs a checker's approval before the payment is reversed.</p>
      <Field label="New status" required><NativeSelect data-testid="select-cheque-status" value={st} onChange={(e) => setSt(e.target.value as typeof st)}><option value="">Select status</option>{next.map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}</NativeSelect></Field>
      <Field label="Reason" required><TextInput data-testid="input-cheque-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-cheque-status" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Update cheque status</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Payments() {
  const p = usePerms();
  const q = useFinanceRecords({ kind: "payment" });
  const cs = useFinanceRecords({ kind: "cheque_status" });
  const sname = useStudentNames();
  const [open, setOpen] = useState(false);
  const [cheque, setCheque] = useState<FinanceRecord | null>(null);
  const [fl, setFl] = useState({ text: "", channel: "", status: "", cheque: "", from: "", to: "" });
  const pendingBounce = new Set((cs.data ?? []).filter((c) => c.status === "pending").map((c) => c.parentId));
  const list = (q.data ?? []).filter((r) => { const day = dayOf(rd(r, "transactionTime") ?? r.createdAt); return (!fl.from || day >= fl.from) && (!fl.to || day <= fl.to); }).filter((r) => (!fl.channel || rd(r, "channel") === fl.channel) && (!fl.status || r.status === fl.status) && (!fl.cheque || (rd(r, "chequeStatus") ?? "received") === fl.cheque)
    && (!fl.text || `${sname(r.studentId)} ${rd(r, "receiptNo") ?? ""} ${rd(r, "providerTxnId") ?? ""}`.toLowerCase().includes(fl.text.toLowerCase())));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Collections" title="Payments" meta={p.bursar ? "Record cash and cheques. Posted payments are final; corrections go through Approvals." : "Read-only. Only the bursar records payments."}>
        {p.collect && <StkPanel />}
        {p.bursar && <Btn data-testid="button-new-payment" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record payment</Btn>}
      </PageHeader>
      {p.bursar && <FormDialog open={open} onOpenChange={setOpen} size="lg" title="Record a cash or cheque payment" description="Each submission carries a unique key; a retry after a network error cannot double-post."><RecordPayment onDone={() => setOpen(false)} /></FormDialog>}
      {p.bursar && <FormDialog open={!!cheque} onOpenChange={(o) => { if (!o) setCheque(null); }} title="Update cheque status" description={cheque ? `${sname(cheque.studentId)} · receipt ${rd(cheque, "receiptNo") ?? ""}` : undefined}>{cheque && <ChequeAction key={cheque.id} r={cheque} onDone={() => setCheque(null)} />}</FormDialog>}
      <Panel>
        <div className="grid gap-2 border-b border-border/70 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <TextInput aria-label="Search payments" placeholder="Student, receipt or reference" value={fl.text} onChange={(e) => setFl({ ...fl, text: e.target.value })} />
          <NativeSelect aria-label="Channel" value={fl.channel} onChange={(e) => setFl({ ...fl, channel: e.target.value })}><option value="">All channels</option><option value="cash">Cash</option><option value="cheque">Cheque</option></NativeSelect>
          <TextInput aria-label="Received from (Nairobi date)" type="date" value={fl.from} onChange={(e) => setFl({ ...fl, from: e.target.value })} />
          <TextInput aria-label="Received to (Nairobi date)" type="date" value={fl.to} min={fl.from || undefined} onChange={(e) => setFl({ ...fl, to: e.target.value })} />
          <NativeSelect aria-label="Status" value={fl.status} onChange={(e) => setFl({ ...fl, status: e.target.value })}><option value="">All statuses</option><option value="posted">Posted</option><option value="reversed">Reversed</option></NativeSelect>
          <NativeSelect aria-label="Cheque stage" value={fl.cheque} onChange={(e) => setFl({ ...fl, cheque: e.target.value, channel: e.target.value ? "cheque" : fl.channel })}><option value="">Any cheque stage</option><option value="received">Received</option><option value="banked">Banked</option><option value="cleared">Cleared</option><option value="bounced">Bounced</option></NativeSelect>
        </div>
        {q.isLoading ? <SkeletonRows cols={6} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<Banknote className="h-5 w-5" />} title={q.data?.length ? "No payments match" : "No payments yet"} body="Posted payments appear here with downloadable receipts." /> : (
          <Table head={["Receipt", "Student", "Channel", "Amount", "Received", "Status", ""]}>{list.map((r) => (
            <tr key={r.id} data-testid={`row-payment-${r.id}`}>
              <td className={`${td} font-mono text-xs`}>{rd(r, "receiptNo") ?? "\u2014"}<div className="text-muted-foreground">{rd(r, "providerTxnId")}</div></td>
              <td className={td}>{sname(r.studentId)}{rd(r, "payerName") && <div className="text-xs text-muted-foreground">Paid by {rd(r, "payerName")}</div>}</td>
              <td className={`${td} text-xs`}><span className="capitalize">{rd(r, "channel")}</span>{rd(r, "channel") === "cheque" && <div className="text-muted-foreground">#{rd(r, "chequeNo")} · {rd(r, "bank")} · {rd(r, "drawer")}<div className="mt-1"><Pill tone={rd(r, "chequeStatus") === "bounced" ? "error" : rd(r, "chequeStatus") === "cleared" ? "active" : "current"}>{rd(r, "chequeStatus") ?? "received"}</Pill>{pendingBounce.has(r.id) && <span className="ml-1"><Pill tone="duplicate">Bounce pending</Pill></span>}</div></div>}</td>
              <td className={td}><Money v={r.amount} /></td>
              <td className={`${td} text-xs`}>{fmtDateTime(rd(r, "transactionTime") ?? r.createdAt)}</td>
              <td className={td}><StatusPill status={r.status} /></td>
              <td className={td}><div className="flex flex-col items-start gap-1">{r.status === "posted" && <DocumentButton type="receipt" referenceId={r.id} fileName={rd(r, "receiptNo") ?? "receipt"} />}{p.bursar && rd(r, "channel") === "cheque" && r.status === "posted" && !pendingBounce.has(r.id) && rd(r, "chequeStatus") !== "bounced" && <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-cheque-${r.id}`} onClick={() => setCheque(r)}>Update cheque</Btn>}</div></td>
            </tr>))}</Table>
        )}
      </Panel>
    </div>
  );
}
