import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPurchaseOrders, getListPurchaseOrdersQueryKey, useCreatePurchaseOrder, useDecidePurchaseOrder, useCancelPurchaseOrder, useReceivePurchaseOrder,
  useListStoreItems, getListStoreItemsQueryKey, getListSuppliersQueryKey, getListStockMovementsQueryKey,
  type PurchaseOrder, type PurchaseOrderStatus,
} from "@workspace/api-client-react";
import { CheckCircle2, ClipboardList, Loader2, PackageCheck, Plus, Printer, Trash2, XCircle } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { MoneyInput } from "@/components/finance-kit";
import { LpoStatus, SupplierSelect, ks, qtyText, lpoStatusLabel } from "@/components/procurement-kit";
import { SupplierForm } from "@/pages/suppliers";
import { usePerms, useSession, errMsg, fmtDate, fmtDateTime, localToday } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Line = { storeItemId: string; description: string; unit: string; quantity: string; unitPrice: string };
const blankLine = (): Line => ({ storeItemId: "", description: "", unit: "", quantity: "1", unitPrice: "" });
const QTY = /^\d{1,8}(\.\d{1,2})?$/;
const lineTotal = (l: Line) => (QTY.test(l.quantity) && /^\d+(\.\d{1,2})?$/.test(l.unitPrice) ? Number(l.quantity) * Number(l.unitPrice) : 0);

function useRefreshLpos() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() }); void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); };
}

function NewLpo({ supplierId = "", onDone }: { supplierId?: string; onDone: (o?: PurchaseOrder) => void }) {
  const p = usePerms();
  const refresh = useRefreshLpos();
  const { toast } = useToast();
  const m = useCreatePurchaseOrder();
  const items = useListStoreItems({ query: { queryKey: getListStoreItemsQueryKey(), enabled: p.store || p.procurement } });
  const [f, setF] = useState({ supplierId, date: localToday(), neededBy: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = lines.reduce((t, l) => t + lineTotal(l), 0);
  // Lines can top up a store item when the school keeps a store.
  const pickable = (p.store || p.procurement) && !!items.data?.some((x) => x.isActive);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, id: string) => {
    const it = items.data?.find((x) => x.id === id);
    setLine(i, { storeItemId: id, ...(it ? { description: it.name, unit: it.unit, ...(it.unitCost && !lines[i].unitPrice ? { unitPrice: String(Number(it.unitCost)) } : {}) } : {}) });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.supplierId) return setErr("Choose the supplier.");
    const used = lines.filter((l) => l.description.trim() || l.unitPrice);
    if (!used.length) return setErr("Add at least one item.");
    for (const [i, l] of used.entries()) {
      if (!l.description.trim()) return setErr(`Line ${i + 1}: say what is being bought.`);
      if (!QTY.test(l.quantity) || Number(l.quantity) <= 0) return setErr(`Line ${i + 1}: enter a quantity, e.g. 10.`);
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(l.unitPrice)) return setErr(`Line ${i + 1}: enter the price for one ${l.unit || "unit"}.`);
    }
    if (f.neededBy && f.neededBy < f.date) return setErr("The needed-by date is before the LPO date.");
    m.mutate({ data: { supplierId: f.supplierId, date: f.date, ...(f.neededBy ? { neededBy: f.neededBy } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      lines: used.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, ...(l.unit.trim() ? { unit: l.unit.trim() } : {}), ...(l.storeItemId ? { storeItemId: l.storeItemId } : {}) })) } }, {
      onSuccess: (o) => { refresh(); toast({ title: `${o.reference} raised`, description: p.approveLpo ? "It needs approval before the supplier delivers." : "It now waits for approval." }); onDone(o); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  if (addingSupplier) return <SupplierForm onDone={(s) => { setAddingSupplier(false); if (s) setF({ ...f, supplierId: s.id }); }} />;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier" required className="sm:col-span-3">
          <div className="flex gap-2"><div className="flex-1"><SupplierSelect value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} testid="select-lpo-supplier" /></div><Btn type="button" variant="outline" onClick={() => setAddingSupplier(true)}><Plus className="h-4 w-4" />New</Btn></div>
        </Field>
        <Field label="LPO date" required><TextInput type="date" value={f.date} max={localToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Needed by"><TextInput type="date" value={f.neededBy} min={f.date} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></Field>
        <Field label="Notes for the supplier"><TextInput value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} placeholder="e.g. Deliver to the school store" /></Field>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Items</div>
        {lines.map((l, i) => (
          <div key={i} className={cn("grid gap-2 rounded-xl border border-border/70 p-3 sm:items-end", pickable ? "sm:grid-cols-[1.4fr_2fr_0.8fr_0.8fr_1fr_auto]" : "sm:grid-cols-[2fr_0.8fr_0.8fr_1fr_auto]")} data-testid={`lpo-line-${i}`}>
            {pickable && items.data ? (
              <Field label="Store item"><NativeSelect value={l.storeItemId} onChange={(e) => pickItem(i, e.target.value)}><option value="">Not a store item</option>{items.data.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
            ) : null}
            <Field label="Description"><TextInput data-testid={`input-lpo-desc-${i}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} maxLength={200} placeholder="e.g. Maize flour 2kg" /></Field>
            <Field label="Unit"><TextInput value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} maxLength={30} placeholder="bag" /></Field>
            <Field label="Qty"><TextInput data-testid={`input-lpo-qty-${i}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} className="font-mono" /></Field>
            <Field label="Price each"><MoneyInput testid={`input-lpo-price-${i}`} value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} /></Field>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
              <span className="text-xs tabular-nums text-muted-foreground">{ks(lineTotal(l))}</span>
              {lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Btn type="button" variant="outline" disabled={lines.length >= 50} onClick={() => setLines([...lines, blankLine()])}><Plus className="h-4 w-4" />Add item</Btn>
          <div className="text-right"><div className="text-xs text-muted-foreground">LPO total</div><div className="text-xl font-semibold tabular-nums" data-testid="lpo-total">{ks(total)}</div></div>
        </div>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-lpo" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Raise LPO</Btn><Btn type="button" variant="ghost" onClick={() => onDone()}>Cancel</Btn></FormActions>
    </form>
  );
}

function Receive({ o, onDone }: { o: PurchaseOrder; onDone: () => void }) {
  const refresh = useRefreshLpos();
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useReceivePurchaseOrder();
  const due = o.lines.map((l) => ({ ...l, left: Number(l.quantity) - Number(l.receivedQty) })).filter((l) => l.left > 0);
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(due.map((l) => [l.id, String(l.left)])));
  const [f, setF] = useState({ date: localToday(), deliveryNote: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const lines = due.map((l) => ({ lineId: l.id, quantity: (got[l.id] ?? "").trim() || "0" })).filter((l) => Number(l.quantity) > 0);
    if (!lines.length) return setErr("Enter how many of at least one item arrived.");
    const bad = due.find((l) => !QTY.test(got[l.id] || "0") || Number(got[l.id] || 0) > l.left);
    if (bad) return setErr(`${bad.description}: at most ${qtyText(String(bad.left))} more can arrive.`);
    m.mutate({ id: o.id, data: { date: f.date, lines, ...(f.deliveryNote.trim() ? { deliveryNote: f.deliveryNote.trim() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }, {
      onSuccess: (r) => { refresh(); void qc.invalidateQueries({ queryKey: getListStoreItemsQueryKey() }); void qc.invalidateQueries({ queryKey: getListStockMovementsQueryKey() }); toast({ title: r.status === "received" ? "Everything on this LPO has arrived" : "Delivery recorded", description: o.lines.some((l) => l.storeItemId) ? "Store items were added to stock." : undefined }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Delivered on" required><TextInput type="date" value={f.date} max={localToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Delivery note no."><TextInput value={f.deliveryNote} onChange={(e) => setF({ ...f, deliveryNote: e.target.value })} maxLength={60} className="font-mono" /></Field>
        <Field label="Note"><TextInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="e.g. 2 bags torn" /></Field>
      </div>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
        {due.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-[10rem] flex-1"><div className="font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{qtyText(String(l.left))} {l.unit ?? ""} still due{l.storeItemName ? ` · goes into store: ${l.storeItemName}` : ""}</div></div>
            <label className="flex items-center gap-2 text-xs">Arrived<TextInput data-testid={`input-receive-${l.id}`} inputMode="decimal" value={got[l.id] ?? ""} onChange={(e) => setGot({ ...got, [l.id]: e.target.value.replace(/[^\d.]/g, "") })} className="w-24 font-mono" /></label>
          </li>
        ))}
      </ul>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-receipt" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record delivery</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function Detail({ o, onClose }: { o: PurchaseOrder; onClose: () => void }) {
  const p = usePerms();
  const { user } = useSession();
  const refresh = useRefreshLpos();
  const { toast } = useToast();
  const decide = useDecidePurchaseOrder();
  const cancel = useCancelPurchaseOrder();
  const [mode, setMode] = useState<"view" | "receive" | "reject" | "cancel">("view");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const isAdmin = user.role === "school_admin" || user.role === "super_admin";
  const mayDecide = p.approveLpo && o.status === "pending" && (o.createdBy !== user.id || isAdmin);
  const mayReceive = (p.procurement || p.store) && ["approved", "partly_received"].includes(o.status);
  const mayCancel = (p.procurement || p.approveLpo) && ["pending", "approved"].includes(o.status) && !o.receipts.length;
  const done = (title: string) => { refresh(); toast({ title }); setMode("view"); setNote(""); };
  if (mode === "receive") return <Receive o={o} onDone={() => setMode("view")} />;
  if (mode === "reject" || mode === "cancel") return (
    <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); if (note.trim().length < 3) return setErr("Say why.");
      if (mode === "reject") decide.mutate({ id: o.id, data: { decision: "reject", note: note.trim() } }, { onSuccess: () => done(`${o.reference} rejected`), onError: (x) => setErr(errMsg(x)) });
      else cancel.mutate({ id: o.id, data: { reason: note.trim() } }, { onSuccess: () => done(`${o.reference} cancelled`), onError: (x) => setErr(errMsg(x)) }); }}>
      <Field label={mode === "reject" ? "Why is it rejected?" : "Why is it cancelled?"} required><TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={mode === "reject" ? "e.g. Price too high, get another quote" : "e.g. No longer needed"} /></Field>
      <FormError msg={err} />
      <FormActions><Btn type="submit" variant="danger" disabled={decide.isPending || cancel.isPending}>{mode === "reject" ? "Reject LPO" : "Cancel LPO"}</Btn><Btn type="button" variant="ghost" onClick={() => setMode("view")}>Back</Btn></FormActions>
    </form>
  );
  return (
    <div className="space-y-4 p-5 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <LpoStatus status={o.status} />
        <span><span className="text-muted-foreground">Date</span> {fmtDate(o.date)}</span>
        {o.neededBy && <span><span className="text-muted-foreground">Needed by</span> {fmtDate(o.neededBy)}</span>}
        <span><span className="text-muted-foreground">Raised by</span> {o.createdByName ?? "Unknown"}</span>
      </div>
      {o.decidedByName && <p className="text-xs text-muted-foreground">{o.status === "rejected" ? "Rejected" : o.status === "cancelled" ? "Cancelled" : "Approved"} by {o.decidedByName}{o.decidedAt ? ` on ${fmtDateTime(o.decidedAt)}` : ""}{o.decisionNote ? `: ${o.decisionNote}` : ""}</p>}
      {o.notes && <p className="rounded-lg bg-muted/50 px-3 py-2">{o.notes}</p>}
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 text-right font-medium">Arrived</th></tr></thead>
          <tbody className="divide-y divide-border/60">{o.lines.map((l) => (
            <tr key={l.id}><td className="px-3 py-2">{l.description}{l.storeItemName && <div className="text-[11px] text-muted-foreground">Store: {l.storeItemName}</div>}</td><td className="px-3 py-2 text-right tabular-nums">{qtyText(l.quantity)} {l.unit ?? ""}</td><td className="px-3 py-2 text-right tabular-nums">{ks(l.unitPrice)}</td><td className="px-3 py-2 text-right tabular-nums">{ks(l.amount)}</td><td className={cn("px-3 py-2 text-right tabular-nums", Number(l.receivedQty) >= Number(l.quantity) ? "text-primary" : "")}>{qtyText(l.receivedQty)}</td></tr>
          ))}</tbody>
          <tfoot><tr className="border-t border-border/70 font-semibold"><td className="px-3 py-2" colSpan={3}>Total</td><td className="px-3 py-2 text-right tabular-nums">{ks(o.total)}</td><td /></tr></tfoot>
        </table>
      </div>
      {o.receipts.length > 0 && <div><div className="mb-1 font-medium">Deliveries</div><ul className="space-y-1 text-xs text-muted-foreground">{o.receipts.map((r) => <li key={r.id}>{fmtDate(r.date)}{r.deliveryNote ? ` · note ${r.deliveryNote}` : ""} · {r.lines.map((x) => `${qtyText(x.quantity)} ${x.description}`).join(", ")}{r.receivedByName ? ` · received by ${r.receivedByName}` : ""}{r.note ? ` · ${r.note}` : ""}</li>)}</ul></div>}
      {Number(o.invoiced) > 0 && <p className="text-xs text-muted-foreground">Invoiced so far: <b>{ks(o.invoiced)}</b> of {ks(o.total)}. <Link href="/supplier-invoices" className="text-primary hover:underline">See invoices</Link></p>}
      {p.approveLpo && o.status === "pending" && o.createdBy === user.id && !isAdmin && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs">You raised this LPO, so someone else with approval rights must approve it.</p>}
      <FormError msg={err} />
      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
        {mayDecide && <Btn data-testid="button-approve-lpo" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, data: { decision: "approve" } }, { onSuccess: () => done(`${o.reference} approved`), onError: (x) => setErr(errMsg(x)) })}><CheckCircle2 className="h-4 w-4" />Approve</Btn>}
        {mayDecide && <Btn variant="outline" onClick={() => setMode("reject")}><XCircle className="h-4 w-4" />Reject</Btn>}
        {mayReceive && <Btn data-testid="button-receive-lpo" onClick={() => setMode("receive")}><PackageCheck className="h-4 w-4" />Record delivery</Btn>}
        {["approved", "partly_received", "received"].includes(o.status) && (p.procurement || p.expenses) && Number(o.invoiced) < Number(o.total) && <Link href={`/supplier-invoices?order=${o.id}`} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">Record supplier invoice</Link>}
        <Link href={`/purchases/${o.id}/print`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"><Printer className="h-4 w-4" />Print LPO</Link>
        {mayCancel && <Btn variant="ghost" onClick={() => setMode("cancel")}>Cancel LPO</Btn>}
        <Btn variant="ghost" className="ml-auto" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

const TABS: { id: string; label: string; test: (s: PurchaseOrderStatus) => boolean }[] = [
  { id: "pending", label: "Waiting for approval", test: (s) => s === "pending" },
  { id: "open", label: "To be delivered", test: (s) => s === "approved" || s === "partly_received" },
  { id: "received", label: "Delivered", test: (s) => s === "received" },
  { id: "closed", label: "Rejected or cancelled", test: (s) => s === "rejected" || s === "cancelled" },
  { id: "all", label: "All", test: () => true },
];

export default function Purchases() {
  usePageTitle("LPOs");
  const p = usePerms();
  const search = new URLSearchParams(useSearch());
  const supplier = search.get("supplier") ?? "";
  // ?new=1&supplier=… opens the form for that supplier; ?supplier=… alone shows that supplier's LPOs.
  const filterBy = search.get("new") === "1" ? "" : supplier;
  const q = useListPurchaseOrders(filterBy ? { supplierId: filterBy } : undefined, { query: { queryKey: getListPurchaseOrdersQueryKey(filterBy ? { supplierId: filterBy } : undefined) } });
  const [tab, setTab] = useState(() => (p.approveLpo && !p.procurement ? "pending" : "all"));
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(search.get("new") === "1");
  const [openId, setOpenId] = useState<string | null>(null);
  const all = q.data ?? [];
  const t = TABS.find((x) => x.id === tab)!;
  const rows = all.filter((o) => t.test(o.status) && matches(text, o.reference, o.supplierName, o.notes, ...o.lines.map((l) => l.description)));
  const counts = useMemo(() => Object.fromEntries(TABS.map((x) => [x.id, all.filter((o) => x.test(o.status)).length])), [all]);
  const { rows: pageRows, pager } = usePaged(rows, [tab, text, filterBy]);
  const open = all.find((o) => o.id === openId) ?? null;
  const cols = [{ key: "reference", label: "LPO" }, { key: "date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "items", label: "Items" }, { key: "total", label: "Total" }, { key: "status", label: "Status" }, { key: "raisedBy", label: "Raised by" }];
  const exportRows = rows.map((o) => ({ reference: o.reference, date: o.date, supplier: o.supplierName, items: o.lines.map((l) => `${qtyText(l.quantity)} ${l.description}`).join("; "), total: o.total, status: lpoStatusLabel(o.status), raisedBy: o.createdByName ?? "" }));
  return (
    <div className="space-y-5">
      <PageHeader title="LPOs" meta="Local purchase orders: raise one, have it approved, then record what the supplier delivers.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("LPOs", cols, exportRows, "lpos")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "lpos")}>CSV</Btn>
        {p.procurement && <Btn className="max-md:hidden" data-testid="button-new-lpo" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Raise LPO</Btn>}
      </PageHeader>
      <FormDialog open={adding} onOpenChange={setAdding} size="lg" title="Raise an LPO" description="Someone with approval rights approves it before the supplier delivers.">{adding && <NewLpo supplierId={search.get("new") === "1" ? supplier : ""} onDone={(o) => { setAdding(false); if (o) setOpenId(o.id); }} />}</FormDialog>
      <FormDialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }} size="lg" title={open ? `${open.reference} · ${open.supplierName}` : "LPO"}>{open && <Detail key={open.id} o={open} onClose={() => setOpenId(null)} />}</FormDialog>
      {filterBy && <p className="text-sm">Showing one supplier's LPOs. <Link href="/purchases" className="text-primary hover:underline">Show all</Link></p>}
      <Panel>
        <div className="space-y-3 border-b border-border/70 p-4">
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
            {TABS.map((x) => <button key={x.id} type="button" role="radio" aria-checked={tab === x.id} onClick={() => setTab(x.id)} data-testid={`tab-lpo-${x.id}`} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", tab === x.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>{x.label} <span className="tabular-nums opacity-70">{counts[x.id] ?? 0}</span></button>)}
          </div>
          <ListSearch value={text} onChange={setText} placeholder="Search LPO number, supplier or item" />
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<ClipboardList className="h-5 w-5" />} title={all.length ? "Nothing here" : "No LPOs yet"} body="Raise an LPO before buying from a supplier. It is approved, printed for the supplier, and checked off as goods arrive.">
            {p.procurement && <Btn onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Raise LPO</Btn>}
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left text-sm hover:bg-muted/40" data-testid={`row-lpo-${o.id}`}>
                  <span className="w-20 shrink-0 font-mono text-xs font-semibold">{o.reference}</span>
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-medium">{o.supplierName}</div>
                    <div className="truncate text-xs text-muted-foreground">{fmtDate(o.date)} · {o.lines.map((l) => l.description).join(", ")}</div>
                  </div>
                  <span className="font-semibold tabular-nums">{ks(o.total)}</span>
                  <LpoStatus status={o.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {p.procurement && <Fab testid="fab-new-lpo" label="Raise LPO" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} />}
    </div>
  );
}
