import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListSuppliers, getListSuppliersQueryKey, useCreateSupplier, useUpdateSupplier, useDeleteSupplier, type Supplier } from "@workspace/api-client-react";
import { ClipboardList, Eye, EyeOff, FileText, Loader2, MoreHorizontal, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { ks } from "@/components/procurement-kit";
import { usePerms, errMsg } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";

export function SupplierForm({ supplier, onDone }: { supplier?: Supplier; onDone: (s?: Supplier) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const [f, setF] = useState({ name: supplier?.name ?? "", contactPerson: supplier?.contactPerson ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", kraPin: supplier?.kraPin ?? "", address: supplier?.address ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = (s: Supplier) => { void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); toast({ title: supplier ? "Supplier updated" : `${s.name} added` }); onDone(s); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2) return setErr("Enter the supplier's name.");
    if (f.kraPin.trim() && !/^[A-Za-z]\d{9}[A-Za-z]$/.test(f.kraPin.trim())) return setErr("A KRA PIN looks like P051234567X.");
    const clean = (v: string) => v.trim();
    if (supplier) update.mutate({ id: supplier.id, data: { name: clean(f.name), contactPerson: clean(f.contactPerson) || null, phone: clean(f.phone) || null, email: clean(f.email) || null, kraPin: clean(f.kraPin) || null, address: clean(f.address) || null } }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
    else create.mutate({ data: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) as { name: string } }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
  };
  const busy = create.isPending || update.isPending;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business or person" required className="sm:col-span-2"><TextInput data-testid="input-supplier-name" value={f.name} onChange={set("name")} maxLength={160} placeholder="e.g. Mwangi Wholesalers" /></Field>
        <Field label="Contact person"><TextInput value={f.contactPerson} onChange={set("contactPerson")} maxLength={120} /></Field>
        <Field label="Phone"><TextInput type="tel" value={f.phone} onChange={set("phone")} maxLength={20} /></Field>
        <Field label="Email"><TextInput type="email" value={f.email} onChange={set("email")} maxLength={160} /></Field>
        <Field label="KRA PIN"><TextInput value={f.kraPin} onChange={set("kraPin")} maxLength={11} className="font-mono uppercase" placeholder="P051234567X" /></Field>
        <Field label="Address" className="sm:col-span-2"><TextInput value={f.address} onChange={set("address")} maxLength={200} placeholder="Town, building or P.O. Box" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-supplier" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{supplier ? "Save changes" : "Add supplier"}</Btn><Btn type="button" variant="ghost" onClick={() => onDone()}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Suppliers() {
  usePageTitle("Suppliers");
  const p = usePerms();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListSuppliers({ query: { queryKey: getListSuppliersQueryKey() } });
  const update = useUpdateSupplier();
  const remove = useDeleteSupplier();
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"new" | Supplier | null>(null);
  const [text, setText] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const canEdit = p.procurement || p.expenses;
  const rows = (q.data ?? []).filter((s) => (showInactive || s.isActive) && matches(text, s.name, s.contactPerson, s.phone, s.kraPin));
  const { rows: pageRows, pager } = usePaged(rows, [text, showInactive]);
  const owed = rows.reduce((t, s) => t + Number(s.owed), 0);
  const toggle = (s: Supplier) => update.mutate({ id: s.id, data: { isActive: !s.isActive } }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); toast({ title: s.isActive ? `${s.name} marked inactive` : `${s.name} is active again` }); },
    onError: (x) => toast({ title: "Could not update", description: errMsg(x), variant: "destructive" }),
  });
  const del = (s: Supplier) => remove.mutate({ id: s.id }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); toast({ title: `${s.name} deleted` }); setDeleting(null); },
    onError: (x) => { toast({ title: "Could not delete", description: errMsg(x), variant: "destructive" }); setDeleting(null); },
  });
  const cols = [{ key: "name", label: "Supplier" }, { key: "contactPerson", label: "Contact" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "kraPin", label: "KRA PIN" }, { key: "owed", label: "Owed" }];
  const exportRows = rows.map((s) => ({ name: s.name, contactPerson: s.contactPerson ?? "", phone: s.phone ?? "", email: s.email ?? "", kraPin: s.kraPin ?? "", owed: s.owed }));
  return (
    <div className="space-y-5">
      <PageHeader title="Suppliers" meta="Who the school buys from, and what is still owed to each.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Suppliers", cols, exportRows, "suppliers")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "suppliers")}>CSV</Btn>
        {canEdit && <Btn className="max-md:hidden" data-testid="button-new-supplier" onClick={() => setMode("new")}><Plus className="h-4 w-4" />Add supplier</Btn>}
      </PageHeader>
      <FormDialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} title={mode === "new" ? "Add a supplier" : mode ? `Edit ${mode.name}` : ""} size="lg">
        {mode && <SupplierForm key={mode === "new" ? "new" : mode.id} supplier={mode === "new" ? undefined : mode} onDone={() => setMode(null)} />}
      </FormDialog>
      <FormDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={deleting ? `Delete ${deleting.name}?` : ""}>
        {deleting && <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">This removes the supplier for good. A supplier already on an LPO, invoice or expense can't be deleted; mark it inactive instead so past records keep its name.</p>
          <FormActions><Btn variant="danger" data-testid="button-confirm-delete-supplier" disabled={remove.isPending} onClick={() => del(deleting)}>{remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete supplier</Btn><Btn variant="ghost" onClick={() => setDeleting(null)}>Keep it</Btn></FormActions>
        </div>}
      </FormDialog>
      {owed > 0 && <section className="rounded-2xl border border-border bg-card p-5"><div className="text-sm text-muted-foreground">Owed to suppliers on unpaid invoices</div><div className="mt-1 text-3xl font-semibold tabular-nums">{ks(owed)}</div><Link href="/supplier-invoices" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">See unpaid invoices</Link></section>}
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/70 p-4">
          <ListSearch value={text} onChange={setText} placeholder="Search name, contact, phone or KRA PIN" className="flex-1" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
        </div>
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<Truck className="h-5 w-5" />} title={q.data?.length ? "No supplier matches" : "No suppliers yet"} body="Add the shops and businesses you buy from, then raise LPOs and record their invoices against them.">
            {canEdit && <Btn onClick={() => setMode("new")}><Plus className="h-4 w-4" />Add supplier</Btn>}
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm ${s.isActive ? "" : "opacity-60"}`} data-testid={`row-supplier-${s.id}`}>
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{s.name} {!s.isActive && <Pill tone="inactive">inactive</Pill>}</div>
                  <div className="text-xs text-muted-foreground">{[s.contactPerson, s.phone, s.email, s.kraPin && `PIN ${s.kraPin}`].filter(Boolean).join(" · ") || "No contact details"}</div>
                </div>
                {s.openOrders > 0 && <Link href={`/purchases?supplier=${s.id}`} className="text-xs text-primary hover:underline">{s.openOrders} open LPO{s.openOrders === 1 ? "" : "s"}</Link>}
                <span className={`tabular-nums ${Number(s.owed) > 0 ? "font-semibold" : "text-muted-foreground"}`}>{Number(s.owed) > 0 ? `${ks(s.owed)} owed` : "Nothing owed"}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${s.name}`} data-testid={`button-actions-supplier-${s.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground max-md:border max-md:border-border max-md:p-2.5"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {p.procurement && s.isActive && <DropdownMenuItem onSelect={() => navigate(`/purchases?new=1&supplier=${s.id}`)}><ClipboardList className="h-4 w-4" />Raise LPO</DropdownMenuItem>}
                    {canEdit && s.isActive && <DropdownMenuItem onSelect={() => navigate(`/supplier-invoices?new=1&supplier=${s.id}`)}><FileText className="h-4 w-4" />Record invoice</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => navigate(`/purchases?supplier=${s.id}`)}><Eye className="h-4 w-4" />See LPOs</DropdownMenuItem>
                    {canEdit && <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setMode(s)} data-testid={`button-edit-supplier-${s.id}`}><Pencil className="h-4 w-4" />Edit details</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => toggle(s)} disabled={update.isPending}><EyeOff className="h-4 w-4" />{s.isActive ? "Mark inactive" : "Reactivate"}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDeleting(s)} className="text-destructive focus:text-destructive" data-testid={`button-delete-supplier-${s.id}`}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                    </>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {canEdit && <Fab testid="fab-new-supplier" label="Add supplier" icon={<Plus className="h-4 w-4" />} onClick={() => setMode("new")} />}
    </div>
  );
}
