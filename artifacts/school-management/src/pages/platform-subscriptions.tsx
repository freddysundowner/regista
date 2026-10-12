import { useEffect, useState } from "react";
import { Pager } from "@/components/pager";
import { Link } from "wouter";
import { useGetPlatformSubscriptions, getGetPlatformSubscriptionsQueryKey, type SubscriptionInvoiceRow, type SubscriptionPaymentRow } from "@workspace/api-client-react";
import { Ban, Banknote, ChevronLeft, ChevronRight, FileText, ReceiptText, Search, Undo2, Wallet } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, TextInput, CardTable, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { PaymentForm, CorrectionForm, kes, cents, METHOD, TONE, canPay, canVoid } from "@/components/platform-billing";
import { errMsg, fmtDate, fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";
import "./platform-subscriptions.css";

type Tab = "payments" | "invoices";
type Dlg = { kind: "view" | "pay" | "void"; inv: SubscriptionInvoiceRow } | { kind: "reverse"; pay: SubscriptionPaymentRow } | { kind: "reverse-inv"; inv: SubscriptionInvoiceRow; paymentId: string } | null;


export default function PlatformSubscriptions() {
  const [tab, setTab] = useState<Tab>("payments");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [dlg, setDlg] = useState<Dlg>(null);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(term.trim()); setInvoicePage(1); setPaymentPage(1); }, 300);
    return () => clearTimeout(t);
  }, [term]);
  const params = { ...(search ? { search } : {}), invoicePage, paymentPage };
  const q = useGetPlatformSubscriptions(params, { query: { queryKey: getGetPlatformSubscriptionsQueryKey(params), refetchInterval: 30_000, refetchOnWindowFocus: true, placeholderData: (prev) => prev } });
  const d = q.data;
  // Resolve open invoice dialogs from fresh data so balances update after each action.
  const liveInv = dlg && "inv" in dlg ? d?.invoices.find((i) => i.id === dlg.inv.id) ?? dlg.inv : undefined;
  const close = () => setDlg(null);
  const back = () => setDlg(liveInv && dlg?.kind !== "view" ? { kind: "view", inv: liveInv } : null);
  const revInvPay = dlg?.kind === "reverse-inv" && liveInv ? liveInv.payments.find((p) => p.id === dlg.paymentId) : undefined;

  const tabs: { id: Tab; label: string; count?: number; icon: typeof Wallet }[] = [
    { id: "payments", label: "Payments received", count: d?.paymentTotal, icon: Wallet },
    { id: "invoices", label: "Invoices", count: d?.invoiceTotal, icon: ReceiptText },
  ];

  return (
    <div className="subscriptions-page space-y-6">
      <PageHeader title="Subscriptions" meta="Subscription invoices and payments across all schools. Record money already received in KES; nothing is charged here." />
      <Panel>
        <div className="subscriptions-toolbar flex flex-wrap gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <div role="tablist" aria-label="Subscription records" className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
                className={cn("inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded px-3 text-sm font-semibold transition", tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <t.icon className="h-4 w-4" />{t.label}{t.count !== undefined && <span className="rounded-full bg-muted px-1.5 font-mono text-[11px]">{t.count}</span>}
              </button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1 basis-72">
            <span className="sr-only">Search subscriptions</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <TextInput data-testid="input-search-subscriptions" maxLength={150} className="pl-9" placeholder="School, code, invoice or reference" value={term} onChange={(e) => setTerm(e.target.value)} />
          </label>
        </div>

        {q.isLoading ? <SkeletonRows rows={6} cols={5} /> : q.isError || !d ? <ErrorState msg={errMsg(q.error, "Could not load subscriptions.")} onRetry={() => q.refetch()} /> : tab === "payments" ? (
          !d.payments.length ? <Empty icon={<Wallet className="h-5 w-5" />} title={search ? "No matching payments" : "No payments received yet"} body={search ? "Try a different school, code or reference." : "Record a payment against an outstanding invoice and it appears here."} /> : <>
            <CardTable testid="table-subscription-payments">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70">
                  <th className="px-5 py-2.5">Paid on</th><th className="px-3 py-2.5">School</th><th className="px-3 py-2.5">Invoice</th><th className="px-3 py-2.5">Method</th><th className="px-3 py-2.5">Reference</th><th className="px-3 py-2.5 text-right">Amount</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">{d.payments.map((p) => (
                  <tr key={p.id} data-testid={`row-subscription-payment-${p.id}`} className={cn(p.reversedAt && "text-muted-foreground")}>
                    <td className="whitespace-nowrap px-5 py-3">{fmtDate(p.paidOn)}</td>
                    <td className="px-3 py-3"><Link href={`/schools/${p.schoolId}`} className="font-semibold hover:underline">{p.schoolName}</Link><div className="font-mono text-[11px] text-muted-foreground">{p.schoolCode}</div></td>
                    <td className="max-w-[16rem] px-3 py-3"><div className="font-mono text-xs">{p.invoiceNumber}</div><div className="truncate text-xs text-muted-foreground">{p.description}</div></td>
                    <td className="px-3 py-3">{METHOD[p.method] ?? p.method}</td>
                    <td className="px-3 py-3 font-mono text-xs">{p.reference}</td>
                    <td className="px-3 py-3 text-right"><div className={cn("font-mono font-semibold", p.reversedAt && "line-through")}>{kes(p.amount)}</div>{p.reversedAt && <div className="mt-0.5 flex justify-end"><Pill tone="error">reversed {fmtDate(p.reversedAt)}</Pill></div>}</td>
                    <td className="px-3 py-3 text-right">{!p.reversedAt && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-reverse-subscription-payment-${p.id}`} onClick={() => setDlg({ kind: "reverse", pay: p })}><Undo2 className="h-3.5 w-3.5" />Reverse</Btn>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </CardTable>
            <Pager page={paymentPage} total={d.paymentTotal} size={d.pageSize} onPage={setPaymentPage} />
          </>
        ) : (
          !d.invoices.length ? <Empty icon={<ReceiptText className="h-5 w-5" />} title={search ? "No matching invoices" : "No invoices yet"} body={search ? "Try a different school, code or invoice number." : "Invoices appear here when schools request renewals or you issue an invoice from a school's page."} /> : <>
            <CardTable testid="table-subscription-invoices">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70">
                  <th className="px-5 py-2.5">Invoice</th><th className="px-3 py-2.5">School</th><th className="px-3 py-2.5">Due</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Amount</th><th className="px-3 py-2.5 text-right">Balance</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">{d.invoices.map((i) => (
                  <tr key={i.id} data-testid={`row-subscription-invoice-${i.id}`}>
                    <td className="max-w-[18rem] px-5 py-3"><div className="font-mono text-xs font-semibold">{i.number}</div><div className="truncate text-xs text-muted-foreground">{i.description}</div></td>
                    <td className="px-3 py-3"><Link href={`/schools/${i.schoolId}`} className="font-semibold hover:underline">{i.schoolName}</Link><div className="font-mono text-[11px] text-muted-foreground">{i.schoolCode}</div></td>
                    <td className="whitespace-nowrap px-3 py-3">{fmtDate(i.dueOn)}</td>
                    <td className="px-3 py-3"><Pill tone={TONE[i.status] ?? "inactive"}>{i.status}</Pill></td>
                    <td className="px-3 py-3 text-right font-mono">{kes(i.amount)}</td>
                    <td className={cn("px-3 py-3 text-right font-mono font-semibold", i.status === "overdue" && "text-destructive")}>{kes(i.balance)}</td>
                    <td className="px-3 py-3"><div className="flex justify-end gap-1">
                      {canPay(i) && <Btn variant="outline" className="h-8 px-2.5 text-xs" data-testid={`button-pay-subscription-invoice-${i.id}`} onClick={() => setDlg({ kind: "pay", inv: i })}><Banknote className="h-3.5 w-3.5" />Payment</Btn>}
                      <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid={`button-view-subscription-invoice-${i.id}`} onClick={() => setDlg({ kind: "view", inv: i })}><FileText className="h-3.5 w-3.5" />Details</Btn>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </CardTable>
            <Pager page={invoicePage} total={d.invoiceTotal} size={d.pageSize} onPage={setInvoicePage} />
          </>
        )}
      </Panel>

      <FormDialog open={dlg?.kind === "pay" && !!liveInv} onOpenChange={(o) => !o && back()} title={`Record payment on ${liveInv?.number ?? "invoice"}`} description={liveInv?.schoolName} testid="dialog-record-payment">
        {dlg?.kind === "pay" && liveInv && <PaymentForm key={liveInv.id} schoolId={liveInv.schoolId} invoice={liveInv} onDone={back} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "void" && !!liveInv} onOpenChange={(o) => !o && back()} size="sm" title={`Void ${liveInv?.number ?? "invoice"}`} testid="dialog-void-invoice">
        {dlg?.kind === "void" && liveInv && <CorrectionForm schoolId={liveInv.schoolId} invoice={liveInv} onDone={close} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "reverse-inv" && !!revInvPay} onOpenChange={(o) => !o && back()} size="sm" title="Reverse payment" testid="dialog-reverse-payment">
        {dlg?.kind === "reverse-inv" && liveInv && revInvPay && <CorrectionForm schoolId={liveInv.schoolId} invoice={liveInv} payment={revInvPay} onDone={back} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "reverse"} onOpenChange={(o) => !o && close()} size="sm" title="Reverse payment" description={dlg?.kind === "reverse" ? `${dlg.pay.schoolName} · ${dlg.pay.invoiceNumber}` : undefined} testid="dialog-reverse-central-payment">
        {dlg?.kind === "reverse" && <CorrectionForm schoolId={dlg.pay.schoolId} invoice={{ id: dlg.pay.invoiceId, number: dlg.pay.invoiceNumber }} payment={dlg.pay} onDone={close} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "view" && !!liveInv} onOpenChange={(o) => !o && close()} size="lg" title={liveInv ? `Invoice ${liveInv.number}` : "Invoice"} description={liveInv ? `${liveInv.schoolName} · ${liveInv.description}` : undefined} testid="dialog-invoice-detail">
        {dlg?.kind === "view" && liveInv && <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Status</dt><dd className="mt-1"><Pill tone={TONE[liveInv.status] ?? "inactive"}>{liveInv.status}</Pill></dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Amount</dt><dd className="font-mono">{kes(liveInv.amount)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Paid</dt><dd className="font-mono">{kes(liveInv.paid)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Balance</dt><dd className="font-mono font-semibold">{liveInv.status === "void" ? "\u2014" : kes(liveInv.balance)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Issued</dt><dd>{fmtDate(liveInv.issuedOn)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Due</dt><dd>{fmtDate(liveInv.dueOn)}</dd></div>
            <div className="col-span-2"><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Service period</dt><dd>{liveInv.periodStart ? `${fmtDate(liveInv.periodStart)} to ${fmtDate(liveInv.periodEnd)}` : "Not specified"}</dd></div>
          </dl>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Payment history</h3>
            {!liveInv.payments.length ? <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No payments recorded.</p> : (
              <ul className="divide-y divide-border/60 rounded-md border border-border">{liveInv.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className={cn("flex flex-wrap items-center gap-2 font-mono font-semibold", p.reversedAt && "text-muted-foreground line-through")}>{kes(p.amount)}{p.reversedAt && <Pill tone="error">reversed</Pill>}</div>
                    <div className="truncate text-xs text-muted-foreground">{METHOD[p.method] ?? p.method} · <span className="font-mono">{p.reference}</span> · paid {fmtDate(p.paidOn)}{p.reversedAt && ` · reversed ${fmtDateTime(p.reversedAt)}`}</div>
                  </div>
                  {!p.reversedAt && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-reverse-payment-${p.id}`} onClick={() => setDlg({ kind: "reverse-inv", inv: liveInv, paymentId: p.id })}><Undo2 className="h-3.5 w-3.5" />Reverse</Btn>}
                </li>
              ))}</ul>
            )}
          </div>
          <FormActions>
            {canPay(liveInv) && <Btn data-testid="button-detail-record-payment" onClick={() => setDlg({ kind: "pay", inv: liveInv })}><Banknote className="h-4 w-4" />Record payment</Btn>}
            {canVoid(liveInv) && <Btn variant="danger" data-testid="button-void-invoice" onClick={() => setDlg({ kind: "void", inv: liveInv })}><Ban className="h-4 w-4" />Void invoice</Btn>}
            <Link href={`/schools/${liveInv.schoolId}`} className="inline-flex h-11 items-center rounded-md px-3.5 text-sm font-semibold hover:bg-muted sm:h-9">Open school</Link>
            <Btn variant="ghost" onClick={close}>Close</Btn>
          </FormActions>
          {liveInv.status !== "void" && !canVoid(liveInv) && cents(liveInv.paid) > 0 && <p className="text-xs text-muted-foreground">Reverse all active payments before voiding this invoice.</p>}
        </div>}
      </FormDialog>
    </div>
  );
}
