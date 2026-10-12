import { useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useListStoreItems, getListStoreItemsQueryKey, useCreateStoreItem, useUpdateStoreItem, useCreateStockMovement, getListStockMovementsQueryKey, type StoreItem, type StockMovementType } from "@workspace/api-client-react";
import { AlertTriangle, Archive, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Loader2, MoreHorizontal, Package, Pencil, Plus, ScrollText, Undo2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, Filters, TextInput, NativeSelect, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { MoneyInput } from "@/components/finance-kit";
import { ks, qtyText } from "@/components/procurement-kit";
import { usePerms, errMsg, fmtDate, localToday } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const STORE_CATEGORIES = ["Food", "Stationery", "Cleaning", "Kitchen", "Uniforms", "Books", "Sports", "Lab", "Medical", "Fuel", "Maintenance", "Furniture", "Other"];
const QTY = /^\d{1,8}(\.\d{1,2})?$/;

function ItemForm({ item, onDone }: { item?: StoreItem; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateStoreItem();
  const update = useUpdateStoreItem();
  const [f, setF] = useState({ name: item?.name ?? "", category: item?.category ?? "", unit: item?.unit ?? "", sku: item?.sku ?? "", reorderLevel: item ? String(Number(item.reorderLevel)) : "", unitCost: item?.unitCost ? String(Number(item.unitCost)) : "", location: item?.location ?? "", openingQuantity: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = () => { void qc.invalidateQueries({ queryKey: getListStoreItemsQueryKey() }); void qc.invalidateQueries({ queryKey: getListStockMovementsQueryKey() }); toast({ title: item ? "Item updated" : `${f.name.trim()} added to the store` }); onDone(); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2) return setErr("Name the item, e.g. Maize flour 2kg.");
    if (!f.category) return setErr("Choose a category.");
    if (!f.unit.trim()) return setErr("Say how it's counted, e.g. bag, packet, litre, piece.");
    for (const [k, label] of [["reorderLevel", "Reorder level"], ["openingQuantity", "Quantity in store now"]] as const) if (f[k].trim() && !QTY.test(f[k].trim())) return setErr(`${label} must be a number.`);
    const base = { name: f.name.trim(), category: f.category, unit: f.unit.trim(), reorderLevel: f.reorderLevel.trim() || "0" };
    if (item) update.mutate({ id: item.id, data: { ...base, sku: f.sku.trim() || null, unitCost: f.unitCost.trim() || null, location: f.location.trim() || null } }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
    else create.mutate({ data: { ...base, ...(f.sku.trim() ? { sku: f.sku.trim() } : {}), ...(f.unitCost.trim() ? { unitCost: f.unitCost.trim() } : {}), ...(f.location.trim() ? { location: f.location.trim() } : {}), ...(f.openingQuantity.trim() ? { openingQuantity: f.openingQuantity.trim() } : {}) } }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
  };
  const busy = create.isPending || update.isPending;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item" required className="sm:col-span-2"><TextInput data-testid="input-item-name" value={f.name} onChange={set("name")} maxLength={120} placeholder="e.g. Maize flour 2kg, Exercise books 96pg" /></Field>
        <Field label="Category" required><NativeSelect data-testid="select-item-category" value={f.category} onChange={set("category")}><option value="">Choose</option>{[...new Set([...STORE_CATEGORIES, ...(item ? [item.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></Field>
        <Field label="Counted in" required><TextInput data-testid="input-item-unit" value={f.unit} onChange={set("unit")} maxLength={30} placeholder="bag, packet, litre, piece" /></Field>
        <Field label="Reorder when down to" hint="Home warns when stock falls to this"><TextInput inputMode="decimal" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value.replace(/[^\d.]/g, "") })} className="font-mono" placeholder="0" /></Field>
        <Field label="Cost of one (KES)"><MoneyInput value={f.unitCost} onChange={(v) => setF({ ...f, unitCost: v })} /></Field>
        {!item && <Field label="Quantity in store now" hint="Recorded as the opening stock count"><TextInput data-testid="input-item-opening" inputMode="decimal" value={f.openingQuantity} onChange={(e) => setF({ ...f, openingQuantity: e.target.value.replace(/[^\d.]/g, "") })} className="font-mono" placeholder="0" /></Field>}
        <Field label="Where it's kept"><TextInput value={f.location} onChange={set("location")} maxLength={60} placeholder="e.g. Main store, shelf B" /></Field>
        <Field label="Code"><TextInput value={f.sku} onChange={set("sku")} maxLength={40} className="font-mono" placeholder="Optional" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-item" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{item ? "Save changes" : "Add item"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

const MOVE: Record<StockMovementType, { title: string; qty: string; to?: string; done: string }> = {
  receive: { title: "Receive stock", qty: "How many came in", done: "Stock received" },
  issue: { title: "Issue stock", qty: "How many to issue", to: "Issued to", done: "Stock issued" },
  return: { title: "Take back stock", qty: "How many came back", to: "Returned by", done: "Stock returned" },
  adjust: { title: "Count stock", qty: "How many are actually in the store", done: "Stock count saved" },
};

export function MoveForm({ item, type, onDone }: { item: StoreItem; type: StockMovementType; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreateStockMovement();
  const cfg = MOVE[type];
  const [f, setF] = useState({ quantity: "", date: localToday(), issuedTo: "", reference: "", note: "", unitCost: item.unitCost ? String(Number(item.unitCost)) : "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const after = QTY.test(f.quantity) ? (type === "adjust" ? Number(f.quantity) : Number(item.quantity) + (type === "issue" ? -1 : 1) * Number(f.quantity)) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!QTY.test(f.quantity.trim())) return setErr("Enter a quantity, e.g. 5.");
    if (type !== "adjust" && Number(f.quantity) <= 0) return setErr("Enter a quantity above zero.");
    if (type === "issue" && Number(f.quantity) > Number(item.quantity)) return setErr(`Only ${qtyText(item.quantity)} ${item.unit} in the store.`);
    if (type === "issue" && !f.issuedTo.trim()) return setErr("Say who it's issued to, e.g. Kitchen or Grade 4 class teacher.");
    if (type === "adjust" && !f.note.trim()) return setErr("Say why the count differs, e.g. Termly stock take.");
    m.mutate({ data: { itemId: item.id, type, quantity: f.quantity.trim(), date: f.date, ...(f.issuedTo.trim() ? { issuedTo: f.issuedTo.trim() } : {}), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}), ...(type === "receive" && f.unitCost.trim() ? { unitCost: f.unitCost.trim() } : {}) } }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getListStoreItemsQueryKey() }); void qc.invalidateQueries({ queryKey: getListStockMovementsQueryKey() }); toast({ title: cfg.done }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">In the store now: <b className="text-foreground">{qtyText(item.quantity)} {item.unit}</b>{after !== null && after >= 0 ? <> · after this: <b className="text-foreground">{qtyText(String(after))} {item.unit}</b></> : null}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${cfg.qty} (${item.unit})`} required><TextInput data-testid="input-move-qty" inputMode="decimal" autoFocus value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/[^\d.]/g, "") })} className="font-mono" /></Field>
        <Field label="Date" required><TextInput type="date" value={f.date} max={localToday()} onChange={set("date")} /></Field>
        {cfg.to && <Field label={cfg.to} required={type === "issue"}><TextInput data-testid="input-move-to" value={f.issuedTo} onChange={set("issuedTo")} maxLength={120} placeholder="Kitchen, Grade 4, Mr Otieno" /></Field>}
        {type === "receive" && <Field label="Cost of one (KES)"><MoneyInput value={f.unitCost} onChange={(v) => setF({ ...f, unitCost: v })} /></Field>}
        {type !== "adjust" && <Field label="Reference"><TextInput value={f.reference} onChange={set("reference")} maxLength={60} className="font-mono" placeholder={type === "receive" ? "Delivery note no." : "Requisition no."} /></Field>}
        <Field label={type === "adjust" ? "Why" : "Note"} required={type === "adjust"} className={type === "adjust" ? "sm:col-span-2" : ""}><TextInput value={f.note} onChange={set("note")} maxLength={200} placeholder={type === "adjust" ? "e.g. Termly stock take, 2 packets spoilt" : ""} /></Field>
      </div>
      {type === "receive" && <p className="text-xs text-muted-foreground">Bought on an LPO? Record the delivery on the LPO instead, so the order is checked off too.</p>}
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-move" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{cfg.title}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Store() {
  usePageTitle("Store");
  const p = usePerms();
  const q = useListStoreItems({ query: { queryKey: getListStoreItemsQueryKey() } });
  const [mode, setMode] = useState<"new" | StoreItem | null>(null);
  const [moving, setMoving] = useState<{ item: StoreItem; type: StockMovementType } | null>(null);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const retire = useUpdateStoreItem();
  const toggleRetired = (item: StoreItem) => retire.mutate({ id: item.id, data: { isActive: !item.isActive } }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListStoreItemsQueryKey() }); toast({ title: item.isActive ? `${item.name} retired` : `${item.name} is back in use` }); },
    onError: (x) => toast({ title: "Could not update", description: errMsg(x), variant: "destructive" }),
  });
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const all = q.data ?? [];
  const low = all.filter((i) => i.low);
  const rows = all.filter((i) => (showInactive || i.isActive) && (!category || i.category === category) && (!lowOnly || i.low) && matches(text, i.name, i.sku, i.category, i.location));
  const categories = useMemo(() => [...new Set(all.map((i) => i.category))].sort(), [all]);
  const value = all.filter((i) => i.isActive).reduce((t, i) => t + Number(i.value ?? 0), 0);
  const { rows: pageRows, pager } = usePaged(rows, [text, category, lowOnly, showInactive]);
  const cols = [{ key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "quantity", label: "In store" }, { key: "unit", label: "Unit" }, { key: "reorderLevel", label: "Reorder at" }, { key: "unitCost", label: "Cost each" }, { key: "value", label: "Value" }, { key: "location", label: "Location" }];
  const exportRows = rows.map((i) => ({ name: i.name, category: i.category, quantity: i.quantity, unit: i.unit, reorderLevel: i.reorderLevel, unitCost: i.unitCost ?? "", value: i.value ?? "", location: i.location ?? "" }));
  return (
    <div className="space-y-5">
      <PageHeader title="Store" meta="What the school holds. Receive, issue and count stock; every change is kept on the item's stock card.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Store", cols, exportRows, "store-stock")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "store-stock")}>CSV</Btn>
        {p.store && <Btn className="max-md:hidden" data-testid="button-new-item" onClick={() => setMode("new")}><Plus className="h-4 w-4" />Add item</Btn>}
      </PageHeader>
      <FormDialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} size="lg" title={mode === "new" ? "Add a store item" : mode ? `Edit ${mode.name}` : ""}>{mode && <ItemForm key={mode === "new" ? "new" : mode.id} item={mode === "new" ? undefined : mode} onDone={() => setMode(null)} />}</FormDialog>
      <FormDialog open={!!moving} onOpenChange={(o) => { if (!o) setMoving(null); }} title={moving ? `${MOVE[moving.type].title}: ${moving.item.name}` : ""}>{moving && <MoveForm key={`${moving.item.id}-${moving.type}`} item={moving.item} type={moving.type} onDone={() => setMoving(null)} />}</FormDialog>

      <section className="grid gap-3 max-md:grid-cols-2 max-md:[&>*:last-child]:col-span-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5"><div className="text-sm text-muted-foreground">Items</div><div className="mt-1 text-3xl font-semibold tabular-nums">{all.filter((i) => i.isActive).length}</div></div>
        <button type="button" onClick={() => setLowOnly(!lowOnly)} className={cn("rounded-2xl border bg-card p-5 text-left transition hover:border-primary/40", low.length ? "border-amber-600/40" : "border-border", lowOnly && "ring-2 ring-primary/30")} data-testid="store-low">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">{low.length > 0 && <AlertTriangle className="h-4 w-4 text-amber-600" />}Running low</div><div className="mt-1 text-3xl font-semibold tabular-nums">{low.length}</div>
        </button>
        <div className="rounded-2xl border border-border bg-card p-5"><div className="text-sm text-muted-foreground">Stock value at last cost</div><div className="mt-1 text-3xl font-semibold tabular-nums">{ks(value)}</div></div>
      </section>

      <Panel>
        <div className="border-b border-border/70 p-4">
          <Filters align="end" active={(category ? 1 : 0) + (lowOnly ? 1 : 0) + (showInactive ? 1 : 0)} onClear={() => { setCategory(""); setLowOnly(false); setShowInactive(false); }} lead={<ListSearch value={text} onChange={setText} placeholder="Search item, code or location" />}>
            <Field label="Category"><NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></Field>
            <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />Running low</label>
            <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show retired</label>
          </Filters>
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<Package className="h-5 w-5" />} title={all.length ? "No item matches" : "The store is empty"} body="Add what the store holds, such as foodstuffs, stationery and cleaning supplies, with how many are there now.">
            {p.store && <Btn onClick={() => setMode("new")}><Plus className="h-4 w-4" />Add item</Btn>}
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((i) => (
              <li key={i.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm", !i.isActive && "opacity-60")} data-testid={`row-item-${i.id}`}>
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{i.name} {i.low && <Pill tone="duplicate">running low</Pill>} {!i.isActive && <Pill tone="inactive">retired</Pill>}</div>
                  <div className="text-xs text-muted-foreground">{[i.category, i.location, i.sku, i.unitCost && `${ks(i.unitCost)} each`, i.lastMovementAt && `last moved ${fmtDate(i.lastMovementAt)}`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="w-28 text-right"><div className={cn("text-lg font-semibold tabular-nums", i.low && "text-amber-700")}>{qtyText(i.quantity)}</div><div className="text-[11px] text-muted-foreground">{i.unit}{Number(i.reorderLevel) > 0 ? ` · reorder at ${qtyText(i.reorderLevel)}` : ""}</div></div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${i.name}`} data-testid={`button-actions-item-${i.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground max-md:border max-md:border-border max-md:p-2.5"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {p.store && i.isActive && <>
                      <DropdownMenuItem disabled={Number(i.quantity) <= 0} onSelect={() => setMoving({ item: i, type: "issue" })} data-testid={`button-issue-${i.id}`}><ArrowUpFromLine className="h-4 w-4" />Issue stock</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMoving({ item: i, type: "receive" })} data-testid={`button-receive-${i.id}`}><ArrowDownToLine className="h-4 w-4" />Receive stock</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMoving({ item: i, type: "return" })}><Undo2 className="h-4 w-4" />Take back a return</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMoving({ item: i, type: "adjust" })}><ClipboardCheck className="h-4 w-4" />Count stock</DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>}
                    <DropdownMenuItem onSelect={() => navigate(`/store/movements?item=${i.id}`)}><ScrollText className="h-4 w-4" />Stock card</DropdownMenuItem>
                    {p.store && <>
                      <DropdownMenuItem onSelect={() => setMode(i)} data-testid={`button-edit-item-${i.id}`}><Pencil className="h-4 w-4" />Edit details</DropdownMenuItem>
                      <DropdownMenuItem disabled={retire.isPending} onSelect={() => toggleRetired(i)}><Archive className="h-4 w-4" />{i.isActive ? "Retire" : "Restore"}</DropdownMenuItem>
                    </>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {p.store && <Fab testid="fab-new-item" label="Add item" icon={<Plus className="h-4 w-4" />} onClick={() => setMode("new")} />}
    </div>
  );
}

