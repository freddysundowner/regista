import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListIntegrationStatus, useConfigureIntegration, useRegisterDarajaCallbacks, getListIntegrationStatusQueryKey,
  type IntegrationInputProvider, type IntegrationInputEnvironment, type IntegrationStatus,
} from "@workspace/api-client-react";
import { KeyRound, Loader2, PlugZap, RadioTower, ShieldAlert } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

type Spec = { label: string; purpose: string; secrets: { key: string; label: string; hint?: string; min?: number }[]; pub?: { key: "shortcode" | "accountNumber" | "connectionId"; label: string } };
const SPECS: Record<IntegrationInputProvider, Spec> = {
  daraja: { label: "M-Pesa Daraja", purpose: "Paybill C2B confirmations and STK prompts.", pub: { key: "shortcode", label: "Paybill / till shortcode" },
    secrets: [{ key: "consumerKey", label: "Consumer key" }, { key: "consumerSecret", label: "Consumer secret" }, { key: "passkey", label: "Lipa na M-Pesa passkey" }, { key: "callbackToken", label: "Callback token", hint: "At least 32 characters; part of the callback URL", min: 32 }] },
  leadsintel: { label: "LeadsIntel WhatsApp (legacy)", purpose: "WhatsApp receipts, reminders and the parent bot channel.", pub: { key: "connectionId", label: "WhatsApp connection ID" },
    secrets: [{ key: "platformKey", label: "Platform key" }, { key: "tenantId", label: "Tenant ID" }, { key: "phoneNumberId", label: "Phone number ID", hint: "Optional; needed for inbound WhatsApp events" }, { key: "webhookSecret", label: "Webhook secret", hint: "Optional; needed for inbound events (HMAC)" }, { key: "callbackToken", label: "Callback token", hint: "Optional; at least 32 characters, used for inbound events and the delivery gateway URL", min: 32 }, { key: "deliveryGatewaySecret", label: "Delivery gateway HMAC secret", hint: "Optional; at least 32 characters. Separate from the native provider webhook secret.", min: 32 }] },
  africastalking: { label: "Africa's Talking SMS (legacy)", purpose: "SMS fallback when WhatsApp is unavailable.",
    secrets: [{ key: "username", label: "Username" }, { key: "apiKey", label: "API key" }, { key: "senderId", label: "Sender ID", hint: "Optional, if approved" }, { key: "callbackToken", label: "Delivery callback token", hint: "Optional; at least 32 characters, used in the delivery gateway URL", min: 32 }, { key: "deliveryGatewaySecret", label: "Delivery gateway HMAC secret", hint: "Optional; at least 32 characters. Shared only with your approved delivery gateway.", min: 32 }] },
  bot: { label: "Parent bot", purpose: "Server-to-server key the bot uses to query balances.",
    secrets: [{ key: "apiKey", label: "Bot API key", hint: "At least 32 characters", min: 32 }, { key: "hmacSecret", label: "HMAC secret", hint: "At least 32 characters", min: 32 }] },
  bank: { label: "KCB Buni", purpose: "Signed account and till payment notifications. Does not initiate payments or pull statements.", pub: { key: "accountNumber", label: "KCB collection account number (optional for till-only)" },
    secrets: [{ key: "kcbPublicKey", label: "KCB RSA public key (PEM)", hint: "Obtain directly from KCB; never enter a private key." }, { key: "callbackToken", label: "Callback token", hint: "At least 32 URL-safe characters", min: 32 }, { key: "tillBusinessKey", label: "KCB receiving business key", hint: "Optional for account-only. For till notifications, use the primaryData business key confirmed by KCB, not the student's reference." }] },
};
const STATUS_TONE: Record<string, string> = { unverified: "duplicate", not_configured: "left", encryption_key_missing: "error", contract_required: "error", disabled: "inactive" };

function randomToken() { const b = new Uint8Array(32); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }

function ConfigForm({ s, onDone }: { s: IntegrationStatus; onDone: () => void }) {
  const provider = s.provider as IntegrationInputProvider;
  const spec = SPECS[provider];
  const save = useConfigureIntegration();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [env, setEnv] = useState<IntegrationInputEnvironment>((s.environment as IntegrationInputEnvironment) ?? "sandbox");
  const [enabled, setEnabled] = useState(s.enabled);
  const [pub, setPub] = useState("");
  // Secrets live only in component memory and are dropped after submit or cancel.
  const [sec, setSec] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const creds = Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const missing = spec.secrets.filter((x) => !x.hint?.startsWith("Optional") && !creds[x.key]);
    if (missing.length) return setErr(`Enter ${missing.map((m) => m.label.toLowerCase()).join(", ")}. Saved secrets are never shown, so all must be re-entered to change them.`);
    const short = spec.secrets.find((x) => x.min && (creds[x.key] || !x.hint?.startsWith("Optional")) && (creds[x.key]?.length ?? 0) < x.min);
    if (short) return setErr(`${short.label} must be at least ${short.min} characters.`);
    if (creds.deliveryGatewaySecret && !creds.callbackToken) return setErr("Enter a callback token together with the delivery gateway HMAC secret.");
    if (provider === "bank" && !pub.trim() && !creds.tillBusinessKey) return setErr("Enter a KCB account number or receiving business key.");
    if (spec.pub && !pub.trim() && provider !== "bank") return setErr(`Enter the ${spec.pub.label.toLowerCase()}.`);
    save.mutate({ data: { provider, environment: env, enabled, credentials: creds, ...(spec.pub && pub.trim() ? { [spec.pub.key]: pub.trim() } : {}) } }, {
      onSuccess: () => { setSec({}); qc.invalidateQueries({ queryKey: getListIntegrationStatusQueryKey() }); toast({ title: `${spec.label} saved`, description: "Credentials were encrypted on the server. Connectivity is not verified by saving." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5">
      {provider === "bank" && <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>Ask KCB to register the applicable callback path below on your published app domain. Copy it before saving; saved tokens are never displayed. KCB must sign the exact JSON body using its RSA key. Saving does not activate your account at KCB.</p>
        <p className="break-all font-mono">/api/integrations/kcb/account-notification/{sec.callbackToken || "{callbackToken}"}</p>
        <p className="break-all font-mono">/api/integrations/kcb/till-notification/{sec.callbackToken || "{callbackToken}"}</p>
        <p>Only KES payments are accepted. Use the student admission number as the payment reference. Unknown references go to reconciliation. Optional pre-payment validation is not enabled.</p>
      </div>}
      {(provider === "leadsintel" || provider === "africastalking") && <p data-testid="text-delivery-gateway-contract" className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">Delivery confirmation uses your school-operated gateway at <code>/api/integrations/message-delivery/events/{"{callbackToken}"}</code>. This is not a native provider webhook URL. Configure a gateway that verifies the provider's approved delivery contract, then signs our normalized delivery events with the separate HMAC secret. Saving credentials does not install or verify a gateway. Leave these optional credentials blank if no gateway is available; submissions will not be claimed as delivered. Re-enter gateway credentials when replacing existing secrets to retain delivery confirmation.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Environment" required><NativeSelect value={env} onChange={(e) => setEnv(e.target.value as IntegrationInputEnvironment)}><option value="sandbox">Sandbox</option><option value="production">Production</option></NativeSelect></Field>
        {spec.pub && <Field label={spec.pub.label} required={provider !== "bank"}><TextInput className="font-mono" value={pub} onChange={(e) => setPub(e.target.value)} /></Field>}
        {spec.secrets.map((x) => (
          <Field key={x.key} label={x.label} hint={x.hint} required={!x.hint?.startsWith("Optional")}>
            <div className="flex gap-1">
              {x.key === "kcbPublicKey" ? <textarea aria-label={x.label} rows={6} autoComplete="off" spellCheck={false} data-testid={`input-secret-${x.key}`} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" value={sec[x.key] ?? ""} onChange={(e) => setSec({ ...sec, [x.key]: e.target.value })} /> : <TextInput type="password" autoComplete="new-password" spellCheck={false} data-testid={`input-secret-${x.key}`} className="font-mono" value={sec[x.key] ?? ""} onChange={(e) => setSec({ ...sec, [x.key]: e.target.value })} />}
              {x.min && <Btn type="button" variant="ghost" className="h-9 px-2 text-xs" onClick={() => setSec({ ...sec, [x.key]: randomToken() })}>Generate</Btn>}
            </div>
          </Field>
        ))}
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save encrypted</Btn><Btn type="button" variant="ghost" onClick={() => { setSec({}); onDone(); }}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Integrations() {
  const q = useListIntegrationStatus({ query: { queryKey: getListIntegrationStatusQueryKey() } });
  const reg = useRegisterDarajaCallbacks();
  const { toast } = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Connections" title="Integrations" meta="Credentials are write-only: they are encrypted on the server and never displayed, cached or returned." />
      <div data-testid="banner-messaging-routing" className="flex flex-wrap items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <RadioTower className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1"><b>SMS and WhatsApp now use Messaging routing.</b> Choose the platform default or your own Blessed Text, Onfon, Africa's Talking or LeadsIntel account there. The LeadsIntel and Africa's Talking forms below are legacy accounts kept for existing setups; new messaging accounts belong on the Messaging routing page.</p>
        <Link href="/messaging" data-testid="link-messaging-routing" className="inline-flex h-9 items-center rounded-md border border-primary/40 px-3 text-xs font-semibold text-primary hover:bg-primary/10">Open Messaging routing</Link>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>No live provider has been verified. Daraja, WhatsApp, SMS and KCB still require provider acceptance testing. "Unverified" means saved, not proven to work.</p>
      </div>
      <Panel>
        {q.isLoading ? <SkeletonRows cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : (
          <ul className="divide-y divide-border/70">{(q.data ?? []).map((s) => {
            const spec = SPECS[s.provider as IntegrationInputProvider];
            return (
              <li key={s.provider} data-testid={`row-integration-${s.provider}`}>
                <div className="flex flex-wrap items-start gap-3 p-5">
                  <PlugZap className="mt-1 h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{spec?.label ?? s.provider}</span><Pill tone={STATUS_TONE[s.status] ?? "left"}>{s.status.replace(/_/g, " ")}</Pill>{s.configured && <Pill tone="current">{s.environment}</Pill>}{s.configured && !s.enabled && <Pill tone="inactive">disabled</Pill>}</div>
                    <p className="text-sm text-muted-foreground">{spec?.purpose}</p>
                    {(s.provider === "leadsintel" || s.provider === "africastalking") && <p className="mt-1 text-xs text-muted-foreground">Legacy account. Still honoured where Messaging routing reports a legacy source; configure new accounts in <Link href="/messaging" className="font-semibold text-primary hover:underline">Messaging routing</Link>.</p>}
                    {s.reason && <p className="mt-1 text-xs text-amber-800">{s.reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.provider === "daraja" && s.configured && <Btn variant="outline" disabled={reg.isPending} data-testid="button-register-callbacks" onClick={() => reg.mutate(undefined, {
                      onSuccess: (r) => toast({ title: "Callback registration sent", description: r.message ?? "Accepted by the server. This does not verify payments." }),
                      onError: (x) => toast({ title: "Registration failed", description: errMsg(x), variant: "destructive" }) })}>{reg.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Register callbacks</Btn>}
                    {<Btn variant="outline" data-testid={`button-configure-${s.provider}`} onClick={() => setEdit(s.provider)}><KeyRound className="h-4 w-4" />{s.configured ? "Replace credentials" : "Configure"}</Btn>}
                  </div>
                </div>
                {spec && <FormDialog open={edit === s.provider} onOpenChange={(o) => { if (!o) setEdit(null); }} size="lg" title={`${s.configured ? "Replace" : "Configure"} ${spec.label} credentials`} description="Write-only. Saved secrets are encrypted and never shown again, so every required secret must be entered.">
                  <ConfigForm s={s} onDone={() => setEdit(null)} />
                </FormDialog>}
              </li>
            );
          })}</ul>
        )}
      </Panel>
    </div>
  );
}
