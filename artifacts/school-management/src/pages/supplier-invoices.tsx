import { useMemo, useState, type FormEvent } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSupplierInvoices, getListSupplierInvoicesQueryKey, useCreateSupplierInvoice, useVoidSupplierInvoice, usePaySupplierInvoice,
  useListPurchaseOrders, getListPurchaseOrdersQueryKey, getListSuppliersQueryKey, getListExpensesQueryKey, getGetFinanceSummaryQueryKey,
  ExpenseInputMethod, type SupplierInvoice,
} from "@workspace/api-client-react";
import { FileText, Loader2, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { MoneyInput } from "@/components/finance-kit";
import { AttachmentInput, AttachmentLink, CategorySelect, InvoiceState, METHOD_LABEL, SupplierSelect, categoryName, ks } from "@/components/procurement-kit";
import { usePerms, errMsg, fmtDate, localToday } from "@/lib/session";
import { validMoney } from "@/lib/finance";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of [getListSupplierInvoicesQueryKey(), getListSuppliersQueryKey(), getListPurchaseOrdersQueryKey(), getListExpensesQueryKey(), getGetFinanceSummaryQueryKey()]) void qc.invalidateQueries({ queryKey: key });
  };
}

function NewInvoice({ orderId, supplierId = "", onDone }: { orderId?: string; supplierId?: string; onDone: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const m = useCreateSupplierInvoice();
  const orders = useListPurchaseOrders(undefined, { query: { queryKey: getListPurchaseOrdersQueryKey() } });
  const preset = orders.data?.find((o) => o.id === orderId);
  const [f, setF] = useState({ supplierId, orderId: orderId ?? "", invoiceNo: "", date: localToday(), dueDate: "", description: "", category: "", amount: "", attachmentUrl: "" });
  const [err, setErr] = useState<string | null>(null);
  // Fill from the LPO once it has loaded.
  const [filled, setFilled] = useState(false);
  if (preset && !filled) { setFilled(true); setF({ ...f, supplierId: preset.supplierId, orderId: preset.id, description: `Goods on ${preset.reference}`, amount: String(Math.max(0, Number(preset.total) - Number(preset.invoiced))) }); }
  const supplierOrders = (orders.data ?? []).filter((o) => o.supplierId === f.supplierId && ["approved", "partly_received", "received"].includes(o.status));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.supplierId) return setErr("Choose the supplier.");
    if (!f.invoiceNo.trim()) return setErr("Enter the invoice number printed on it.");
    if (f.description.trim().length < 2) return setErr("Say what the invoice is for.");
    if (!f.category) return setErr("Choose what it was spent on.");
    if (!validMoney(f.amount)) return setErr("Enter the invoice amount.");
    if (f.dueDate && f.dueDate < f.date) return setErr("The due date is before the invoice date.");
    m.mutate({ data: { supplierId: f.supplierId, invoiceNo: f.invoiceNo.trim(), date: f.date, description: f.description.trim(), category: f.category, amount: f.amount.trim(), ...(f.orderId ? { orderId: f.orderId } : {}), ...(f.dueDate ? { dueDate: f.dueDate } : {}), ...(f.attachmentUrl ? { attachmentUrl: f.attachmentUrl } : {}) } }, {
      onSuccess: () => { refresh(); toast({ title: "Invoice recorded", description: "Pay it here when the money goes out, and it is added to expenses." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" required><SupplierSelect value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v, orderId: "" })} testid="select-invoice-supplier" /></Field>
        <Field label="For LPO" hint="Optional; links the invoice to what was ordered">
          <NativeSelect value={f.orderId} onChange={set("orderId")} disabled={!f.supplierId}><option value="">No LPO</option>{supplierOrders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {ks(o.total)}</option>)}</NativeSelect>
        </Field>
        <Field label="Invoice number" required><TextInput data-testid="input-invoice-no" value={f.invoiceNo} onChange={set("invoiceNo")} maxLength={60} className="font-mono" /></Field>
        <Field label="Amount (KES)" required><MoneyInput testid="input-invoice-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="What for" required className="sm:col-span-2"><TextInput data-testid="input-invoice-description" value={f.description} onChange={set("description")} maxLength={200} placeholder="e.g. Foodstuffs for October" /></Field>
        <Field label="Spent on" required><CategorySelect value={f.category} onChange={(v) => setF({ ...f, category: v })} testid="select-invoice-category" /></Field>
        <Field label="Invoice copy"><AttachmentInput value={f.attachmentUrl} onChange={(v) => setF({ ...f, attachmentUrl: v })} label="Attach invoice" testid="invoice-file" /></Field>
        <Field label="Invoice date" required><TextInput type="date" value={f.date} max={localToday()} onChange={set("date")} /></Field>
        <Field label="Due date"><TextInput type="date" value={f.dueDate} min={f.date} onChange={set("dueDate")} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-invoice" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record invoice</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function Pay({ inv, onDone }: { inv: SupplierInvoice; onDone: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const m = usePaySupplierInvoice();
  const [f, setF] = useState({ date: localToday(), amount: String(Number(inv.balance)), method: "bank", reference: "", attachmentUrl: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!validMoney(f.amount)) return setErr("Enter the amount paid.");
    if (Number(f.amount) > Number(inv.balance)) return setErr(`Only ${ks(inv.balance)} is left to pay.`);
    m.mutate({ id: inv.id, data: { date: f.date, amount: f.amount.trim(), method: f.method as ExpenseInputMethod, ...(f.reference.trim() ? { reference: f.reference.trim() } : {}), ...(f.attachmentUrl ? { attachmentUrl: f.attachmentUrl } : {}) } }, {
      onSuccess: (r) => { refresh(); toast({ title: r.state === "paid" ? "Invoice paid in full" : "Part payment recorded", description: "It's in Expenses too." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">{ks(inv.balance)} of {ks(inv.amount)} is unpaid. The payment is recorded as an expense under {categoryName(inv.category)}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount paid (KES)" required><MoneyInput testid="input-pay-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Paid on" required><TextInput type="date" value={f.date} max={localToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by" required><NativeSelect value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.values(ExpenseInputMethod).map((x) => <option key={x} value={x}>{METHOD_LABEL[x]}</option>)}</NativeSelect></Field>
        <Field label="Reference"><TextInput value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} className="font-mono" placeholder="Cheque, M-Pesa or bank ref." /></Field>
        <Field label="Payment receipt" className="sm:col-span-2"><AttachmentInput value={f.attachmentUrl} onChange={(v) => setF({ ...f, attachmentUrl: v })} testid="pay-receipt" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-payment" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record payment</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function VoidInvoice({ inv, onDone }: { inv: SupplierInvoice; onDone: () => void }) {
  const refresh = useRefresh();
  const m = useVoidSupplierInvoice();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); if (reason.trim().length < 3) return setErr("Say why it's being voided.");
      m.mutate({ id: inv.id, data: { reason: reason.trim() } }, { onSuccess: () => { refresh(); onDone(); }, onError: (x) => setErr(errMsg(x)) }); }}>
      <p className="text-sm text-muted-foreground">Use this for a duplicate or a wrongly recorded invoice. It stays on the list, marked voided.</p>
      <Field label="Reason" required><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Entered twice" /></Field>
      <FormError msg={err} />
      <FormActions><Btn type="submit" variant="danger" disabled={m.isPending}>Void invoice</Btn><Btn type="button" variant="ghost" onClick={onDone}>Keep it</Btn></FormActions>
    </form>
  );
}

const FILTERS = [
  { id: "unpaid", label: "To pay", test: (i: SupplierInvoice) => ["unpaid", "part_paid", "overdue"].includes(i.state) },
  { id: "overdue", label: "Overdue", test: (i: SupplierInvoice) => i.state === "overdue" },
  { id: "paid", label: "Paid", test: (i: SupplierInvoice) => i.state === "paid" },
  { id: "all", label: "All", test: () => true },
];

export default function SupplierInvoices() {
  usePageTitle("Supplier invoices");
  const p = usePerms();
  const search = new URLSearchParams(useSearch());
  const q = useListSupplierInvoices(undefined, { query: { queryKey: getListSupplierInvoicesQueryKey() } });
  const [adding, setAdding] = useState<string | null>(() => search.get("order") ?? (search.get("new") === "1" ? "" : null));
  const [paying, setPaying] = useState<SupplierInvoice | null>(null);
  const [voiding, setVoiding] = useState<SupplierInvoice | null>(null);
  const [filter, setFilter] = useState("unpaid");
  const [text, setText] = useState("");
  const all = q.data ?? [];
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = all.filter((i) => f.test(i) && matches(text, i.invoiceNo, i.supplierName, i.description, i.orderReference));
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((x) => [x.id, all.filter(x.test).length])), [all]);
  const owed = all.filter((i) => i.status === "active").reduce((t, i) => t + Number(i.balance), 0);
  const overdue = all.filter((i) => i.state === "overdue").reduce((t, i) => t + Number(i.balance), 0);
  const { rows: pageRows, pager } = usePaged(rows, [filter, text]);
  const canRecord = p.procurement || p.expenses;
  const cols = [{ key: "date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "invoiceNo", label: "Invoice no." }, { key: "lpo", label: "LPO" }, { key: "description", label: "What for" }, { key: "amount", label: "Amount" }, { key: "paid", label: "Paid" }, { key: "balance", label: "Balance" }, { key: "due", label: "Due" }, { key: "state", label: "Status" }];
  const exportRows = rows.map((i) => ({ date: i.date, supplier: i.supplierName, invoiceNo: i.invoiceNo, lpo: i.orderReference ?? "", description: i.description, amount: i.amount, paid: i.paid, balance: i.balance, due: i.dueDate ?? "", state: i.state.replace("_", " ") }));
  return (
    <div className="space-y-5">
      <PageHeader title="Supplier invoices" meta="Bills from suppliers. Paying one records the expense and shows what is still owed.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Supplier invoices", cols, exportRows, "supplier-invoices")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "supplier-invoices")}>CSV</Btn>
        {canRecord && <Btn className="max-md:hidden" data-testid="button-new-invoice" onClick={() => setAdding("")}><Plus className="h-4 w-4" />Record invoice</Btn>}
      </PageHeader>
      <FormDialog open={adding !== null} onOpenChange={(o) => { if (!o) setAdding(null); }} size="lg" title="Record a supplier invoice">{adding !== null && <NewInvoice orderId={adding || undefined} supplierId={search.get("supplier") ?? ""} onDone={() => setAdding(null)} />}</FormDialog>
      <FormDialog open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null); }} title={paying ? `Pay ${paying.supplierName}, invoice ${paying.invoiceNo}` : ""}>{paying && <Pay key={paying.id} inv={paying} onDone={() => setPaying(null)} />}</FormDialog>
      <FormDialog open={!!voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }} title={voiding ? `Void invoice ${voiding.invoiceNo}?` : ""}>{voiding && <VoidInvoice key={voiding.id} inv={voiding} onDone={() => setVoiding(null)} />}</FormDialog>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5"><div className="text-sm text-muted-foreground">Owed to suppliers</div><div className="mt-1 text-3xl font-semibold tabular-nums" data-testid="suppliers-owed">{ks(owed)}</div></div>
        <div className={cn("rounded-2xl border bg-card p-5", overdue > 0 ? "border-destructive/40" : "border-border")}><div className="text-sm text-muted-foreground">Past the due date</div><div className={cn("mt-1 text-3xl font-semibold tabular-nums", overdue > 0 && "text-destructive")}>{ks(overdue)}</div></div>
      </section>
      <Panel>
        <div className="space-y-3 border-b border-border/70 p-4">
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
            {FILTERS.map((x) => <button key={x.id} type="button" role="radio" aria-checked={filter === x.id} onClick={() => setFilter(x.id)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === x.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>{x.label} <span className="tabular-nums opacity-70">{counts[x.id] ?? 0}</span></button>)}
          </div>
          <ListSearch value={text} onChange={setText} placeholder="Search invoice number, supplier, LPO or what for" />
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<FileText className="h-5 w-5" />} title={all.length ? "Nothing here" : "No supplier invoices yet"} body="Record each supplier's invoice when it arrives, then pay it in full or in parts.">
            {canRecord && <Btn onClick={() => setAdding("")}><Plus className="h-4 w-4" />Record invoice</Btn>}
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((i) => (
              <li key={i.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm", i.status === "voided" && "opacity-60")} data-testid={`row-invoice-${i.id}`}>
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(i.date)}</span>
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{i.supplierName} <span className="font-mono text-xs text-muted-foreground">#{i.invoiceNo}</span></div>
                  <div className="text-xs text-muted-foreground">{i.description} · {categoryName(i.category)}{i.orderReference ? ` · ${i.orderReference}` : ""}{i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ""}</div>
                  {i.payments.filter((x) => x.status === "active").length > 0 && <div className="text-xs text-muted-foreground">Paid {i.payments.filter((x) => x.status === "active").map((x) => `${ks(x.amount)} on ${fmtDate(x.date)}`).join(", ")}</div>}
                  {i.voidReason && <div className="text-xs text-destructive">Voided: {i.voidReason}</div>}
                  {i.attachmentUrl && <AttachmentLink refPath={i.attachmentUrl} label="Invoice copy" />}
                </div>
                <div className="text-right"><div className="font-semibold tabular-nums">{ks(i.amount)}</div>{Number(i.paid) > 0 && i.state !== "paid" && <div className="text-xs tabular-nums text-muted-foreground">{ks(i.balance)} left</div>}</div>
                <InvoiceState state={i.state} />
                <div className="flex items-center gap-1">
                  {p.expenses && i.status === "active" && Number(i.balance) > 0 && <Btn className="h-7 px-2 text-xs" data-testid={`button-pay-${i.id}`} onClick={() => setPaying(i)}>Pay</Btn>}
                  {canRecord && i.status === "active" && Number(i.paid) === 0 && <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVoiding(i)}>Void</Btn>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {canRecord && <Fab testid="fab-new-invoice" label="Record invoice" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding("")} />}
    </div>
  );
}
