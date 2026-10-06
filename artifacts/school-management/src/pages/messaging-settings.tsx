import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlatformMessaging, useSavePlatformMessaging, getGetPlatformMessagingQueryKey,
  useGetSchoolMessaging, useSaveSchoolMessaging, getGetSchoolMessagingQueryKey,
  type MessagingChannel, type MessagingProvider, type MessagingChannelState, type MessagingAccountInput,
} from "@workspace/api-client-react";
import { AlertTriangle, Loader2, MessageSquareText, Plug, Settings2, Undo2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { WhatsappSetup } from "@/components/whatsapp-setup";
import { errMsg, useReadOnly } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

type PSpec = { label: string; secrets: { key: string; label: string }[]; sender: "required" | "optional" | null; connection: boolean; sandbox: boolean; note: string };
const PROVIDERS: Record<MessagingProvider, PSpec> = {
  blessedtexts: { label: "Blessed Text", secrets: [{ key: "apiKey", label: "API key" }], sender: "required", connection: false, sandbox: false,
    note: "Awaiting API documentation. Blessed Text's official docs are login-protected and the response contract is not verified. You can save credentials, but the account must stay disabled — sending cannot be enabled until the contract is verified." },
  onfon: { label: "Onfon", secrets: [{ key: "apiKey", label: "API key" }, { key: "clientId", label: "Client ID" }, { key: "accessKey", label: "Access key" }], sender: "required", connection: false, sandbox: false,
    note: "Documented send is supported, but live delivery is unverified until provider acceptance testing." },
  africastalking: { label: "Africa's Talking", secrets: [{ key: "username", label: "Username" }, { key: "apiKey", label: "API key" }], sender: "optional", connection: false, sandbox: true,
    note: "Supports live and sandbox. Saving does not verify connectivity." },
  leadsintel: { label: "LeadsIntel", secrets: [{ key: "platformKey", label: "Platform key" }, { key: "tenantId", label: "Tenant ID" }], sender: null, connection: true, sandbox: false,
    note: "WhatsApp only. Saving does not verify connectivity." },
};
const CHANNEL_PROVIDERS: Record<MessagingChannel, MessagingProvider[]> = { sms: ["blessedtexts", "onfon", "africastalking"], whatsapp: ["leadsintel"] }; // whatsapp edits now go through WhatsappSetup
const CHANNEL_LABEL: Record<MessagingChannel, string> = { sms: "SMS", whatsapp: "WhatsApp" };
const SOURCE_LABEL: Record<string, string> = { platform: "Platform default", school: "School override", legacy: "Legacy integration", none: "No route" };
const STATUS: Record<string, { tone: string; label: string }> = {
  unverified: { tone: "duplicate", label: "enabled · unverified" }, disabled: { tone: "inactive", label: "disabled" },
  contract_required: { tone: "error", label: "contract required" }, not_configured: { tone: "left", label: "not configured" },
};
const providerLabel = (p: string | null | undefined) => (p && p in PROVIDERS ? PROVIDERS[p as MessagingProvider].label : p ?? "None");

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetPlatformMessagingQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSchoolMessagingQueryKey() });
    qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey).toLowerCase().includes("audit") });
  };
}

function EditForm({ platform, state, onDone }: { platform: boolean; state: MessagingChannelState; onDone: () => void }) {
  const ch = state.channel;
  const options = CHANNEL_PROVIDERS[ch];
  // Inherited platform state is not this school's account: never offer retention.
  const ownAccount = platform || state.mode === "override";
  const initialProvider = (ownAccount && state.provider && options.includes(state.provider as MessagingProvider) ? state.provider : options[0]) as MessagingProvider;
  const [provider, setProvider] = useState<MessagingProvider>(initialProvider);
  const spec = PROVIDERS[provider];
  const [enabled, setEnabled] = useState(ownAccount ? state.enabled && provider !== "blessedtexts" : false);
  const [env, setEnv] = useState<"live" | "sandbox">(ownAccount && state.environment === "sandbox" ? "sandbox" : "live");
  const [senderId, setSenderId] = useState(ownAccount ? state.senderId ?? "" : "");
  const [connectionId, setConnectionId] = useState(ownAccount ? state.connectionId ?? "" : "");
  const [sec, setSec] = useState<Record<string, string>>({});
  const [replace, setReplace] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canRetain = ownAccount && state.canRetainCredentials && provider === state.provider;
  const needSecrets = !canRetain || replace;
  const blessed = provider === "blessedtexts";
  const savePlatform = useSavePlatformMessaging();
  const saveSchool = useSaveSchoolMessaging();
  const pending = savePlatform.isPending || saveSchool.isPending;
  const invalidate = useInvalidate();
  const { toast } = useToast();

  const changeProvider = (p: MessagingProvider) => { setProvider(p); setSec({}); setReplace(false); if (p === "blessedtexts") setEnabled(false); if (!PROVIDERS[p].sandbox) setEnv("live"); };

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (blessed && enabled) return setErr("Blessed Text cannot be enabled until its API contract is verified.");
    if (spec.sender === "required" && !senderId.trim()) return setErr("Enter the sender ID.");
    if (spec.connection && !connectionId.trim()) return setErr("Enter the WhatsApp connection ID.");
    const creds = Object.fromEntries(spec.secrets.map((s) => [s.key, (sec[s.key] ?? "").trim()]));
    if (needSecrets) {
      const missing = spec.secrets.filter((s) => !creds[s.key]);
      if (missing.length) return setErr(`Enter ${missing.map((m) => m.label.toLowerCase()).join(", ")}. Saved secrets are never shown, so the full set must be entered.`);
    }
    const data: MessagingAccountInput = {
      mode: "override", provider, enabled, environment: spec.sandbox ? env : "live",
      ...(spec.sender ? { senderId: senderId.trim() } : {}),
      ...(spec.connection ? { connectionId: connectionId.trim() } : {}),
      ...(needSecrets ? { credentials: creds } : {}),
    };
    const opts = {
      onSuccess: () => { setSec({}); invalidate(); toast({ title: `${CHANNEL_LABEL[ch]} ${platform ? "default" : "override"} saved`, description: "Credentials were encrypted on the server. Saving does not verify live connectivity." }); onDone(); },
      onError: (x: unknown) => setErr(errMsg(x)),
    };
    if (platform) savePlatform.mutate({ channel: ch, data }, opts); else saveSchool.mutate({ channel: ch, data }, opts);
  };

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid={`form-messaging-${ch}`}>
      {!blessed && <p className="text-xs text-muted-foreground">{spec.note}</p>}
      {platform && <p className="text-xs text-amber-800">Changing this default immediately reroutes every school that inherits it, and all their messages are billed to this platform account.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider" required>
          <NativeSelect data-testid="select-provider" value={provider} onChange={(e) => changeProvider(e.target.value as MessagingProvider)}>
            {options.map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Environment" required>
          <NativeSelect data-testid="select-environment" value={spec.sandbox ? env : "live"} disabled={!spec.sandbox} onChange={(e) => setEnv(e.target.value as "live" | "sandbox")}>
            <option value="live">Live</option>{spec.sandbox && <option value="sandbox">Sandbox</option>}
          </NativeSelect>
        </Field>
        {spec.sender && <Field label="Sender ID" required={spec.sender === "required"} hint={spec.sender === "optional" ? "Optional, if approved" : undefined}>
          <TextInput data-testid="input-sender-id" className="font-mono" maxLength={100} value={senderId} onChange={(e) => setSenderId(e.target.value)} />
        </Field>}
        {spec.connection && <Field label="WhatsApp connection ID" required>
          <TextInput data-testid="input-connection-id" className="font-mono" maxLength={200} value={connectionId} onChange={(e) => setConnectionId(e.target.value)} />
        </Field>}
        {canRetain && <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" data-testid="toggle-replace-credentials" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={replace} onChange={(e) => { setReplace(e.target.checked); setSec({}); }} />
          Replace credentials <span className="text-xs text-muted-foreground">— leave off to keep the saved {spec.label} credentials</span>
        </label>}
        {needSecrets && spec.secrets.map((s) => (
          <Field key={s.key} label={s.label} required>
            <TextInput type="password" autoComplete="new-password" spellCheck={false} data-testid={`input-secret-${s.key}`} className="font-mono" maxLength={8000}
              value={sec[s.key] ?? ""} onChange={(e) => setSec({ ...sec, [s.key]: e.target.value })} />
          </Field>
        ))}
        <label className={`flex items-center gap-2 text-sm sm:col-span-2 ${blessed ? "opacity-50" : ""}`}>
          <input type="checkbox" data-testid="toggle-enabled" disabled={blessed} className="h-4 w-4 accent-[hsl(var(--primary))]" checked={enabled && !blessed} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled {blessed && <span className="text-xs">— unavailable until the contract is verified</span>}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Secrets are write-only and never displayed. New accounts report messages as accepted or submitted only, not delivered, until a delivery gateway is configured. A disabled override does not fall back to another account for the same channel.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" data-testid="button-save-messaging" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Save encrypted</Btn>
        <Btn type="button" variant="ghost" onClick={() => { setSec({}); onDone(); }}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function InheritConfirm({ state, onDone }: { state: MessagingChannelState; onDone: () => void }) {
  const save = useSaveSchoolMessaging();
  const invalidate = useInvalidate();
  const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm">This school's {CHANNEL_LABEL[state.channel]} messages will be sent through the shared platform account, which bills the platform. Any school override is cleared, and legacy integration accounts are explicitly ignored for this channel.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-inherit" disabled={save.isPending} onClick={() => save.mutate({ channel: state.channel, data: { mode: "inherit", enabled: true } }, {
          onSuccess: () => { invalidate(); toast({ title: "Using platform default", description: `${CHANNEL_LABEL[state.channel]} now follows the platform default.` }); onDone(); },
          onError: (x) => setErr(errMsg(x)),
        })}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Use platform default</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </div>
  );
}

function ChannelRow({ platform, s, ro }: { platform: boolean; s: MessagingChannelState; ro: boolean }) {
  const [dlg, setDlg] = useState<null | "edit" | "inherit">(null);
  const st = STATUS[s.status] ?? { tone: "left", label: s.status.replace(/_/g, " ") };
  const isInheritingPlatform = !platform && s.mode === "inherit" && s.source === "platform";
  return (
    <li data-testid={`row-messaging-${s.channel}`} className="flex flex-wrap items-start gap-3 p-5">
      <MessageSquareText className="mt-1 h-4 w-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{CHANNEL_LABEL[s.channel]}</span>
          <Pill tone={st.tone}>{st.label}</Pill>
          {!platform && <Pill tone={s.source === "school" ? "current" : "left"}>{SOURCE_LABEL[s.source] ?? s.source}</Pill>}
          {s.configured && <Pill tone="current">{s.environment}</Pill>}
        </div>
        <p className="mt-1 text-sm" data-testid={`text-effective-${s.channel}`}>
          <span className="text-muted-foreground">Effective provider:</span> <b>{providerLabel(s.provider)}</b>
          {s.senderId && <span className="font-mono text-xs text-muted-foreground"> · sender {s.senderId}</span>}
          {s.connectionId && <span className="font-mono text-xs text-muted-foreground"> · conn {s.connectionId}</span>}
        </p>
        {!platform && <p className="text-xs text-muted-foreground">{s.source === "school" ? "Billed to this school's own account." : s.source === "legacy" ? "Routed via a legacy integration account. Configure an override or use the platform default to migrate." : s.source === "platform" ? "Billed to the shared platform account." : "No account will send on this channel."}</p>}
        {s.provider === "blessedtexts" && <p className="mt-1 text-xs font-medium text-red-800">Blessed Text: awaiting API documentation — cannot send until the contract is verified.</p>}
        {s.reason && <p className="mt-1 text-xs text-amber-800">{s.reason}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!platform && !isInheritingPlatform && <Btn variant="ghost" disabled={ro} data-testid={`button-inherit-${s.channel}`} onClick={() => setDlg("inherit")}><Undo2 className="h-4 w-4" />Use platform default</Btn>}
        <Btn variant="outline" disabled={ro} data-testid={`button-configure-${s.channel}`} onClick={() => setDlg("edit")}><Settings2 className="h-4 w-4" />{platform ? (s.configured ? "Edit default" : "Configure default") : s.mode === "override" ? "Edit override" : "Configure override"}</Btn>
      </div>
      <FormDialog open={dlg === "edit"} onOpenChange={(o) => !o && setDlg(null)} size="lg"
        title={`${platform ? "Platform default" : "School override"} · ${CHANNEL_LABEL[s.channel]}`}
        description={platform ? "Used by every school that inherits this channel." : "This school's own provider account, billed to the school."}>
        <EditForm platform={platform} state={s} onDone={() => setDlg(null)} />
      </FormDialog>
      {!platform && <FormDialog open={dlg === "inherit"} onOpenChange={(o) => !o && setDlg(null)} size="sm" title="Use platform default?">
        <InheritConfirm state={s} onDone={() => setDlg(null)} />
      </FormDialog>}
    </li>
  );
}

export default function MessagingSettingsPage({ platform = false, embedded = false }: { platform?: boolean; embedded?: boolean }) {
  const poll = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;
  const pq = useGetPlatformMessaging({ query: { queryKey: getGetPlatformMessagingQueryKey(), enabled: platform, ...poll } });
  const sq = useGetSchoolMessaging({ query: { queryKey: getGetSchoolMessagingQueryKey(), enabled: !platform, ...poll } });
  const q = platform ? pq : sq;
  const ro = useReadOnly();
  const channels = q.data?.channels ?? [];
  return (
    <div className="space-y-6">
      {!embedded && <PageHeader eyebrow={platform ? "Platform" : "Communication"} title={platform ? "Messaging defaults" : "Messaging routing"}
        meta={platform ? "Default SMS and WhatsApp accounts for all schools that inherit." : "Choose the platform default or this school's own account for each channel."} />}
      {platform ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><b>Scope: all inheriting schools.</b> Edits apply immediately to every school on the platform default, and their receipts, reminders, OTPs, absence alerts and WhatsApp fallbacks are billed to this account. Schools with their own override are unaffected.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <Plug className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">Receipts, reminders, OTPs, absence alerts and WhatsApp fallback all use this routing automatically. The platform default is billed to the platform; an override is billed to your account. Disabled or broken overrides do not use another account for the same channel. WhatsApp-to-SMS fallback follows the school's existing settings.</p>
          <Link href="/integrations" data-testid="link-legacy-integrations" className="text-xs font-semibold text-primary underline-offset-2 hover:underline">Legacy integrations</Link>
        </div>
      )}
      <p className="text-xs text-muted-foreground">No live provider has been verified. "Unverified" means saved, not proven to work. There is no test send.</p>
      <Panel>
        {q.isLoading ? <SkeletonRows rows={2} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} />
          : channels.length === 0 ? <Empty icon={<MessageSquareText className="h-5 w-5" />} title="No channels reported" body="The server returned no messaging channels. Retry shortly." />
          : <ul className="divide-y divide-border/70">{channels.map((s) => s.channel === "whatsapp" ? <WhatsappSetup key="whatsapp" platform={platform} compact /> : <ChannelRow key={s.channel} platform={platform} s={s} ro={ro} />)}</ul>}
      </Panel>
    </div>
  );
}

export function PlatformMessagingPage({ embedded = false }: { embedded?: boolean } = {}) { return <MessagingSettingsPage platform embedded={embedded} />; }
