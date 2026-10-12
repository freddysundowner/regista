import { useMemo, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { Pager, usePaged } from "@/components/pager";
import {
  useCreateFinanceRecord, useListPaymentExceptions, getListPaymentExceptionsQueryKey, useListIncomingPayments, getListIncomingPaymentsQueryKey,
  useListCollectionRefunds, getListCollectionRefundsQueryKey, type FinanceRecord, type FinanceInputChequeStatus,
} from "@workspace/api-client-react";
import { AlertTriangle, Banknote, FileSpreadsheet, Landmark, Loader2, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill, Fab, Filters } from "@/components/kit";
import { useFinanceRecords, useStudentNames, StatusPill, Money, MoneyInput, StudentPicker, DocumentButton, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime, localDateKey, localInputToUtc } from "@/lib/session";

const dayOf = localDateKey;
import { useFinanceInvalidate, useIdemKey, validMoney, rd } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { StkPanel } from "@/components/stk";
import { FormDialog } from "@/components/form-dialog";
import { CollectionRefundsPanel } from "@/components/collections-extra";
import { Ingest, Queue, Statement } from "@/pages/reconciliation";


const empty = { studentId: "", amount: "", channel: "cash" as "cash" | "cheque", providerTxnId: "", transactionTime: "", payerName: "", payerPhone: "", chequeNo: "", bank: "", drawer: "" };

/** With `studentId` the learner is fixed, for use on the learner page. */
export function RecordPayment({ onDone, studentId }: { onDone: () => void; studentId?: string }) {
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const init = { ...empty, studentId: studentId ?? "" };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId) return setErr("Choose the student.");
    if (!validMoney(f.amount)) return setErr("Enter the exact amount received, e.g. 15000 or 15000.50.");
    if (!f.providerTxnId.trim()) return setErr("Enter the receipt book or reference number.");
    if (f.channel === "cheque" && (!f.chequeNo.trim() || !f.bank.trim() || !f.drawer.trim())) return setErr("Cheques need cheque number, bank and drawer.");
    let transactionTime: string | undefined;
    try { transactionTime = f.transactionTime ? localInputToUtc(f.transactionTime) : undefined; }
    catch (error) { return setErr(errMsg(error)); }
    create.mutate({ data: {
      kind: "payment", idempotencyKey: idem.key, studentId: f.studentId, amount: f.amount.trim(), channel: f.channel, providerTxnId: f.providerTxnId.trim(),
      ...(transactionTime ? { transactionTime } : {}),
      ...(f.payerName.trim() ? { payerName: f.payerName.trim() } : {}), ...(f.payerPhone.trim() ? { payerPhone: f.payerPhone.trim() } : {}),
      ...(f.channel === "cheque" ? { chequeNo: f.chequeNo.trim(), bank: f.bank.trim(), drawer: f.drawer.trim() } : {}),
    } }, {
      onSuccess: (r) => { idem.renew(); inv(); toast({ title: "Payment posted", description: `Receipt ${rd(r, "receiptNo") ?? ""}. Download it from the list.` }); setF(init); onDone(); },
      onError: (x) => setErr(`${errMsg(x)} Retrying with the same details is safe; it will not post twice.`),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {!studentId && <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />}
        <Field label="Amount (KES)" required><MoneyInput testid="input-payment-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Channel" required><NativeSelect data-testid="select-channel" value={f.channel} onChange={set("channel")}><option value="cash">Cash</option><option value="cheque">Cheque</option></NativeSelect></Field>
        <Field label="Receipt book / reference no." required><TextInput data-testid="input-provider-ref" value={f.providerTxnId} onChange={set("providerTxnId")} className="font-mono" /></Field>
        <Field label="Received at" hint="Your local time; blank = now"><TextInput type="datetime-local" value={f.transactionTime} onChange={set("transactionTime")} /></Field>
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

const CHANNEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", mpesa_c2b: "M-Pesa", mpesa_stk: "M-Pesa", bank: "Bank" };
const matchesChannel = (channel: string | undefined, filter: string) => !filter || (filter === "mpesa" ? !!channel?.startsWith("mpesa") : channel === filter);

/** Every payment the school received, in one list. Filters pick what to see; payments still needing a learner have their own view. */
export default function Payments() {
  const p = usePerms();
  const [loc, navigate] = useLocation();
  // Read the query once: a hook inside a conditional changes the hook count between views and crashes React.
  const view = new URLSearchParams(useSearch()).get("show");
  const show = view === "unmatched" || view === "reversed" ? view : "";
  const setShow = (v: string) => navigate(v ? `${loc}?show=${v}` : loc, { replace: true });
  const q = useFinanceRecords({ kind: "payment" });
  const cs = useFinanceRecords({ kind: "cheque_status" });
  const exceptions = useListPaymentExceptions({ query: { queryKey: getListPaymentExceptionsQueryKey() } });
  const incoming = useListIncomingPayments(undefined, { query: { queryKey: getListIncomingPaymentsQueryKey(), enabled: show === "unmatched", refetchInterval: 30000 } });
  const pays = useMemo(() => new Map((incoming.data ?? []).map((x) => [x.id, x])), [incoming.data]);
  const refunds = useListCollectionRefunds({ query: { queryKey: getListCollectionRefundsQueryKey(), enabled: show === "unmatched" } });
  const sname = useStudentNames();
  const [adding, setAdding] = useState<"choose" | "cash" | "credit" | "statement" | null>(null);
  const [cheque, setCheque] = useState<FinanceRecord | null>(null);
  const [fl, setFl] = useState({ text: "", channel: "", cheque: "", from: "", to: "" });
  const unmatched = (exceptions.data ?? []).filter((x) => x.status === "open").length;
  const pendingBounce = new Set((cs.data ?? []).filter((c) => c.status === "pending").map((c) => c.parentId));
  const filtered = (q.data ?? [])
    .filter((r) => show === "reversed" ? r.status === "reversed" : true)
    .filter((r) => { const day = dayOf(rd(r, "transactionTime") ?? r.createdAt); return (!fl.from || day >= fl.from) && (!fl.to || day <= fl.to); })
    .filter((r) => matchesChannel(rd(r, "channel"), fl.channel) && (!fl.cheque || (rd(r, "chequeStatus") ?? "received") === fl.cheque)
      && (!fl.text || `${sname(r.studentId)} ${rd(r, "receiptNo") ?? ""} ${rd(r, "providerTxnId") ?? ""} ${rd(r, "payerName") ?? ""}`.toLowerCase().includes(fl.text.toLowerCase())));
  const { rows: list, pager } = usePaged(filtered, [fl, show]);
  const pick = (v: typeof adding) => setAdding(v);
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" meta="Everything received by M-Pesa, bank, cash and cheque.">
        {p.collect && <StkPanel />}
        {p.bursar && <Btn data-testid="button-new-payment" className="max-md:hidden" onClick={() => pick("choose")}><Plus className="h-4 w-4" />Add payment</Btn>}
      </PageHeader>
      {p.bursar && <>
        <FormDialog open={adding === "choose"} onOpenChange={(o) => pick(o ? "choose" : null)} title="Add a payment" description="What did you receive?">
          <div className="grid gap-2 p-5">
            {([
              ["cash", Banknote, "Cash or cheque", "Paid at the school office."],
              ["credit", Landmark, "A bank or M-Pesa payment", "Seen on a statement but not recorded yet. It's matched to the learner automatically."],
              ["statement", FileSpreadsheet, "A whole bank statement", "Upload CSV, Excel or MT940; new payments are matched automatically."],
            ] as const).map(([k, Icon, title, body]) => (
              <button key={k} type="button" onClick={() => pick(k)} data-testid={`add-payment-${k}`} className="flex items-start gap-3 rounded-xl border border-border p-4 text-left transition hover:border-primary/40 hover:bg-primary/5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" /></span>
                <span><span className="block font-semibold">{title}</span><span className="block text-sm text-muted-foreground">{body}</span></span>
              </button>
            ))}
          </div>
        </FormDialog>
        <FormDialog open={adding === "cash"} onOpenChange={(o) => pick(o ? "cash" : null)} size="lg" title="Record a cash or cheque payment"><RecordPayment onDone={() => pick(null)} /></FormDialog>
        <FormDialog open={adding === "credit"} onOpenChange={(o) => pick(o ? "credit" : null)} size="lg" title="Add a bank or M-Pesa payment" description="The same reference is never counted twice."><Ingest onDone={() => pick(null)} /></FormDialog>
        <FormDialog open={adding === "statement"} onOpenChange={(o) => pick(o ? "statement" : null)} size="full" title="Import a bank statement"><Statement onDone={() => pick(null)} /></FormDialog>
        <FormDialog open={!!cheque} onOpenChange={(o) => { if (!o) setCheque(null); }} title="Update cheque status" description={cheque ? `${sname(cheque.studentId)} · receipt ${rd(cheque, "receiptNo") ?? ""}` : undefined}>{cheque && <ChequeAction key={cheque.id} r={cheque} onDone={() => setCheque(null)} />}</FormDialog>
      </>}

      {unmatched > 0 && show !== "unmatched" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-sm" data-testid="unmatched-prompt">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <span className="min-w-0 flex-1"><b>{unmatched} payment{unmatched === 1 ? "" : "s"} couldn't be matched to a learner.</b> Usually a wrong admission number.</span>
          <Btn className="h-8 px-3 text-xs" onClick={() => setShow("unmatched")} data-testid="button-show-unmatched">Assign {unmatched === 1 ? "it" : "them"}</Btn>
        </div>
      )}

      <Filters className="md:grid md:w-full md:grid-cols-3 lg:grid-cols-5" active={[show, fl.channel, fl.from, fl.to, fl.cheque].filter(Boolean).length} onClear={() => { setShow(""); setFl({ ...fl, channel: "", from: "", to: "", cheque: "" }); }}
        lead={<TextInput aria-label="Search payments" data-testid="input-search-payments" placeholder="Learner, receipt, payer or reference" value={fl.text} onChange={(e) => setFl({ ...fl, text: e.target.value })} />}>
        <NativeSelect aria-label="Show" data-testid="select-show" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="">All payments</option><option value="unmatched">Needs a learner{unmatched ? ` (${unmatched})` : ""}</option><option value="reversed">Reversed</option>
        </NativeSelect>
        <NativeSelect aria-label="Paid by" value={fl.channel} onChange={(e) => setFl({ ...fl, channel: e.target.value, cheque: e.target.value === "cheque" ? fl.cheque : "" })}>
          <option value="">Any way of paying</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="cheque">Cheque</option>
        </NativeSelect>
        <TextInput aria-label="Received from" type="date" value={fl.from} onChange={(e) => setFl({ ...fl, from: e.target.value })} />
        <TextInput aria-label="Received to" type="date" value={fl.to} min={fl.from || undefined} onChange={(e) => setFl({ ...fl, to: e.target.value })} />
        {fl.channel === "cheque" && <NativeSelect aria-label="Cheque stage" value={fl.cheque} onChange={(e) => setFl({ ...fl, cheque: e.target.value })}><option value="">Any cheque stage</option><option value="received">Received</option><option value="banked">Banked</option><option value="cleared">Cleared</option><option value="bounced">Bounced</option></NativeSelect>}
      </Filters>

      {show === "unmatched" ? <>
        <Queue pays={pays} />
        {(refunds.data?.length ?? 0) > 0 && <CollectionRefundsPanel />}
      </> : (
        <Panel>
          {q.isLoading ? <SkeletonRows cols={6} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<Banknote className="h-5 w-5" />} title={q.data?.length ? "No payments match" : "No payments yet"} body="Payments appear here with a receipt you can download." /> : (
            <Table head={["Receipt", "Learner", "Paid by", "Amount", "Received", "Status", ""]}>{list.map((r) => (
              <tr key={r.id} data-testid={`row-payment-${r.id}`}>
                <td className={`${td} font-mono text-xs`}>{rd(r, "receiptNo") ?? "\u2014"}<div className="text-muted-foreground">{rd(r, "providerTxnId")}</div></td>
                <td className={td}>{sname(r.studentId)}{rd(r, "payerName") && <div className="text-xs text-muted-foreground">Paid by {rd(r, "payerName")}</div>}</td>
                <td className={`${td} text-xs`}>{CHANNEL[rd(r, "channel") ?? ""] ?? rd(r, "channel")}{rd(r, "channel") === "cheque" && <div className="text-muted-foreground">#{rd(r, "chequeNo")} · {rd(r, "bank")} · {rd(r, "drawer")}<div className="mt-1"><Pill tone={rd(r, "chequeStatus") === "bounced" ? "error" : rd(r, "chequeStatus") === "cleared" ? "active" : "current"}>{rd(r, "chequeStatus") ?? "received"}</Pill>{pendingBounce.has(r.id) && <span className="ml-1"><Pill tone="duplicate">Bounce pending</Pill></span>}</div></div>}</td>
                <td className={td}><Money v={r.amount} /></td>
                <td className={`${td} text-xs`}>{fmtDateTime(rd(r, "transactionTime") ?? r.createdAt)}</td>
                <td className={td}><StatusPill status={r.status} /></td>
                <td className={td}><div className="flex flex-col items-start gap-1">{r.status === "posted" && <DocumentButton type="receipt" referenceId={r.id} fileName={rd(r, "receiptNo") ?? "receipt"} />}{p.bursar && rd(r, "channel") === "cheque" && r.status === "posted" && !pendingBounce.has(r.id) && rd(r, "chequeStatus") !== "bounced" && <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-cheque-${r.id}`} onClick={() => setCheque(r)}>Update cheque</Btn>}</div></td>
              </tr>))}</Table>
          )}
          <Pager {...pager} />
        </Panel>
      )}
      {p.bursar && <Fab testid="fab-new-payment" label="Add payment" icon={<Plus className="h-4 w-4" />} onClick={() => pick("choose")} />}
    </div>
  );
}
