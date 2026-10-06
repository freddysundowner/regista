import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useGetPlatformWhatsappSetup, getGetPlatformWhatsappSetupQueryKey,
  useGetSchoolWhatsappSetup, getGetSchoolWhatsappSetupQueryKey,
  useSaveLeadsIntelPlatformKey,
  useStartPlatformWhatsappSetup, useStartSchoolWhatsappSetup,
  useRecoverPlatformWhatsapp, useRecoverSchoolWhatsapp,
  useRefreshPlatformWhatsappSetup, useRefreshSchoolWhatsappSetup,
  useSaveSchoolMessaging, getGetSchoolMessagingQueryKey, getGetPlatformMessagingQueryKey,
  type WhatsappSetupState,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, PhoneCall, RadioTower, RefreshCw, Undo2, LifeBuoy } from "lucide-react";
import { Btn, Field, TextInput, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, useReadOnly } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const POLL_STATUSES = new Set(["pending", "awaiting_code", "connected"]);
const BLOCKED = new Set(["submitting", "recovering", "pending", "connected", "awaiting_code", "failed", "cancelled", "uncertain", "inactive", "disconnected"]);
const STEPS = [
  { id: "requested", label: "Requested" },
  { id: "pending", label: "Provisioning" },
  { id: "awaiting_code", label: "Verification" },
  { id: "connected", label: "Connected" },
  { id: "active", label: "Active" },
];
const STATUS_UI: Record<string, { tone: string; label: string }> = {
  not_started: { tone: "left", label: "not set up" },
  none: { tone: "left", label: "not set up" },
  pending: { tone: "duplicate", label: "provisioning" },
  awaiting_code: { tone: "duplicate", label: "awaiting code" },
  connected: { tone: "duplicate", label: "connected · confirming" },
  active: { tone: "current", label: "active" },
  failed: { tone: "error", label: "failed" },
  cancelled: { tone: "error", label: "cancelled" },
  uncertain: { tone: "error", label: "uncertain" },
};

type Dlg = null | "key" | "setup" | "recover" | "inherit";

function stepIndex(s: WhatsappSetupState) {
  if (s.connectionActive || s.status === "active") return 4;
  const i = STEPS.findIndex((x) => x.id === s.status);
  return i < 0 ? -1 : i;
}

function Progress({ s }: { s: WhatsappSetupState }) {
  const idx = stepIndex(s);
  const bad = ["failed", "cancelled", "uncertain"].includes(s.status);
  if (idx < 0 && !bad) return null;
  return (
    <ol aria-label="Setup progress" className="mt-3 grid grid-cols-5 gap-1.5" data-testid="whatsapp-progress">
      {STEPS.map((st, i) => {
        const done = !bad && i <= idx;
        const current = !bad && i === idx && idx < 4;
        return (
          <li key={st.id} className="min-w-0">
            <span className={cn("block h-1.5 rounded-full transition-colors", bad ? "bg-destructive/25" : done ? "bg-primary" : "bg-muted", current && "animate-pulse")} />
            <span className={cn("mt-1 block truncate text-[10px] font-medium uppercase tracking-wide", done ? "text-foreground" : "text-muted-foreground")}>{st.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Notice({ tone, icon, children, testId }: { tone: "warn" | "error" | "info" | "ok"; icon: ReactNode; children: ReactNode; testId?: string }) {
  const c = { warn: "border-amber-300/70 bg-amber-50/80 text-amber-900", error: "border-red-300/70 bg-red-50/80 text-red-900", info: "border-border bg-muted/40 text-foreground", ok: "border-emerald-300/70 bg-emerald-50/80 text-emerald-900" }[tone];
  return <div data-testid={testId} role={tone === "error" ? "alert" : "status"} className={cn("mt-3 flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", c)}><span className="mt-0.5 shrink-0">{icon}</span><div className="min-w-0">{children}</div></div>;
}

function useWhatsappInvalidate(platform: boolean) {
  const qc = useQueryClient();
  return (next?: WhatsappSetupState) => {
    const key = platform ? getGetPlatformWhatsappSetupQueryKey() : getGetSchoolWhatsappSetupQueryKey();
    if (next) qc.setQueryData(key, next); else qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: getGetPlatformMessagingQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSchoolMessagingQueryKey() });
  };
}

function KeyForm({ s, onDone }: { s: WhatsappSetupState; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = useSaveLeadsIntelPlatformKey();
  const apply = useWhatsappInvalidate(true);
  const { toast } = useToast();
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!key.trim()) return setErr("Enter the LeadsIntel platform API key.");
    save.mutate({ data: { apiKey: key.trim() } }, {
      onSuccess: (st) => { setKey(""); apply(st); toast({ title: "Platform key saved", description: "Encrypted on the server. It applies to every managed school number." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid="form-leadsintel-key">
      <p className="text-sm text-muted-foreground">One key, configured once, is used for every WhatsApp number the platform manages, including numbers set up by schools. It is write-only and never shown again.</p>
      {s.platformKeyConfigured && <p className="text-xs text-amber-800">A key is already saved. Submitting replaces it for all managed numbers immediately.</p>}
      <Field label="Platform API key" required>
        <TextInput type="password" autoComplete="new-password" spellCheck={false} className="font-mono" maxLength={8000} data-testid="input-leadsintel-key" value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" disabled={save.isPending} data-testid="button-save-leadsintel-key">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save encrypted</Btn>
        <Btn type="button" variant="ghost" onClick={() => { setKey(""); onDone(); }}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function SetupForm({ platform, s, onDone }: { platform: boolean; s: WhatsappSetupState; onDone: () => void }) {
  const [f, setF] = useState({ countryCode: "254", phoneNumber: "", businessName: s.businessName || "", displayName: s.displayName || "" });
  const [err, setErr] = useState<string | null>(null);
  const p = useStartPlatformWhatsappSetup();
  const sc = useStartSchoolWhatsappSetup();
  const pending = p.isPending || sc.isPending;
  const apply = useWhatsappInvalidate(platform);
  const { toast } = useToast();
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const data = { countryCode: f.countryCode.replace(/\D/g, ""), phoneNumber: f.phoneNumber.replace(/\D/g, ""), businessName: f.businessName.trim(), displayName: f.displayName.trim() };
    if (!/^[1-9]\d{0,3}$/.test(data.countryCode)) return setErr("Enter a valid country code without +.");
    if (!/^\d{4,14}$/.test(data.phoneNumber) || !/^[1-9]\d{6,14}$/.test(data.countryCode + data.phoneNumber)) return setErr("Enter a valid local number; the full international number must contain 7–15 digits.");
    if (!data.businessName || !data.displayName) return setErr("Business name and display name are required.");
    const opts = {
      onSuccess: (st: WhatsappSetupState) => { apply(st); toast({ title: ["pending", "awaiting_code", "connected"].includes(st.status) ? "Setup request recorded" : "Setup needs attention", description: st.error || "Check the connection status below. Setup is not active until LeadsIntel confirms it." }); onDone(); },
      onError: (x: unknown) => setErr(errMsg(x)),
    };
    if (platform) p.mutate({ data }, opts); else sc.mutate({ data }, opts);
  };
  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid="form-whatsapp-setup">
      <p className="text-sm text-muted-foreground">LeadsIntel registers this number with WhatsApp Business. If Meta sends a verification code, you will give it to LeadsIntel directly — this app never asks for codes or passwords.</p>
      {!platform && <p className="text-xs text-amber-800">A number set up here becomes this school's own route and overrides the platform default.</p>}
      {s.legacyConfigured && <p className="text-xs text-amber-800">A legacy WhatsApp account is configured. It stays saved; the new number takes over routing only once it is active.</p>}
      <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
        <Field label="Country code" required hint="Digits, e.g. 254">
          <TextInput inputMode="numeric" className="font-mono" maxLength={4} data-testid="input-country-code" value={f.countryCode} onChange={(e) => set("countryCode", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Phone number" required hint="Local digits, no leading 0 or +">
          <TextInput inputMode="numeric" className="font-mono" maxLength={15} data-testid="input-phone-number" value={f.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <Field label="Business name" required><TextInput maxLength={200} data-testid="input-business-name" value={f.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
          <Field label="Display name" required hint="Shown to parents in WhatsApp"><TextInput maxLength={200} data-testid="input-display-name" value={f.displayName} onChange={(e) => set("displayName", e.target.value)} /></Field>
        </div>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" disabled={pending} data-testid="button-start-whatsapp-setup">{pending && <Loader2 className="h-4 w-4 animate-spin" />}Request setup</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function RecoverForm({ platform, onDone }: { platform: boolean; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = useRecoverPlatformWhatsapp();
  const sc = useRecoverSchoolWhatsapp();
  const pending = p.isPending || sc.isPending;
  const apply = useWhatsappInvalidate(platform);
  const { toast } = useToast();
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const digits = phone.replace(/\D/g, "");
    if (!/^[1-9]\d{6,14}$/.test(digits)) return setErr("Enter the full international number including country code.");
    if (!confirm) return setErr("Confirm that inbound messages will be routed here.");
    const opts = {
      onSuccess: (st: WhatsappSetupState) => { apply(st); toast({ title: st.connectionActive ? "Connection verified active" : "Recovery needs attention", description: st.error || (st.connectionActive ? "The number is connected and ready to use." : "The connection has not been confirmed active. Check its status below.") }); onDone(); },
      onError: (x: unknown) => setErr(errMsg(x)),
    };
    const data = { phoneNumber: `+${digits}`, confirmReceiverChange: true as const };
    if (platform) p.mutate({ data }, opts); else sc.mutate({ data }, opts);
  };
  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid="form-whatsapp-recover">
      <p className="text-sm text-muted-foreground">Use this only for a number LeadsIntel already provisioned. It does not start a new registration.</p>
      <Field label="Full international number" required hint="e.g. 254712345678">
        <TextInput inputMode="numeric" className="font-mono" maxLength={16} data-testid="input-recover-phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))} />
      </Field>
      <div className="flex gap-2.5 rounded-md border border-red-300/70 bg-red-50/80 p-3 text-sm text-red-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p><b>Reconnecting changes the receiver.</b> Inbound WhatsApp messages and replies for this number will be routed here, away from wherever they go now.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" data-testid="toggle-confirm-receiver" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        I understand inbound messages for this number will be routed to {platform ? "the platform" : "this school"}.
      </label>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" variant="danger" disabled={pending || !confirm} data-testid="button-recover-whatsapp">{pending && <Loader2 className="h-4 w-4 animate-spin" />}Reconnect number</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function InheritForm({ onDone }: { onDone: () => void }) {
  const save = useSaveSchoolMessaging();
  const apply = useWhatsappInvalidate(false);
  const { toast } = useToast();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm">This school's WhatsApp messages will be sent through the shared platform number, billed to the platform. Any school route is cleared from routing; legacy accounts are ignored for WhatsApp.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-inherit-whatsapp" disabled={save.isPending} onClick={() => save.mutate({ channel: "whatsapp", data: { mode: "inherit", enabled: true } }, {
          onSuccess: () => { apply(); toast({ title: "Using platform WhatsApp", description: "WhatsApp now follows the platform default." }); onDone(); },
          onError: (x) => setErr(errMsg(x)),
        })}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Use platform default</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </div>
  );
}

export function WhatsappSetup({ platform, compact = false }: { platform: boolean; compact?: boolean }) {
  const [, navigate] = useLocation();
  const [dlg, setDlg] = useState<Dlg>(null);
  const ro = useReadOnly();
  const pq = useGetPlatformWhatsappSetup({ query: { queryKey: getGetPlatformWhatsappSetupQueryKey(), enabled: platform } });
  const sq = useGetSchoolWhatsappSetup({ query: { queryKey: getGetSchoolWhatsappSetupQueryKey(), enabled: !platform } });
  const q = platform ? pq : sq;
  const rp = useRefreshPlatformWhatsappSetup();
  const rs = useRefreshSchoolWhatsappSetup();
  const refresh = platform ? rp : rs;
  const apply = useWhatsappInvalidate(platform);
  const s = q.data;

  const refreshRef = useRef(refresh.mutate);
  refreshRef.current = refresh.mutate;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const busyRef = useRef(false);
  busyRef.current = refresh.isPending;
  const status = s?.status ?? "";
  const shouldPoll = !compact && !ro && POLL_STATUSES.has(status) && !s?.connectionActive;
  useEffect(() => {
    if (!shouldPoll) return;
    const t = setInterval(() => {
      if (busyRef.current) return;
      refreshRef.current(undefined, { onSuccess: (st) => applyRef.current(st) });
    }, 10_000);
    return () => clearInterval(t);
  }, [shouldPoll]);

  const doRefresh = () => refresh.mutate(undefined, { onSuccess: (st) => apply(st) });

  if (compact) return (
    <li data-testid="row-messaging-whatsapp" className="flex items-center gap-3 p-5">
      <RadioTower className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">WhatsApp</span>
          <span className="text-xs text-muted-foreground">via LeadsIntel</span>
          {s && <Pill tone={s.connectionActive ? "active" : "left"}>{s.connectionActive ? "Active" : s.status.replace(/_/g, " ")}</Pill>}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {q.isLoading ? "Loading…" : q.isError ? "Open configuration to check status." : s?.phoneNumber || "No managed number yet."}
        </p>
      </div>
      <Btn variant="outline" data-testid="button-configure-whatsapp" onClick={() => navigate(platform ? "/platform/settings/whatsapp" : "/settings/whatsapp")}>Configure</Btn>
    </li>
  );

  if (q.isLoading) return <li className="p-5"><div className="h-5 w-40 animate-pulse rounded bg-muted" /><div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-muted" /></li>;
  if (q.isError || !s) return (
    <li className="flex flex-wrap items-center gap-3 p-5" data-testid="row-messaging-whatsapp">
      <RadioTower className="h-4 w-4 text-primary" />
      <p role="alert" className="flex-1 text-sm text-red-800">WhatsApp setup status unavailable: {errMsg(q.error, "unknown error")}</p>
      <Btn variant="outline" onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" />Retry</Btn>
    </li>
  );

  const st = STATUS_UI[s.status] ?? { tone: "left", label: s.status.replace(/_/g, " ") };
  const blocked = BLOCKED.has(s.status);
  const terminal = ["failed", "cancelled", "uncertain"].includes(s.status);
  const keyMissing = !s.platformKeyConfigured;
  const canSetup = !ro && !keyMissing && !blocked && !(s.hasOwnConnection && s.connectionActive);
  const hasNumber = !!s.phoneNumber;

  return (
    <li data-testid="row-messaging-whatsapp" className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <RadioTower className="mt-1 h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">WhatsApp</span>
            <span className="text-xs text-muted-foreground">via LeadsIntel</span>
            <Pill tone={st.tone}>{st.label}</Pill>
            {!platform && <Pill tone={s.inherited ? "left" : s.hasOwnConnection ? "current" : "left"}>{s.inherited ? "Platform default" : s.hasOwnConnection ? "School number" : "No school number"}</Pill>}
            {platform && <Pill tone={s.platformKeyConfigured ? "current" : "error"}>{s.platformKeyConfigured ? "key configured" : "key missing"}</Pill>}
          </div>
          {hasNumber ? (
            <p className="mt-1 text-sm" data-testid="text-whatsapp-number">
              <span className="font-mono">+{s.phoneNumber.replace(/^\+/, "")}</span>
              {(s.displayName || s.businessName) && <span className="text-muted-foreground"> · {s.displayName || s.businessName}{s.displayName && s.businessName && s.businessName !== s.displayName ? ` (${s.businessName})` : ""}</span>}
            </p>
          ) : <p className="mt-1 text-sm text-muted-foreground">{s.inherited ? "Platform routing is selected. Sending requires an active platform number." : "No managed number yet."}</p>}
          {!platform && <p className="text-xs text-muted-foreground">{s.inherited ? "Existing routing stays in place until your school number is active." : s.hasOwnConnection ? "This school's own number uses the platform LeadsIntel integration." : "Set up a number or use the platform default."}</p>}
          {s.requestId && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">request {s.requestId}</p>}
          <Progress s={s} />

          {s.connectionActive && <Notice tone="ok" icon={<CheckCircle2 className="h-4 w-4" />}>Connection verified active by LeadsIntel.</Notice>}
          {s.status === "pending" && <Notice tone="info" icon={<Loader2 className="h-4 w-4 animate-spin" />}>LeadsIntel is provisioning this number.{shouldPoll ? " Checking every 10 seconds." : ""}</Notice>}
          {s.status === "awaiting_code" && <Notice tone="warn" icon={<PhoneCall className="h-4 w-4" />} testId="text-awaiting-code"><b>Verification code required.</b> Meta has sent a code to this number. Provide it to LeadsIntel directly — do not enter it here.</Notice>}
          {s.status === "connected" && !s.connectionActive && <Notice tone="info" icon={<Loader2 className="h-4 w-4 animate-spin" />}>Connected; waiting for LeadsIntel to confirm it is active.</Notice>}
          {terminal && <Notice tone="error" icon={<LifeBuoy className="h-4 w-4" />} testId="text-whatsapp-terminal">
            <b>Setup {s.status}.</b> {s.error || "LeadsIntel did not complete this request."} Contact LeadsIntel support to recover this number{s.requestId ? ` (quote request ${s.requestId})` : ""}. Do not resubmit setup — the number may still be reserved.
          </Notice>}
          {!terminal && s.error && <Notice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>{s.error}</Notice>}
          {refresh.isError && <Notice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>{errMsg(refresh.error, "Could not refresh status.")}</Notice>}
          {keyMissing && <Notice tone="warn" icon={<KeyRound className="h-4 w-4" />}>{platform ? "Save the LeadsIntel platform API key before setting up any number." : "WhatsApp setup is unavailable until the platform administrator configures the LeadsIntel key."}</Notice>}
          {s.legacyConfigured && <Notice tone="info" icon={<RadioTower className="h-4 w-4" />} testId="text-legacy-whatsapp">A legacy WhatsApp account is still saved. It is kept as-is and is not replaced by this setup until a managed number is active.</Notice>}
          {ro && <p className="mt-2 text-xs text-muted-foreground">Read-only access: status is shown as last saved. Automatic checking is off.</p>}
        </div>
        <div className="flex w-full flex-wrap gap-2 pl-7">
          <Btn variant="outline" disabled={ro || refresh.isPending || keyMissing} data-testid="button-refresh-whatsapp" onClick={doRefresh}>
            {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh status
          </Btn>
          {platform && <Btn variant="outline" disabled={ro} data-testid="button-leadsintel-key" onClick={() => setDlg("key")}><KeyRound className="h-4 w-4" />{s.platformKeyConfigured ? "Replace key" : "Add platform key"}</Btn>}
          {!platform && !s.inherited && <Btn variant="ghost" disabled={ro} data-testid="button-inherit-whatsapp" onClick={() => setDlg("inherit")}><Undo2 className="h-4 w-4" />Use platform default</Btn>}
          <Btn variant="outline" disabled={ro || keyMissing} data-testid="button-recover-whatsapp-open" onClick={() => setDlg("recover")}><LifeBuoy className="h-4 w-4" />Reconnect existing</Btn>
          <Btn disabled={!canSetup} title={blocked ? "A request is in progress or needs LeadsIntel recovery" : undefined} data-testid="button-setup-whatsapp" onClick={() => setDlg("setup")}><PhoneCall className="h-4 w-4" />{platform ? "Set up number" : "Set up school number"}</Btn>
        </div>
      </div>

      {platform && <FormDialog open={dlg === "key"} onOpenChange={(o) => !o && setDlg(null)} size="sm" title="LeadsIntel platform key" description="Write-only. Applies to all managed numbers.">
        <KeyForm s={s} onDone={() => setDlg(null)} />
      </FormDialog>}
      <FormDialog open={dlg === "setup"} onOpenChange={(o) => !o && setDlg(null)} size="lg" title={platform ? "Set up platform WhatsApp number" : "Set up school WhatsApp number"} description="Registered and managed by LeadsIntel.">
        <SetupForm platform={platform} s={s} onDone={() => setDlg(null)} />
      </FormDialog>
      <FormDialog open={dlg === "recover"} onOpenChange={(o) => !o && setDlg(null)} size="lg" title="Reconnect an existing number" description="Recover a number LeadsIntel already provisioned.">
        <RecoverForm platform={platform} onDone={() => setDlg(null)} />
      </FormDialog>
      {!platform && <FormDialog open={dlg === "inherit"} onOpenChange={(o) => !o && setDlg(null)} size="sm" title="Use platform WhatsApp?">
        <InheritForm onDone={() => setDlg(null)} />
      </FormDialog>}
    </li>
  );
}
