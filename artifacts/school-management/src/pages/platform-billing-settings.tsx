import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlatformPricing, useUpdatePlatformPricing, getGetPlatformPricingQueryKey,
  useGetRegistrationSettings, useUpdateRegistrationSettings, getGetRegistrationSettingsQueryKey,
  useListPaymentGateways, useUpdatePaymentGateway, getListPaymentGatewaysQueryKey,
  useListLicenceKeys, useGenerateLicenceKeys, useRevealLicenceKey, useRevokeLicenceKey, getListLicenceKeysQueryKey,
  useListStandaloneLicences, useIssueStandaloneLicence, getListStandaloneLicencesQueryKey,
  useListLicencePlans, useCreateLicencePlan, useEditLicencePlan, getListLicencePlansQueryKey,
  type PaymentGateway, type PaymentProvider, type LicenceKeyCode, type StandaloneLicence, type LicencePlan,
} from "@workspace/api-client-react";
import { Check, Copy, Download, Eye, KeyRound, Loader2, Pencil, Plus, ServerCog, Users, X } from "lucide-react";
import { Panel, Field, TextInput, NativeSelect, Btn, Pill, FormError, FormActions, SkeletonRows, ErrorState, Empty } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { Switch } from "@/components/ui/switch";
import { kes } from "@/components/platform-billing";
import { errMsg, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const PRICE_RE = /^\d{1,10}(\.\d{1,2})?$/;
const PERIODS = [
  { label: "month", days: 30 }, { label: "term", days: 120 }, { label: "year", days: 365 },
];
const intOrNull = (v: string) => (v.trim() ? Number(v.replace(/,/g, "")) : null);
const validLimit = (v: string) => !v.trim() || (/^\d+$/.test(v.replace(/,/g, "")) && Number(v.replace(/,/g, "")) >= 1);

function useCopy() {
  const { toast } = useToast();
  return (text: string, what = "Copied") => { void navigator.clipboard?.writeText(text).then(() => toast({ title: what })); };
}

// ---------- Pricing & registration ----------
export function PricingSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetPlatformPricing({ query: { queryKey: getGetPlatformPricingQueryKey() } });
  const save = useUpdatePlatformPricing();
  const [f, setF] = useState({ price: "", periodLabel: "term", periodDays: "120", maxLearners: "", trialDays: "7", highlights: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const p = q.data;
    if (!p) return;
    setF({ price: p.configured ? p.price : "", periodLabel: p.periodLabel || "term", periodDays: String(p.periodDays || 120),
      maxLearners: p.maxLearners ? String(p.maxLearners) : "", trialDays: String(p.trialDays), highlights: p.highlights.join("\n") });
  }, [q.data]);
  if (q.isLoading) return <Panel><SkeletonRows rows={4} cols={2} /></Panel>;
  if (q.isError) return <ErrorState msg={errMsg(q.error, "Could not load pricing.")} onRetry={() => q.refetch()} />;
  const submit = () => {
    setErr(null);
    const price = f.price.trim().replace(/,/g, "");
    if (!PRICE_RE.test(price) || Number(price) <= 0) return setErr("Enter a price above zero, e.g. 15000.");
    const periodDays = Number(f.periodDays);
    if (!Number.isInteger(periodDays) || periodDays < 1) return setErr("The period must be at least 1 day.");
    if (!validLimit(f.maxLearners)) return setErr("Learner limit must be a whole number, or blank for unlimited.");
    const trialDays = Number(f.trialDays);
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) return setErr("Trial must be between 0 and 90 days.");
    const highlights = f.highlights.split("\n").map((h) => h.trim()).filter(Boolean);
    save.mutate({ data: { price, periodDays, periodLabel: f.periodLabel.trim(), maxLearners: intOrNull(f.maxLearners), trialDays, highlights } }, {
      onSuccess: (d) => { qc.setQueryData(getGetPlatformPricingQueryKey(), d); toast({ title: "Pricing published", description: `${kes(d.price)} per ${d.periodLabel}` }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const preset = PERIODS.find((p) => p.label === f.periodLabel && String(p.days) === f.periodDays);
  return (
    <div className="space-y-6">
      <Panel title="Subscription price" note="One price for every school. It appears on the landing page and applies to new renewals; licences already bought keep their terms.">
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Price (KES)" required><TextInput data-testid="input-pricing-price" inputMode="decimal" className="font-mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="15000" /></Field>
          <Field label="Billed every" required>
            <NativeSelect data-testid="select-pricing-period" value={preset ? preset.label : "custom"} onChange={(e) => {
              const p = PERIODS.find((x) => x.label === e.target.value);
              setF(p ? { ...f, periodLabel: p.label, periodDays: String(p.days) } : { ...f, periodLabel: f.periodLabel, periodDays: f.periodDays });
            }}>
              {PERIODS.map((p) => <option key={p.label} value={p.label}>{p.label[0].toUpperCase() + p.label.slice(1)} ({p.days} days)</option>)}
              <option value="custom">Custom…</option>
            </NativeSelect>
          </Field>
          <Field label="Learner limit" hint="Blank means unlimited"><TextInput data-testid="input-pricing-learners" inputMode="numeric" value={f.maxLearners} onChange={(e) => setF({ ...f, maxLearners: e.target.value })} placeholder="800" /></Field>
          <Field label="Free trial (days)" hint="0 turns the trial off"><TextInput data-testid="input-pricing-trial" inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} /></Field>
          {!preset && <>
            <Field label="Period name" hint="Shown as “per …”"><TextInput value={f.periodLabel} onChange={(e) => setF({ ...f, periodLabel: e.target.value })} placeholder="term" /></Field>
            <Field label="Period length (days)"><TextInput inputMode="numeric" value={f.periodDays} onChange={(e) => setF({ ...f, periodDays: e.target.value })} /></Field>
          </>}
          <Field label="What's included" hint="One per line. Shown on the landing page." className="sm:col-span-2 lg:col-span-4">
            <textarea data-testid="input-pricing-highlights" rows={4} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })}
              placeholder={"All modules: fees, academics, attendance\nWhatsApp for parents\nUnlimited staff accounts"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-5 py-4">
          <FormError msg={err} />
          <Btn data-testid="button-save-pricing" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{q.data?.configured ? "Save pricing" : "Publish pricing"}</Btn>
          {!q.data?.configured && <span className="text-xs text-muted-foreground">Not published yet: the landing page hides pricing until you save.</span>}
        </div>
      </Panel>
      <PackageSettings defaultDays={q.data?.periodDays || 120} />
      <RegistrationSettings />
    </div>
  );
}

/** Packages sized by learner count. With at least one switched on, schools choose a package instead of the single price above. */
function PackageSettings({ defaultDays }: { defaultDays: number }) {
  const q = useListLicencePlans({ query: { queryKey: getListLicencePlansQueryKey() } });
  const [editing, setEditing] = useState<"new" | LicencePlan | null>(null);
  const plans = [...(q.data ?? [])].sort((a, b) => (a.maxLearners ?? Infinity) - (b.maxLearners ?? Infinity));
  return (
    <Panel title="Packages by number of learners" note="Each package covers schools up to a number of active learners. A school picks the one that fits and can upgrade mid-term, paying only the difference for the days left. While any package is switched on, schools choose a package and the single price above is not offered."
      action={<Btn variant="outline" className="h-8" data-testid="button-new-package" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> Add package</Btn>}>
      {q.isLoading ? <SkeletonRows rows={2} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load packages.")} onRetry={() => q.refetch()} />
        : !plans.length ? <Empty icon={<Users className="h-5 w-5" />} title="No packages yet" body="Add one for each size of school, for example up to 200 learners, up to 500, and unlimited. Until then every school pays the single price above." />
        : <ul className="divide-y divide-border/60">{plans.map((p) => (
          <li key={p.id} data-testid={`package-${p.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-semibold">{p.name}{!p.isActive && <Pill tone="inactive">Off</Pill>}</div>
              <div className="text-xs text-muted-foreground">{p.maxLearners ? `Up to ${p.maxLearners.toLocaleString()} learners` : "Any number of learners"} · {p.durationDays} days{p.description ? ` · ${p.description}` : ""}</div>
            </div>
            <div className="text-right text-sm font-semibold">{kes(p.subscriptionPrice)}</div>
            <button type="button" aria-label={`Edit ${p.name}`} data-testid={`button-edit-package-${p.id}`} onClick={() => setEditing(p)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
          </li>
        ))}</ul>}
      <FormDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} title={editing === "new" ? "Add a package" : "Edit package"} description="Schools already on a package keep the terms they bought.">
        {editing && <PackageForm key={editing === "new" ? "new" : editing.id} plan={editing === "new" ? undefined : editing} defaultDays={defaultDays} onDone={() => setEditing(null)} />}
      </FormDialog>
    </Panel>
  );
}
function PackageForm({ plan, defaultDays, onDone }: { plan?: LicencePlan; defaultDays: number; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateLicencePlan();
  const edit = useEditLicencePlan();
  const [f, setF] = useState({ name: plan?.name ?? "", description: plan?.description ?? "", maxLearners: plan?.maxLearners ? String(plan.maxLearners) : "", price: plan ? String(Number(plan.subscriptionPrice)) : "", durationDays: String(plan?.durationDays ?? defaultDays), isActive: plan?.isActive ?? true });
  const [err, setErr] = useState<string | null>(null);
  const pending = create.isPending || edit.isPending;
  const submit = () => {
    setErr(null);
    if (f.name.trim().length < 2) return setErr("Give the package a name.");
    if (!validLimit(f.maxLearners)) return setErr("Learner limit must be a whole number, or blank for any number.");
    if (!PRICE_RE.test(f.price.trim()) || Number(f.price) <= 0) return setErr("Enter the price in shillings.");
    if (!/^\d+$/.test(f.durationDays) || Number(f.durationDays) < 1) return setErr("Enter how many days the package lasts.");
    const data = { name: f.name.trim(), description: f.description.trim(), durationDays: Number(f.durationDays), price: f.price.trim(), subscriptionPrice: f.price.trim(), maxLearners: intOrNull(f.maxLearners), isActive: f.isActive };
    const done = { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListLicencePlansQueryKey() }); toast({ title: plan ? "Package saved" : "Package added" }); onDone(); }, onError: (x: unknown) => setErr(errMsg(x)) };
    if (plan) edit.mutate({ planId: plan.id, data }, done); else create.mutate({ data }, done);
  };
  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required hint="For example Small school, Medium, Large."><TextInput data-testid="input-package-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} /></Field>
        <Field label="Covers up to (learners)" hint="Leave blank for any number."><TextInput data-testid="input-package-learners" inputMode="numeric" value={f.maxLearners} onChange={(e) => setF({ ...f, maxLearners: e.target.value })} placeholder="e.g. 300" /></Field>
        <Field label="Price (KES)" required><TextInput data-testid="input-package-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="e.g. 10000" /></Field>
        <Field label="Lasts (days)" required hint="A term is usually 120."><TextInput data-testid="input-package-days" inputMode="numeric" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
        <Field label="Short description" className="sm:col-span-2"><TextInput data-testid="input-package-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></Field>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 sm:col-span-2"><span className="text-sm font-medium">Offer to schools</span><Switch data-testid="switch-package-active" checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /></label>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-package" disabled={pending} onClick={submit}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{plan ? "Save package" : "Add package"}</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </div>
  );
}

function RegistrationSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetRegistrationSettings({ query: { queryKey: getGetRegistrationSettingsQueryKey() } });
  const save = useUpdateRegistrationSettings();
  const on = q.data?.requireApproval ?? true;
  return (
    <Panel title="New school registrations">
      <label className="flex items-start justify-between gap-4 px-5 py-4">
        <span>
          <span className="block text-sm font-semibold">Review schools before they can sign in</span>
          <span className="block text-xs text-muted-foreground">{on
            ? "New schools wait for your approval. Their free trial starts when you approve them."
            : "New schools get in straight away, start their free trial and receive a welcome email."}</span>
        </span>
        <Switch data-testid="switch-require-approval" checked={on} disabled={q.isLoading || save.isPending}
          onCheckedChange={(v) => save.mutate({ data: { requireApproval: v } }, {
            onSuccess: (d) => { qc.setQueryData(getGetRegistrationSettingsQueryKey(), d); toast({ title: d.requireApproval ? "Approval required" : "Instant sign-up on" }); },
            onError: (x) => toast({ title: "Not saved", description: errMsg(x) }),
          })} />
      </label>
    </Panel>
  );
}

// ---------- Payment gateways ----------
const GATEWAY_FIELDS: Record<PaymentProvider, { config: { key: string; label: string; hint?: string; required?: boolean }[]; secrets: { key: string; label: string; hint?: string; optional?: boolean }[]; help: string }> = {
  mpesa: {
    config: [{ key: "paybill", label: "SunPay collection paybill", hint: "The paybill number parents pay into. Shown to schools that collect fees through SunPay." }],
    secrets: [{ key: "apiKey", label: "SunPay API key", hint: "sp_… from SunPay → Settings → API Keys" }, { key: "webhookSecret", label: "Webhook signing secret", hint: "Optional. From SunPay → Settings → Webhooks", optional: true }],
    help: "Collected through SunPay with an M-Pesa prompt on the payer's phone. Every payment is re-checked with SunPay before it's recorded. The same account lets schools collect fees: each school registers its own till or paybill under it from Settings → M-Pesa.",
  },
  stripe: {
    config: [], secrets: [{ key: "secretKey", label: "Secret key", hint: "sk_test_… or sk_live_…" }, { key: "webhookSecret", label: "Webhook signing secret", hint: "whsec_…" }],
    help: "Add a webhook in Stripe for checkout.session.completed and checkout.session.expired pointing to the URL below.",
  },
  paystack: {
    config: [], secrets: [{ key: "secretKey", label: "Secret key", hint: "sk_test_… or sk_live_…" }],
    help: "Set the webhook URL below in Paystack → Settings → API Keys & Webhooks. Paystack also accepts M-Pesa in Kenya.",
  },
};

export function GatewaySettings() {
  const q = useListPaymentGateways({ query: { queryKey: getListPaymentGatewaysQueryKey() } });
  const [editing, setEditing] = useState<PaymentGateway | null>(null);
  if (q.isLoading) return <Panel><SkeletonRows rows={3} cols={3} /></Panel>;
  if (q.isError || !q.data) return <ErrorState msg={errMsg(q.error, "Could not load payment settings.")} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {q.data.map((g) => (
          <div key={g.provider} data-testid={`card-gateway-${g.provider}`} className="flex flex-col rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{g.name}</h3>
              <Pill tone={g.enabled ? "active" : g.configured ? "pending" : "inactive"}>{g.enabled ? "live for schools" : g.configured ? "ready, off" : "not set up"}</Pill>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{GATEWAY_FIELDS[g.provider].help}</p>
            <div className="mt-3 text-xs text-muted-foreground">{g.provider === "mpesa" ? "SunPay" : g.environment === "live" ? "Live" : "Sandbox / test"}{g.updatedAt ? ` · updated ${fmtDateTime(g.updatedAt)}` : ""}</div>
            <Btn variant="outline" className="mt-4" data-testid={`button-configure-${g.provider}`} onClick={() => setEditing(g)}>Configure</Btn>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Credentials are encrypted and never shown again after saving. Saving does not test the connection; run a small test payment in sandbox first.</p>
      {editing && <GatewayDialog gateway={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GatewayDialog({ gateway, onClose }: { gateway: PaymentGateway; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const copy = useCopy();
  const save = useUpdatePaymentGateway();
  const spec = GATEWAY_FIELDS[gateway.provider];
  const [enabled, setEnabled] = useState(gateway.enabled);
  const [env, setEnv] = useState(gateway.environment);
  const [config, setConfig] = useState<Record<string, string>>({ ...gateway.publicConfig });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    setErr(null);
    const credentials = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
    save.mutate({ provider: gateway.provider, data: { enabled, environment: env, publicConfig: config, ...(Object.keys(credentials).length ? { credentials } : {}) } }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getListPaymentGatewaysQueryKey() }); toast({ title: `${gateway.name} saved` }); onClose(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const sunpay = gateway.provider === "mpesa";
  // The server's own idea of its address when it has one; otherwise the https address this page was opened on.
  const webhookUrl = gateway.webhookUrl ?? (sunpay && window.location.protocol === "https:" ? `${window.location.origin}/api/billing/webhooks/sunpay` : null);
  const secretField = (c: (typeof spec.secrets)[number]) => {
    const saved = gateway.savedCredentials.includes(c.key);
    return <Field key={c.key} label={c.label} hint={saved ? "Saved. Leave blank to keep it." : c.hint} required={!saved && !c.optional}>
      <TextInput type="password" autoComplete="off" value={secrets[c.key] ?? ""} onChange={(e) => setSecrets({ ...secrets, [c.key]: e.target.value })} placeholder={saved ? "••••••••" : ""} />
    </Field>;
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={`${gateway.name} settings`} busy={save.isPending} testid={`dialog-gateway-${gateway.provider}`}>
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {gateway.provider !== "mpesa" && <Field label="Environment"><NativeSelect data-testid="select-gateway-env" value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "live")}><option value="sandbox">Sandbox / test</option><option value="live">Live</option></NativeSelect></Field>}
          <label className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${gateway.provider !== "mpesa" ? "sm:mt-6" : "sm:col-span-2"}`}>
            <span className="text-sm font-medium">Offer to schools</span>
            <Switch data-testid="switch-gateway-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </label>
          {spec.config.map((c) => (
            <Field key={c.key} label={c.label} hint={c.hint} required={c.required}><TextInput value={config[c.key] ?? ""} onChange={(e) => setConfig({ ...config, [c.key]: e.target.value })} /></Field>
          ))}
          {spec.secrets.filter((c) => !(sunpay && c.key === "webhookSecret")).map(secretField)}
        </div>
        {sunpay ? (
          // SunPay only issues the signing secret after it has the address, so the two are laid out in that order.
          <ol className="space-y-3 rounded-md bg-muted/50 px-3 py-3 text-sm" data-testid="sunpay-webhook-steps">
            <li>
              <div className="font-semibold">1. Give SunPay this address</div>
              <p className="mt-0.5 text-xs text-muted-foreground">In SunPay, open Settings → Webhooks, add a webhook and paste it in.</p>
              {webhookUrl
                ? <button type="button" data-testid="button-copy-webhook" onClick={() => copy(webhookUrl, "Webhook URL copied")} className="mt-1.5 flex items-center gap-1.5 break-all rounded-md border border-border bg-card px-2.5 py-2 text-left font-mono text-xs text-primary"><Copy className="h-3.5 w-3.5 shrink-0" />{webhookUrl}</button>
                : <p className="mt-1.5 rounded-md border border-amber-300/60 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900">This server doesn't know its public address yet, so there is no address to give SunPay. Set <code>APP_BASE_URL</code> to your https address in the server's settings file and restart; the address then appears here. You can save the API key now and come back for this step.</p>}
              {webhookUrl && !gateway.webhookUrl && <p className="mt-1 text-xs text-muted-foreground">Taken from the address you opened this page on. Set <code>APP_BASE_URL</code> on the server to make it permanent.</p>}
            </li>
            <li>
              <div className="font-semibold">2. Paste the secret SunPay gives back</div>
              <p className="mb-1.5 mt-0.5 text-xs text-muted-foreground">After you save the webhook there, SunPay shows a signing secret. Optional: without it, each payment is still confirmed by asking SunPay directly.</p>
              {spec.secrets.filter((c) => c.key === "webhookSecret").map(secretField)}
            </li>
          </ol>
        ) : (
          <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs">
            <div className="font-semibold">Webhook URL</div>
            {gateway.webhookUrl
              ? <button type="button" onClick={() => copy(gateway.webhookUrl!, "Webhook URL copied")} className="mt-1 flex items-center gap-1.5 break-all text-left font-mono text-primary"><Copy className="h-3.5 w-3.5 shrink-0" />{gateway.webhookUrl}</button>
              : <p className="mt-1 text-muted-foreground">Set APP_BASE_URL to your public HTTPS address to get a webhook URL. Until then, payments are confirmed when the school returns from the payment page.</p>}
          </div>
        )}
        <FormError msg={err} />
        <FormActions>
          <Btn data-testid="button-save-gateway" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </FormActions>
      </div>
    </FormDialog>
  );
}

// ---------- Prepaid licence keys ----------
function GeneratedKeys({ keys, onClose }: { keys: LicenceKeyCode[]; onClose: () => void }) {
  const copy = useCopy();
  const all = keys.map((k) => k.code).join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`code\n${all}\n`], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `rejista-licence-keys-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={`${keys.length} key${keys.length === 1 ? "" : "s"} ready`} description="Copy or download them now. You can reveal a single key later from the list." testid="dialog-generated-keys">
      <div className="space-y-4 p-5">
        <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
          {keys.map((k) => <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-sm">{k.code}<button type="button" aria-label="Copy key" onClick={() => copy(k.code, "Key copied")} className="text-muted-foreground hover:text-foreground"><Copy className="h-4 w-4" /></button></li>)}
        </ul>
        <FormActions>
          <Btn data-testid="button-copy-all-keys" onClick={() => copy(all, "All keys copied")}><Copy className="h-4 w-4" />Copy all</Btn>
          <Btn variant="outline" onClick={download}><Download className="h-4 w-4" />Download CSV</Btn>
          <Btn variant="ghost" onClick={onClose}>Done</Btn>
        </FormActions>
      </div>
    </FormDialog>
  );
}

export function LicenceKeySettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const copy = useCopy();
  const q = useListLicenceKeys({ query: { queryKey: getListLicenceKeysQueryKey() } });
  const gen = useGenerateLicenceKeys();
  const reveal = useRevealLicenceKey();
  const revoke = useRevokeLicenceKey();
  const reqId = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ quantity: "5", durationDays: "365", price: "", maxLearners: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<LicenceKeyCode[] | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const submit = () => {
    setErr(null);
    const quantity = Number(f.quantity), durationDays = Number(f.durationDays), price = f.price.trim().replace(/,/g, "") || "0";
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) return setErr("Generate between 1 and 200 keys at a time.");
    if (!Number.isInteger(durationDays) || durationDays < 1) return setErr("Duration must be at least 1 day.");
    if (!PRICE_RE.test(price)) return setErr("Enter the price as a number, e.g. 40000.");
    if (!validLimit(f.maxLearners)) return setErr("Learner limit must be a whole number, or blank for unlimited.");
    gen.mutate({ data: { requestId: reqId.current, quantity, durationDays, price, maxLearners: intOrNull(f.maxLearners), note: f.note.trim() } }, {
      onSuccess: (b) => { reqId.current = crypto.randomUUID(); setOpen(false); setMade(b.keys); void qc.invalidateQueries({ queryKey: getListLicenceKeysQueryKey() }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const keys = q.data ?? [];
  const counts = { available: keys.filter((k) => k.status === "available").length, redeemed: keys.filter((k) => k.status === "redeemed").length };
  return (
    <div className="space-y-6">
      <Panel title="Prepaid licence keys" note="Sell keys directly or through agents. A school administrator enters the key under Subscription to add that time, after any time they already have."
        action={<Btn data-testid="button-new-keys" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" />Generate keys</Btn>}>
        {q.isLoading ? <SkeletonRows rows={4} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load keys.")} onRetry={() => q.refetch()} /> : !keys.length
          ? <Empty icon={<KeyRound className="h-5 w-5" />} title="No keys yet" body="Generate a batch, for example 10 one-year keys, to sell offline." />
          : <>
            <div className="flex gap-4 border-b border-border/60 px-5 py-3 text-xs text-muted-foreground"><span><b className="text-foreground">{counts.available}</b> available</span><span><b className="text-foreground">{counts.redeemed}</b> redeemed</span></div>
            <ul className="divide-y divide-border/60">{keys.map((k) => (
              <li key={k.id} data-testid={`row-key-${k.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold">{revealed[k.id] ?? k.maskedCode}</span><Pill tone={k.status === "available" ? "active" : k.status === "redeemed" ? "pending" : "inactive"}>{k.status}</Pill></div>
                  <div className="text-xs text-muted-foreground">{k.durationDays} days · {kes(k.price)} · {k.maxLearners ? `up to ${k.maxLearners.toLocaleString()} learners` : "unlimited learners"}{k.note ? ` · ${k.note}` : ""}{k.redeemedSchoolName ? ` · used by ${k.redeemedSchoolName} ${fmtDateTime(k.redeemedAt!)}` : ""}</div>
                </div>
                {revealed[k.id]
                  ? <Btn variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => copy(revealed[k.id], "Key copied")}><Copy className="h-3.5 w-3.5" />Copy</Btn>
                  : <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid={`button-reveal-${k.id}`} disabled={reveal.isPending} onClick={() => reveal.mutate({ keyId: k.id }, { onSuccess: (r) => setRevealed((m) => ({ ...m, [k.id]: r.code })) })}><Eye className="h-3.5 w-3.5" />Show</Btn>}
                {k.status === "available" && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-revoke-${k.id}`} disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ keyId: k.id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListLicenceKeysQueryKey() }); toast({ title: "Key revoked" }); }, onError: (x) => toast({ title: "Not revoked", description: errMsg(x) }) })}><X className="h-3.5 w-3.5" />Revoke</Btn>}
              </li>
            ))}</ul>
          </>}
      </Panel>
      <FormDialog open={open} onOpenChange={setOpen} phonePage title="Generate licence keys" busy={gen.isPending} testid="dialog-generate-keys">
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many" required><TextInput data-testid="input-key-quantity" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            <Field label="Duration (days)" required hint="365 = one year"><TextInput data-testid="input-key-duration" inputMode="numeric" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
            <Field label="Price per key (KES)" hint="For your records"><TextInput data-testid="input-key-price" inputMode="decimal" className="font-mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="40000" /></Field>
            <Field label="Learner limit" hint="Blank means unlimited"><TextInput inputMode="numeric" value={f.maxLearners} onChange={(e) => setF({ ...f, maxLearners: e.target.value })} /></Field>
            <Field label="Note" hint="e.g. agent or batch name" className="sm:col-span-2"><TextInput maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          </div>
          <FormError msg={err} />
          <FormActions>
            <Btn data-testid="button-generate-keys" disabled={gen.isPending} onClick={submit}>{gen.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Generate</Btn>
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          </FormActions>
        </div>
      </FormDialog>
      {made && <GeneratedKeys keys={made} onClose={() => setMade(null)} />}
    </div>
  );
}

// ---------- Standalone install licences ----------
export function StandaloneLicenceSettings() {
  const qc = useQueryClient();
  const copy = useCopy();
  const q = useListStandaloneLicences({ query: { queryKey: getListStandaloneLicencesQueryKey(), retry: false } });
  const issue = useIssueStandaloneLicence();
  const reqId = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ schoolName: "", expiresOn: "", maxLearners: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<StandaloneLicence | null>(null);
  const submit = () => {
    setErr(null);
    if (f.schoolName.trim().length < 2) return setErr("Enter the school's name.");
    if (!validLimit(f.maxLearners)) return setErr("Learner limit must be a whole number, or blank for unlimited.");
    const expiresAt = f.expiresOn ? new Date(`${f.expiresOn}T23:59:59+03:00`).toISOString() : null;
    issue.mutate({ data: { requestId: reqId.current, schoolName: f.schoolName.trim(), expiresAt, maxLearners: intOrNull(f.maxLearners), note: f.note.trim() } }, {
      onSuccess: (l) => { reqId.current = crypto.randomUUID(); setOpen(false); setMade(l); setF({ schoolName: "", expiresOn: "", maxLearners: "", note: "" }); void qc.invalidateQueries({ queryKey: getListStandaloneLicencesQueryKey() }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <div className="space-y-6">
      <Panel title="Standalone installs" note="Licences for schools running Rejista on their own server. The install checks the signature offline, so it can't be edited or forged."
        action={<Btn data-testid="button-new-standalone" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" />Issue licence</Btn>}>
        {q.isLoading ? <SkeletonRows rows={3} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load standalone licences.")} onRetry={() => q.refetch()} /> : !q.data?.length
          ? <Empty icon={<ServerCog className="h-5 w-5" />} title="No standalone licences" body="Issue one when you install Rejista on a school's own server." />
          : <ul className="divide-y divide-border/60">{q.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{l.schoolName}</div>
                <div className="text-xs text-muted-foreground">{l.expiresAt ? `Expires ${fmtDateTime(l.expiresAt)}` : "No expiry"} · {l.maxLearners ? `up to ${l.maxLearners.toLocaleString()} learners` : "unlimited learners"} · issued {fmtDateTime(l.issuedAt)}{l.note ? ` · ${l.note}` : ""}</div>
              </div>
              <Btn variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => copy(l.licence, "Licence copied")}><Copy className="h-3.5 w-3.5" />Copy licence</Btn>
            </li>
          ))}</ul>}
      </Panel>
      <FormDialog open={open} onOpenChange={setOpen} phonePage title="Issue a standalone licence" busy={issue.isPending} testid="dialog-issue-standalone">
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-standalone-school" value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} /></Field>
            <Field label="Expires on" hint="Blank means it never expires"><TextInput data-testid="input-standalone-expiry" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
            <Field label="Learner limit" hint="Blank means unlimited"><TextInput inputMode="numeric" value={f.maxLearners} onChange={(e) => setF({ ...f, maxLearners: e.target.value })} /></Field>
            <Field label="Note" className="sm:col-span-2"><TextInput maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. invoice number or server" /></Field>
          </div>
          <FormError msg={err} />
          <FormActions>
            <Btn data-testid="button-issue-standalone" disabled={issue.isPending} onClick={submit}>{issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Issue licence</Btn>
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          </FormActions>
        </div>
      </FormDialog>
      {made && (
        <FormDialog open onOpenChange={(o) => !o && setMade(null)} title={`Licence for ${made.schoolName}`} description="Paste this into the school's install under Settings → Licence." testid="dialog-standalone-made">
          <div className="space-y-4 p-5">
            <textarea readOnly rows={5} value={made.licence} className="w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <FormActions>
              <Btn onClick={() => copy(made.licence, "Licence copied")}><Check className="h-4 w-4" />Copy licence</Btn>
              <Btn variant="ghost" onClick={() => setMade(null)}>Done</Btn>
            </FormActions>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
