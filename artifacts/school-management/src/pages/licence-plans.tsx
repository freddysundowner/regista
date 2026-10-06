import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListLicencePlans, useCreateLicencePlan, useEditLicencePlan, getListLicencePlansQueryKey, type LicencePlan } from "@workspace/api-client-react";
import { BadgeCheck, Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, Field, TextInput, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { cents, kes } from "@/components/platform-billing";
import { errMsg } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { days, invalidateLicensing } from "@/lib/licensing";
import { useToast } from "@/hooks/use-toast";

const PRICE_RE = /^[0-9]{1,10}(\.[0-9]{1,2})?$/;

function PlanForm({ plan, onDone }: { plan?: LicencePlan; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateLicencePlan();
  const edit = useEditLicencePlan();
  const [f, setF] = useState({ name: plan?.name ?? "", description: plan?.description ?? "", durationDays: String(plan?.durationDays ?? ""), price: plan?.price ?? "", subscriptionPrice: plan?.subscriptionPrice ?? "", isActive: plan?.isActive ?? true });
  const [err, setErr] = useState<string | null>(null);
  const pending = create.isPending || edit.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const name = f.name.trim(), description = f.description.trim(), price = f.price.trim().replace(/,/g, "");
    const d = Number(f.durationDays);
    if (name.length < 2 || name.length > 100) return setErr("Name must be 2 to 100 characters.");
    if (description.length > 500) return setErr("Description can be at most 500 characters.");
    if (!Number.isInteger(d) || d < 1 || d > 3650) return setErr("Duration must be a whole number of days from 1 to 3650.");
    if (!PRICE_RE.test(price) || cents(price) <= 0) return setErr("Price must be above zero with up to 2 decimal places.");
    const subscriptionPrice = f.subscriptionPrice.trim().replace(/,/g, "");
    if (!PRICE_RE.test(subscriptionPrice) || cents(subscriptionPrice) <= 0) return setErr("Subscription price must be above zero with up to 2 decimal places.");
    const data = { name, description, durationDays: d, price, subscriptionPrice, isActive: f.isActive };
    const opts = {
      onSuccess: (p: LicencePlan) => { invalidateLicensing(qc); qc.invalidateQueries({ queryKey: getListLicencePlansQueryKey() }); toast({ title: plan ? `${p.name} updated` : `${p.name} created` }); onDone(); },
      onError: (x: unknown) => setErr(errMsg(x)),
    };
    if (plan) edit.mutate({ planId: plan.id, data }, opts); else create.mutate({ data }, opts);
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <Field label="Name" required><TextInput data-testid="input-plan-name" required minLength={2} maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Termly licence" /></Field>
      <Field label="Description" hint="Optional, shown to schools when renewing"><textarea data-testid="input-plan-description" maxLength={500} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Duration (days)" required hint="Each day is exactly 24 hours"><TextInput data-testid="input-plan-days" type="number" required min={1} max={3650} step={1} className="font-mono" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} placeholder="120" /></Field>
        <Field label="Licence price (KES)" required><TextInput data-testid="input-plan-price" required inputMode="decimal" className="font-mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="24500.00" /></Field>
        <Field label="Subscription renewal price (KES)" required><TextInput data-testid="input-plan-subscription-price" required inputMode="decimal" className="font-mono" value={f.subscriptionPrice} onChange={(e) => setF({ ...f, subscriptionPrice: e.target.value })} placeholder="12000.00" /></Field>
      </div>
      <label className="flex items-start gap-2.5 text-sm"><input data-testid="checkbox-plan-active" type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span><span className="font-medium">Offered to schools</span><span className="block text-xs text-muted-foreground">Untick to archive. Archived plans cannot be ordered or granted.</span></span></label>
      {plan && <p className="text-xs text-muted-foreground">Changes apply to new orders and grants only. Licences and invoices already issued keep the price and duration they were bought with.</p>}
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-plan" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{plan ? "Save plan" : "Create plan"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function LicencePlans({ embedded = false }: { embedded?: boolean }) {
  usePageTitle(embedded ? undefined : "Licence plans");
  const q = useListLicencePlans();
  const [dlg, setDlg] = useState<{ plan?: LicencePlan; n: number } | null>(null);
  const [n, setN] = useState(0);
  const open = (plan?: LicencePlan) => { setN(n + 1); setDlg({ plan, n: n + 1 }); };
  const plans = q.data ?? [];
  const sorted = [...plans].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.durationDays - b.durationDays);
  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Timed school licences sold through manual invoices or granted directly.</p>
          <Btn data-testid="button-new-plan" onClick={() => open()}><Plus className="h-4 w-4" />Add licence plan</Btn>
        </div>
      ) : (
        <PageHeader eyebrow="Platform" title="Licence plans" meta="Timed school licences sold through manual invoices or granted directly.">
          <Btn data-testid="button-new-plan" onClick={() => open()}><Plus className="h-4 w-4" />New plan</Btn>
        </PageHeader>
      )}
      <Panel title="Plans" note="Archive a plan by unticking 'Offered'. Plans are never deleted, and existing purchases keep their snapshot terms.">
        {q.isLoading ? <SkeletonRows rows={3} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load plans.")} onRetry={() => q.refetch()} /> : !plans.length ? (
          <Empty icon={<BadgeCheck className="h-5 w-5" />} title="No licence plans yet" body="Create the first plan, e.g. a 120-day termly licence. Schools can then request renewals and you can grant licences.">
            <Btn data-testid="button-empty-new-plan" onClick={() => open()}><Plus className="h-4 w-4" />Create plan</Btn>
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60" data-testid="list-plans">{sorted.map((p) => (
            <li key={p.id} data-testid={`row-plan-${p.id}`} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${p.isActive ? "" : "opacity-70"}`}>
              <div className="min-w-0 basis-full sm:flex-1 sm:basis-48">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="min-w-0 [overflow-wrap:anywhere]">{p.name}</span><Pill tone={p.isActive ? "active" : "inactive"}>{p.isActive ? "offered" : "archived"}</Pill></div>
                <div className="break-words text-xs text-muted-foreground">{days(p.durationDays)}{p.description ? ` · ${p.description}` : ""}</div>
              </div>
              <div className="min-w-0 flex-1 text-left text-xs sm:flex-none sm:text-right"><div>Licence <span className="whitespace-nowrap font-mono font-semibold">{kes(p.price)}</span></div><div className="mt-1">Subscription <span className="whitespace-nowrap font-mono font-semibold">{kes(p.subscriptionPrice)}</span> / {days(p.durationDays)}</div></div>
              <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid={`button-edit-plan-${p.id}`} onClick={() => open(p)}><Pencil className="h-3.5 w-3.5" />Edit</Btn>
            </li>
          ))}</ul>
        )}
      </Panel>
      <FormDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} title={dlg?.plan ? `Edit ${dlg.plan.name}` : "New licence plan"} description="Price in KES; duration in whole 24-hour days." testid="dialog-plan">
        {dlg && <PlanForm key={dlg.n} plan={dlg.plan} onDone={() => setDlg(null)} />}
      </FormDialog>
    </div>
  );
}
