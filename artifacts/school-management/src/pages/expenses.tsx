import { useMemo, useState, type FormEvent } from "react";
import { ListSearch, matches } from "@/components/list-search";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Link } from "wouter";
import { useListExpenses, getListExpensesQueryKey, useCreateExpense, useVoidExpense, getGetFinanceSummaryQueryKey, getListSupplierInvoicesQueryKey, getListSuppliersQueryKey, ExpenseInputMethod, type ExpenseInputCategory, type Expense } from "@workspace/api-client-react";
import { Loader2, Plus, Receipt } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, Filters, TextInput, NativeSelect, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { MoneyInput } from "@/components/finance-kit";
import { AttachmentInput, AttachmentLink, CATEGORY_LABEL, CATEGORIES, METHOD_LABEL, SupplierSelect, ks, categoryName } from "@/components/procurement-kit";
import { Pager, usePaged } from "@/components/pager";
import { usePerms, errMsg, fmtDate, localToday } from "@/lib/session";
import { validMoney } from "@/lib/finance";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";

const monthStart = () => `${localToday().slice(0, 8)}01`;

function NewExpense({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreateExpense();
  const [f, setF] = useState({ date: localToday(), category: "" as string, description: "", amount: "", method: "cash" as string, payee: "", reference: "", supplierId: "", attachmentUrl: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.category) return setErr("Choose what the money was spent on.");
    if (f.description.trim().length < 2) return setErr("Say what it was for, e.g. October salaries.");
    if (!validMoney(f.amount)) return setErr("Enter the amount, e.g. 12500.");
    m.mutate({ data: { date: f.date, category: f.category as ExpenseInputCategory, description: f.description.trim(), amount: f.amount.trim(), method: f.method as ExpenseInputMethod, ...(f.payee.trim() && !f.supplierId ? { payee: f.payee.trim() } : {}), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}), ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.attachmentUrl ? { attachmentUrl: f.attachmentUrl } : {}) } }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getListExpensesQueryKey() }); void qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); toast({ title: "Expense recorded" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Spent on" required><NativeSelect data-testid="select-expense-category" value={f.category} onChange={set("category")}><option value="">Choose</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</NativeSelect></Field>
        <Field label="Amount (KES)" required><MoneyInput testid="input-expense-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="What for" required className="sm:col-span-2"><TextInput data-testid="input-expense-description" value={f.description} onChange={set("description")} placeholder="e.g. October salaries, 2 bags of maize" maxLength={200} /></Field>
        <Field label="Date" required><TextInput type="date" value={f.date} max={localToday()} onChange={set("date")} /></Field>
        <Field label="Paid by" required><NativeSelect value={f.method} onChange={set("method")}>{Object.values(ExpenseInputMethod).map((x) => <option key={x} value={x}>{METHOD_LABEL[x]}</option>)}</NativeSelect></Field>
        <Field label="Supplier" hint="Pick one you buy from often"><SupplierSelect value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} allowNone="Not a regular supplier" testid="select-expense-supplier" /></Field>
        {!f.supplierId && <Field label="Paid to"><TextInput value={f.payee} onChange={set("payee")} placeholder="Person or shop" maxLength={120} /></Field>}
        <Field label="Receipt or reference"><TextInput value={f.reference} onChange={set("reference")} placeholder="M-Pesa code, cheque or receipt no." maxLength={80} className="font-mono" /></Field>
        <Field label="Receipt copy" hint="Photo or PDF of the receipt"><AttachmentInput value={f.attachmentUrl} onChange={(v) => setF({ ...f, attachmentUrl: v })} testid="expense-receipt" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-expense" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save expense</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function VoidExpense({ e, onDone }: { e: Expense; onDone: () => void }) {
  const qc = useQueryClient();
  const m = useVoidExpense();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-4 p-5" onSubmit={(x) => { x.preventDefault(); setErr(null); if (reason.trim().length < 3) return setErr("Say why it's being voided.");
      m.mutate({ id: e.id, data: { reason: reason.trim() } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListExpensesQueryKey() }); void qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListSupplierInvoicesQueryKey() }); void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); onDone(); }, onError: (y) => setErr(errMsg(y)) }); }}>
      <p className="text-sm text-muted-foreground">It stays on the list, crossed out, and leaves the totals. Use this for a mistake or a duplicate.{e.supplierInvoiceNo ? ` Invoice ${e.supplierInvoiceNo} shows as unpaid by this amount again.` : ""}</p>
      <Field label="Reason" required><TextInput value={reason} onChange={(x) => setReason(x.target.value)} placeholder="e.g. Entered twice" /></Field>
      <FormError msg={err} />
      <FormActions><Btn type="submit" variant="danger" disabled={m.isPending}>Void expense</Btn><Btn type="button" variant="ghost" onClick={onDone}>Keep it</Btn></FormActions>
    </form>
  );
}

export default function Expenses() {
  usePageTitle("Expenses");
  const p = usePerms();
  // Finance Book links here with a term's dates; otherwise show this month.
  const search = new URLSearchParams(useSearch());
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const [from, setFrom] = useState(() => day.test(search.get("from") ?? "") ? search.get("from")! : monthStart());
  const [to, setTo] = useState(() => day.test(search.get("to") ?? "") ? search.get("to")! : localToday());
  const [category, setCategory] = useState("");
  const params = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(category ? { category } : {}) };
  const q = useListExpenses(params, { query: { queryKey: getListExpensesQueryKey(params) } });
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [text, setText] = useState("");
  const rows = (q.data ?? []).filter((e) => matches(text, e.description, e.payee, e.supplierName, e.supplierInvoiceNo, e.reference, e.recordedByName, CATEGORY_LABEL[e.category]));
  const active = rows.filter((e) => e.status === "active");
  const total = active.reduce((s, e) => s + Number(e.amount), 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount));
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [active]);
  const { rows: pageRows, pager } = usePaged(rows, [params, text]);
  const exportRows = rows.map((e) => ({ date: e.date, category: CATEGORY_LABEL[e.category] ?? e.category, description: e.description, amount: e.amount, method: METHOD_LABEL[e.method] ?? e.method, payee: e.payee ?? "", reference: e.reference ?? "", status: e.status === "voided" ? `Voided: ${e.voidReason ?? ""}` : "", recordedBy: e.recordedByName ?? "", invoice: e.supplierInvoiceNo ?? "", receipt: e.attachmentUrl ? "Yes" : "" }));
  const cols = [{ key: "date", label: "Date" }, { key: "category", label: "Spent on" }, { key: "description", label: "What for" }, { key: "amount", label: "Amount" }, { key: "method", label: "Paid by" }, { key: "payee", label: "Paid to" }, { key: "reference", label: "Reference" }, { key: "status", label: "Status" }, { key: "recordedBy", label: "Recorded by" }, { key: "invoice", label: "Supplier invoice" }, { key: "receipt", label: "Receipt attached" }];
  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" meta="Everything the school spends, so you can see what's left after costs.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Expenses", cols, exportRows, "expenses")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "expenses")}>CSV</Btn>
        {p.expenses && <Btn className="max-md:hidden" onClick={() => setAdding(true)} data-testid="button-new-expense"><Plus className="h-4 w-4" />Record expense</Btn>}
      </PageHeader>
      <FormDialog open={adding} onOpenChange={setAdding} size="lg" title="Record an expense" description="Salaries, food, transport, supplies or anything else paid out. To pay a supplier's invoice, use Supplier invoices so it's marked paid.">{adding && <NewExpense onDone={() => setAdding(false)} />}</FormDialog>
      <FormDialog open={!!voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }} title={voiding ? `Void ${ks(voiding.amount)} for ${voiding.description}?` : "Void expense"}>{voiding && <VoidExpense key={voiding.id} e={voiding} onDone={() => setVoiding(null)} />}</FormDialog>

      <section className="rounded-2xl border border-border bg-card p-5" data-testid="expenses-total">
        <div className="text-sm text-muted-foreground">Spent{from || to ? ` from ${from ? fmtDate(from) : "the start"} to ${to ? fmtDate(to) : "today"}` : ""}</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{ks(total)}</div>
        {byCat.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{byCat.map(([c, v]) => <span key={c} className="rounded-full bg-muted px-3 py-1 text-xs"><b className="font-semibold">{categoryName(c)}</b> {ks(v)}</span>)}</div>}
      </section>

      <Panel>
        <div className="border-b border-border/70 p-4">
          <Filters align="end" active={category ? 1 : 0} onClear={() => setCategory("")} lead={<ListSearch value={text} onChange={setText} placeholder="Search what for, paid to, reference" />}>
            <Field label="From"><TextInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><TextInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Spent on"><NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Everything</option>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryName(c)}</option>)}</NativeSelect></Field>
          </Filters>
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<Receipt className="h-5 w-5" />} title="No expenses in these dates" body="Record salaries, food, transport and supplies as they're paid. Finance Book then shows what's left after costs.">
            {p.expenses && <Btn onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Record expense</Btn>}
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((e) => (
              <li key={e.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm ${e.status === "voided" ? "opacity-60" : ""}`} data-testid={`row-expense-${e.id}`}>
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(e.date)}</span>
                <div className="min-w-[12rem] flex-1">
                  <div className={`font-medium ${e.status === "voided" ? "line-through" : ""}`}>{e.description}</div>
                  <div className="text-xs text-muted-foreground">{categoryName(e.category)} · {METHOD_LABEL[e.method] ?? e.method}{e.supplierName || e.payee ? ` · to ${e.supplierName ?? e.payee}` : ""}{e.reference ? ` · ${e.reference}` : ""}{e.recordedByName ? ` · by ${e.recordedByName}` : ""}</div>
                  {(e.attachmentUrl || e.supplierInvoiceNo) && <div className="mt-0.5 flex flex-wrap items-center gap-3">{e.attachmentUrl && <AttachmentLink refPath={e.attachmentUrl} />}{e.supplierInvoiceNo && <Link href="/supplier-invoices" className="text-xs text-primary hover:underline">Pays invoice {e.supplierInvoiceNo}</Link>}</div>}
                  {e.status === "voided" && <div className="text-xs text-destructive">Voided: {e.voidReason}</div>}
                </div>
                <span className={`font-semibold tabular-nums ${e.status === "voided" ? "line-through" : ""}`}>{ks(e.amount)}</span>
                {e.status === "voided" ? <Pill tone="inactive">voided</Pill> : p.expenses && <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVoiding(e)}>Void</Btn>}
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {p.expenses && <Fab testid="fab-new-expense" label="Record expense" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} />}
    </div>
  );
}
