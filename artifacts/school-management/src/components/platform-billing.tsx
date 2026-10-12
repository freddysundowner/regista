import { useRef, useState, type FormEvent } from "react";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlatformBilling, useCreatePlatformInvoice, useRecordPlatformPayment, useVoidPlatformInvoice, useReversePlatformPayment,
  getGetPlatformBillingQueryKey, getListPlatformAuditQueryKey, getGetPlatformSubscriptionsQueryKey, PlatformPaymentInputMethod,
  type PlatformInvoice, type PlatformBillingPayment, type School,
} from "@workspace/api-client-react";
import { Ban, Banknote, FileText, Loader2, Plus, ReceiptText, Undo2 } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, fmtDate, fmtDateTime, localToday } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { invalidateLicensing } from "@/lib/licensing";

const AMOUNT_RE = /^[0-9]{1,10}(\.[0-9]{1,2})?$/;
/** Exact cents from a decimal string; safe up to 10 integer digits. */
export function cents(s: string | null | undefined) {
  if (!s) return 0;
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = Number(i || "0") * 100 + Number((f + "00").slice(0, 2));
  return neg ? -v : v;
}
export function kes(s: string | null | undefined) {
  const c = cents(s);
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${c < 0 ? "-" : ""}KES ${int}.${String(abs % 100).padStart(2, "0")}`;
}
function today() {
  return localToday();
}
export const TONE: Record<string, string> = { paid: "active", partial: "duplicate", unpaid: "inactive", overdue: "error", void: "inactive" };
export const METHOD: Record<string, string> = { bank: "Bank transfer", mpesa: "M-Pesa", cash: "Cash", other: "Other" };
export const canPay = (i: PlatformInvoice) => i.status !== "void" && i.status !== "paid" && cents(i.balance) > 0;
export const canVoid = (i: PlatformInvoice) => i.status !== "void" && cents(i.paid) === 0;

function useRefreshBilling(schoolId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetPlatformBillingQueryKey(schoolId) });
    qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey().slice(0, 1) });
    // Central Subscriptions page (all schools, every page/search variant).
    qc.invalidateQueries({ queryKey: getGetPlatformSubscriptionsQueryKey().slice(0, 1) });
    // Settling or reversing a renewal invoice activates or suspends its linked licence.
    invalidateLicensing(qc, schoolId);
  };
}

/** One requestId per draft: kept across retries of the same payload, rotated if the payload changes. */
function useRequestId() {
  const id = useRef(crypto.randomUUID());
  const sent = useRef<string | null>(null);
  return (payload: unknown) => {
    const sig = JSON.stringify(payload);
    if (sent.current !== null && sent.current !== sig) id.current = crypto.randomUUID();
    sent.current = sig;
    return id.current;
  };
}

function InvoiceForm({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const refresh = useRefreshBilling(schoolId);
  const { toast } = useToast();
  const m = useCreatePlatformInvoice();
  const reqId = useRequestId();
  const t = today();
  const [f, setF] = useState({ description: "", amount: "", issuedOn: t, dueOn: "", periodStart: "", periodEnd: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const d = f.description.trim(), a = f.amount.trim().replace(/,/g, "");
    if (d.length < 3 || d.length > 250) return setErr("Description must be 3 to 250 characters.");
    if (!AMOUNT_RE.test(a) || cents(a) <= 0) return setErr("Enter an amount above zero, up to 2 decimal places.");
    if (!f.issuedOn || !f.dueOn) return setErr("Issue and due dates are required.");
    if (f.dueOn < f.issuedOn) return setErr("Due date cannot be before the issue date.");
    if (!!f.periodStart !== !!f.periodEnd) return setErr("Give both period dates or leave both empty.");
    if (f.periodStart && f.periodEnd < f.periodStart) return setErr("Period end must be on or after period start.");
    const payload = { description: d, amount: a, issuedOn: f.issuedOn, dueOn: f.dueOn, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null };
    m.mutate({ schoolId, data: { requestId: reqId(payload), ...payload } }, {
      onSuccess: (inv) => { refresh(); toast({ title: `Invoice ${inv.number} issued`, description: kes(inv.amount) }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" required className="sm:col-span-2"><TextInput data-testid="input-invoice-description" required minLength={3} maxLength={250} value={f.description} onChange={set("description")} placeholder="Standard plan, Term 2 2025" /></Field>
        <Field label="Amount (KES)" required hint="Up to 2 decimal places"><TextInput data-testid="input-invoice-amount" required inputMode="decimal" className="font-mono" value={f.amount} onChange={set("amount")} placeholder="18500.00" /></Field>
        <div className="hidden sm:block" />
        <Field label="Issued on" required><TextInput data-testid="input-invoice-issued" type="date" required value={f.issuedOn} onChange={set("issuedOn")} /></Field>
        <Field label="Due on" required><TextInput data-testid="input-invoice-due" type="date" required min={f.issuedOn} value={f.dueOn} onChange={set("dueOn")} /></Field>
        <Field label="Period start" hint="Optional service period"><TextInput data-testid="input-invoice-period-start" type="date" value={f.periodStart} onChange={set("periodStart")} /></Field>
        <Field label="Period end"><TextInput data-testid="input-invoice-period-end" type="date" min={f.periodStart || undefined} value={f.periodEnd} onChange={set("periodEnd")} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Issued invoices cannot be edited. To correct one, void it and issue a new invoice. Issuing does not change the school's subscription or access.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-invoice" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Issue invoice</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function PaymentForm({ schoolId, invoice, onDone }: { schoolId: string; invoice: Pick<PlatformInvoice, "id" | "number" | "amount" | "balance">; onDone: () => void }) {
  const refresh = useRefreshBilling(schoolId);
  const { toast } = useToast();
  const m = useRecordPlatformPayment();
  const reqId = useRequestId();
  const t = today();
  const [f, setF] = useState({ amount: invoice.balance, paidOn: t, method: "mpesa" as string, reference: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const a = f.amount.trim().replace(/,/g, "");
    if (!AMOUNT_RE.test(a) || cents(a) <= 0) return setErr("Enter an amount above zero, up to 2 decimal places.");
    if (cents(a) > cents(invoice.balance)) return setErr(`Amount exceeds the outstanding balance of ${kes(invoice.balance)}.`);
    if (!f.paidOn || f.paidOn > t) return setErr("Payment date cannot be in the future.");
    const r = f.reference.trim();
    if (r.length < 2 || r.length > 120) return setErr("Reference must be 2 to 120 characters.");
    const payload = { amount: a, paidOn: f.paidOn, method: f.method as PlatformPaymentInputMethod, reference: r };
    m.mutate({ schoolId, invoiceId: invoice.id, data: { requestId: reqId(payload), ...payload } }, {
      onSuccess: (inv) => { refresh(); toast({ title: `Payment recorded on ${inv.number}`, description: `Balance ${kes(inv.balance)}` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Invoiced</div><div className="font-mono">{kes(invoice.amount)}</div></div>
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Outstanding</div><div className="font-mono font-semibold">{kes(invoice.balance)}</div></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (KES)" required><TextInput data-testid="input-payment-amount" required inputMode="decimal" className="font-mono" value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Paid on" required><TextInput data-testid="input-payment-date" type="date" required max={t} value={f.paidOn} onChange={set("paidOn")} /></Field>
        <Field label="Method"><NativeSelect data-testid="select-payment-method" value={f.method} onChange={set("method")}>{Object.values(PlatformPaymentInputMethod).map((v) => <option key={v} value={v}>{METHOD[v]}</option>)}</NativeSelect></Field>
        <Field label="Reference" required hint="Bank or M-Pesa transaction code"><TextInput data-testid="input-payment-reference" required minLength={2} maxLength={120} className="font-mono" value={f.reference} onChange={set("reference")} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Records money already received outside the app. Nothing is charged. If this fully settles a licence-renewal invoice, its licence activates automatically.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-payment" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record payment</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function CorrectionForm({ schoolId, invoice, payment, onDone }: { schoolId: string; invoice: Pick<PlatformInvoice, "id" | "number"> & { amount?: string }; payment?: Pick<PlatformBillingPayment, "id" | "amount" | "reference">; onDone: () => void }) {
  const refresh = useRefreshBilling(schoolId);
  const { toast } = useToast();
  const voider = useVoidPlatformInvoice();
  const reverser = useReversePlatformPayment();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const pending = voider.isPending || reverser.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = reason.trim();
    if (r.length < 3 || r.length > 500) return setErr("Reason must be 3 to 500 characters.");
    const opts = { onError: (x: unknown) => setErr(errMsg(x)) };
    if (payment) reverser.mutate({ schoolId, invoiceId: invoice.id, paymentId: payment.id, data: { reason: r } }, { ...opts, onSuccess: () => { refresh(); toast({ title: "Payment reversed", description: `${kes(payment.amount)} on ${invoice.number}` }); onDone(); } });
    else voider.mutate({ schoolId, invoiceId: invoice.id, data: { reason: r } }, { ...opts, onSuccess: () => { refresh(); toast({ title: `Invoice ${invoice.number} voided` }); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <p className="text-sm">{payment
        ? `Reverses ${kes(payment.amount)} (${payment.reference}). The payment stays in the history marked reversed, and the balance is restored. If this invoice backs a paid licence, that licence is suspended until the invoice is fully paid again.`
        : `Voids ${invoice.number} for ${kes(invoice.amount)}. It stays on record and no longer counts as owed. Issue a new invoice if a corrected amount is due.`}</p>
      <Field label="Reason" required hint="3 to 500 characters; recorded in the platform audit log">
        <textarea data-testid="input-correction-reason" required minLength={3} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/20" />
      </Field>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-correction" type="submit" variant="danger" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{payment ? "Reverse payment" : "Void invoice"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="min-w-0 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{k}</div><div className={`mt-0.5 truncate font-mono text-sm font-semibold ${tone ?? ""}`}>{v}</div></div>;
}

type Dlg = { kind: "create" } | { kind: "view" | "pay" | "void"; id: string } | { kind: "reverse"; id: string; paymentId: string } | null;

export function BillingPanel({ school }: { school: School }) {
  const q = useGetPlatformBilling(school.id, { query: { queryKey: getGetPlatformBillingQueryKey(school.id), enabled: !!school.id, refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const [dlg, setDlg] = useState<Dlg>(null);
  const [draft, setDraft] = useState(0);
  const inReview = school.status === "pending" || school.status === "rejected";
  const b = q.data;
  const { rows: invoiceRows, pager } = usePaged(b?.invoices);
  // Always resolve the dialog invoice from fresh query data so details update after each correction.
  const inv = dlg && dlg.kind !== "create" ? b?.invoices.find((i) => i.id === dlg.id) : undefined;
  const pay = dlg?.kind === "reverse" ? inv?.payments.find((p) => p.id === dlg.paymentId) : undefined;
  const back = () => setDlg(inv ? { kind: "view", id: inv.id } : null);
  const openCreate = () => { setDraft((n) => n + 1); setDlg({ kind: "create" }); };

  return (
    <Panel title="Invoices & payments" note="Record bank or cash payments here. Paying a renewal invoice in full activates its licence."
      action={<Btn className="h-8" data-testid="button-new-invoice" disabled={inReview || !b} title={inReview ? "Available after the registration is approved" : undefined} onClick={openCreate}><Plus className="h-4 w-4" />Invoice</Btn>}>
      {q.isLoading ? <SkeletonRows rows={3} cols={4} /> : q.isError || !b ? <ErrorState msg={errMsg(q.error, "Could not load billing.")} onRetry={() => q.refetch()} /> : <>
        <div className="grid grid-cols-2 divide-border/60 border-b border-border/60 sm:grid-cols-4 sm:divide-x">
          <Stat k="Billed" v={kes(b.totalBilled)} />
          <Stat k="Paid" v={kes(b.totalPaid)} />
          <Stat k="Outstanding" v={kes(b.outstanding)} />
          <Stat k="Overdue" v={kes(b.overdue)} tone={cents(b.overdue) > 0 ? "text-destructive" : undefined} />
        </div>
        {!b.invoices.length ? (
          <Empty icon={<ReceiptText className="h-5 w-5" />} title="No invoices yet" body={inReview ? "Billing opens once this registration is approved." : "Issue a subscription invoice, then record payments as they arrive."} />
        ) : (
          <ul className="divide-y divide-border/60" data-testid="list-invoices">{invoiceRows.map((i) => (
            <li key={i.id} data-testid={`row-invoice-${i.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <button type="button" onClick={() => setDlg({ kind: "view", id: i.id })} className="min-w-0 flex-1 text-left" data-testid={`button-view-invoice-${i.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono">{i.number}</span><Pill tone={TONE[i.status] ?? "inactive"}>{i.status}</Pill></div>
                <div className={`truncate text-xs text-muted-foreground ${i.status === "void" ? "line-through" : ""}`}>{i.description} · due {fmtDate(i.dueOn)}</div>
              </button>
              <div className="text-right font-mono text-xs"><div className="font-semibold">{kes(i.amount)}</div>{i.status !== "void" && cents(i.balance) > 0 && <div className="text-muted-foreground">{kes(i.balance)} due</div>}</div>
              <div className="flex w-full gap-1 sm:w-auto">
                {canPay(i) && <Btn variant="outline" className="h-8 px-2.5 text-xs" data-testid={`button-pay-invoice-${i.id}`} onClick={() => setDlg({ kind: "pay", id: i.id })}><Banknote className="h-3.5 w-3.5" />Payment</Btn>}
                <Btn variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setDlg({ kind: "view", id: i.id })}><FileText className="h-3.5 w-3.5" />Details</Btn>
              </div>
            </li>
          ))}</ul>
        )}
        <Pager {...pager} />
      </>}

      <FormDialog open={dlg?.kind === "create"} onOpenChange={(o) => !o && setDlg(null)} title="Issue subscription invoice" description={`KES invoice for ${school.name}.`} testid="dialog-new-invoice">
        <InvoiceForm key={draft} schoolId={school.id} onDone={() => setDlg(null)} />
      </FormDialog>
      <FormDialog open={dlg?.kind === "pay" && !!inv} onOpenChange={(o) => !o && back()} title={`Record payment on ${inv?.number ?? "invoice"}`} testid="dialog-record-payment">
        {dlg?.kind === "pay" && inv && <PaymentForm key={inv.id} schoolId={school.id} invoice={inv} onDone={back} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "void" && !!inv} onOpenChange={(o) => !o && back()} size="sm" title={`Void ${inv?.number ?? "invoice"}`} testid="dialog-void-invoice">
        {dlg?.kind === "void" && inv && <CorrectionForm schoolId={school.id} invoice={inv} onDone={back} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "reverse" && !!pay} onOpenChange={(o) => !o && back()} size="sm" title="Reverse payment" testid="dialog-reverse-payment">
        {dlg?.kind === "reverse" && inv && pay && <CorrectionForm schoolId={school.id} invoice={inv} payment={pay} onDone={back} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "view" && !!inv} onOpenChange={(o) => !o && setDlg(null)} size="lg" title={inv ? `Invoice ${inv.number}` : "Invoice"} description={inv?.description} testid="dialog-invoice-detail">
        {dlg?.kind === "view" && inv && <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Status</dt><dd className="mt-1"><Pill tone={TONE[inv.status] ?? "inactive"}>{inv.status}</Pill></dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Amount</dt><dd className="font-mono">{kes(inv.amount)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Paid</dt><dd className="font-mono">{kes(inv.paid)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Balance</dt><dd className="font-mono font-semibold">{inv.status === "void" ? "\u2014" : kes(inv.balance)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Issued</dt><dd>{fmtDate(inv.issuedOn)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Due</dt><dd>{fmtDate(inv.dueOn)}</dd></div>
            <div className="col-span-2"><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Service period</dt><dd>{inv.periodStart ? `${fmtDate(inv.periodStart)} to ${fmtDate(inv.periodEnd)}` : "Not specified"}</dd></div>
          </dl>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Payment history</h3>
            {!inv.payments.length ? <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No payments recorded.</p> : (
              <ul className="divide-y divide-border/60 rounded-md border border-border">{inv.payments.map((p) => (
                <li key={p.id} data-testid={`row-payment-${p.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className={`flex flex-wrap items-center gap-2 font-mono font-semibold ${p.reversedAt ? "text-muted-foreground line-through" : ""}`}>{kes(p.amount)}{p.reversedAt && <Pill tone="error">reversed</Pill>}</div>
                    <div className="truncate text-xs text-muted-foreground">{METHOD[p.method] ?? p.method} · <span className="font-mono">{p.reference}</span> · paid {fmtDate(p.paidOn)}{p.reversedAt && ` · reversed ${fmtDateTime(p.reversedAt)}`}</div>
                  </div>
                  {!p.reversedAt && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-reverse-payment-${p.id}`} onClick={() => setDlg({ kind: "reverse", id: inv.id, paymentId: p.id })}><Undo2 className="h-3.5 w-3.5" />Reverse</Btn>}
                </li>
              ))}</ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Created {fmtDateTime(inv.createdAt)}. Corrections are made by voiding and reissuing, or reversing a payment; history is never deleted.</p>
          <FormActions>
            {canPay(inv) && <Btn data-testid="button-detail-record-payment" onClick={() => setDlg({ kind: "pay", id: inv.id })}><Banknote className="h-4 w-4" />Record payment</Btn>}
            {canVoid(inv) && <Btn variant="danger" data-testid="button-void-invoice" onClick={() => setDlg({ kind: "void", id: inv.id })}><Ban className="h-4 w-4" />Void invoice</Btn>}
            <Btn variant="ghost" onClick={() => setDlg(null)}>Close</Btn>
          </FormActions>
          {inv.status !== "void" && !canVoid(inv) && <p className="text-xs text-muted-foreground">Reverse all active payments before voiding this invoice.</p>}
        </div>}
      </FormDialog>
    </Panel>
  );
}
