import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlatformEmailSettings, getGetPlatformEmailSettingsQueryKey,
  useSavePlatformEmailSettings, useSendPlatformTestEmail,
  useGetSchoolEmailSettings, getGetSchoolEmailSettingsQueryKey,
  useSaveSchoolEmailSettings, useSendSchoolTestEmail,
  type PlatformEmailSettings, type PlatformEmailSettingsInput,
} from "@workspace/api-client-react";
import { Info, Loader2, Mail, Send, Settings2 } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, useReadOnly } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailForm({ s, school, onDone }: { s: PlatformEmailSettings; school: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const savePlatform = useSavePlatformEmailSettings();
  const saveSchool = useSaveSchoolEmailSettings();
  const save = school ? saveSchool : savePlatform;
  const [senderName, setSenderName] = useState(s.senderName ?? "");
  const [senderEmail, setSenderEmail] = useState(s.senderEmail ?? "");
  const [replyTo, setReplyTo] = useState(s.replyTo ?? "");
  const [enabled, setEnabled] = useState(s.configured ? s.enabled : true);
  const [replace, setReplace] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const needKey = !s.configured || replace;

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const name = senderName.trim(), email = senderEmail.trim(), reply = replyTo.trim(), key = apiKey.trim();
    if (!name) return setErr("Enter the sender name.");
    if (!EMAIL_RE.test(email)) return setErr("Enter a valid sender email address.");
    if (reply && !EMAIL_RE.test(reply)) return setErr("Reply-to must be a valid email address, or left blank.");
    if (needKey && !key) return setErr(s.configured ? "Enter the replacement Brevo API key, or untick Replace API key." : "Enter the Brevo API key. It is required for the first configuration.");
    if (needKey && (key.length < 10 || key.length > 4096)) return setErr("The Brevo API key must be between 10 and 4096 characters.");
    const data: PlatformEmailSettingsInput = { enabled, senderName: name, senderEmail: email, ...(reply ? { replyTo: reply } : {}), ...(needKey ? { apiKey: key } : {}) };
    save.mutate({ data }, {
      onSuccess: () => {
        setApiKey("");
        qc.invalidateQueries({ queryKey: school ? getGetSchoolEmailSettingsQueryKey() : getGetPlatformEmailSettingsQueryKey() });
        toast({ title: "Email settings saved", description: "The API key is encrypted on the server. Saving does not verify delivery." });
        onDone();
      },
      onError: (x) => setErr(errMsg(x)),
    });
  };

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid="form-email-settings">
      <p className="text-xs text-muted-foreground">The sender email must be a sender or domain approved in your Brevo account, otherwise Brevo will reject sends.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sender name" required>
          <TextInput data-testid="input-sender-name" maxLength={100} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
        </Field>
        <Field label="Sender email" required hint="Approved Brevo sender">
          <TextInput data-testid="input-sender-email" type="email" maxLength={254} className="font-mono" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
        </Field>
        <Field label="Reply-to" hint="Optional" className="sm:col-span-2">
          <TextInput data-testid="input-reply-to" type="email" maxLength={254} className="font-mono" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
        </Field>
        {s.configured && <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" data-testid="toggle-replace-api-key" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={replace} onChange={(e) => { setReplace(e.target.checked); setApiKey(""); }} />
          <span>Replace API key <span className="block text-xs text-muted-foreground">Leave off to keep the saved, encrypted Brevo key.</span></span>
        </label>}
        {needKey && <Field label="Brevo API key" required className="sm:col-span-2">
          <TextInput data-testid="input-api-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} className="font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" data-testid="toggle-email-enabled" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled <span className="block text-xs text-muted-foreground">{school ? "When off, this school sends no email. There is no platform fallback." : "When off, the platform will not send email through Brevo."}</span></span>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">The API key is write-only: it is never displayed again after saving.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" data-testid="button-save-email" disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</Btn>
        <Btn type="button" variant="ghost" onClick={() => { setApiKey(""); onDone(); }}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function TestForm({ school, onDone }: { school: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const sendPlatform = useSendPlatformTestEmail();
  const sendSchool = useSendSchoolTestEmail();
  const send = school ? sendSchool : sendPlatform;
  const [recipient, setRecipient] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; messageId?: string } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = recipient.trim();
    if (!EMAIL_RE.test(r)) return setErr("Enter a valid recipient email address.");
    send.mutate({ data: { recipient: r } }, {
      onSuccess: (res) => { setResult(res); toast({ title: res.messageId ? "Test email accepted by Brevo" : "Test email queued", description: "This does not confirm delivery to the inbox." }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  if (result) return (
    <div className="space-y-4 p-5" data-testid="text-test-result">
      <p className="text-sm"><b>{result.messageId ? "Accepted by Brevo." : "Queued."}</b> {result.message} {result.messageId ? "This confirms Brevo accepted the request, not that it was delivered." : "Queued is not sent or delivered."}</p>
      {result.messageId && <p className="break-all font-mono text-xs text-muted-foreground">Message ID {result.messageId}</p>}
      <FormActions><Btn type="button" onClick={onDone}>Done</Btn></FormActions>
    </div>
  );
  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4 p-5" data-testid="form-test-email">
      <Field label="Recipient" required>
        <TextInput data-testid="input-test-recipient" type="email" maxLength={254} className="font-mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">One email is sent when you press Send. It is not retried automatically.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn type="submit" data-testid="button-send-test-email" disabled={send.isPending}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send test email</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{value}</dd>
    </div>
  );
}

export default function PlatformEmailSettingsPanel({ school = false }: { school?: boolean } = {}) {
  const poll = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;
  const pq = useGetPlatformEmailSettings({ query: { queryKey: getGetPlatformEmailSettingsQueryKey(), enabled: !school, ...poll } });
  const sq = useGetSchoolEmailSettings({ query: { queryKey: getGetSchoolEmailSettingsQueryKey(), enabled: school, ...poll } });
  const q = school ? sq : pq;
  const ro = useReadOnly();
  const [dlg, setDlg] = useState<null | "edit" | "test">(null);
  const [n, setN] = useState(0);
  const open = (d: "edit" | "test") => { setN((x) => x + 1); setDlg(d); };
  const s = q.data;
  const status = !s ? null : !s.configured ? { tone: "left", label: "not configured" } : s.enabled ? { tone: "active", label: "enabled" } : { tone: "inactive", label: "disabled" };
  const canTest = !!s?.configured && !!s?.enabled && !ro;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>{school ? <>This school sends email through <b>its own Brevo account</b>. There is no platform fallback: if this is not configured or disabled, school email (including campaigns) is not sent.</> : <>Platform email is sent through <b>Brevo</b>.</>} The sender address must be an approved Brevo sender or belong to an authenticated domain. Results are reported as accepted by Brevo, not delivered.</p>
      </div>
      {!school && <p className="text-xs text-muted-foreground" data-testid="text-welcome-note">When email is enabled, a welcome email is queued automatically after each school registration. Sending problems never fail the registration; check the result under Emails history.</p>}
      <Panel title="Email provider">
        {q.isLoading ? <SkeletonRows rows={2} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load email settings.")} onRetry={() => q.refetch()} />
          : !s ? <Empty icon={<Mail className="h-5 w-5" />} title="No email settings" body="The server returned nothing. Retry shortly." />
          : (
            <div className="space-y-5 p-5" data-testid="panel-email-summary">
              <div className="flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-primary" /><span className="font-semibold">Brevo</span>
                {status && <Pill tone={status.tone}>{status.label}</Pill>}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Btn variant="outline" disabled={!canTest} data-testid="button-open-test-email" title={!canTest ? "Configure and enable email first" : undefined} onClick={() => open("test")}><Send className="h-4 w-4" />Test email</Btn>
                  <Btn disabled={ro} data-testid="button-configure-email" onClick={() => open("edit")}><Settings2 className="h-4 w-4" />{s.configured ? "Edit" : "Configure"}</Btn>
                </div>
              </div>
              {s.configured ? (
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Row label="Provider" value="Brevo" />
                  <Row label="Sender" value={s.senderName ? `${s.senderName} <${s.senderEmail}>` : s.senderEmail || "—"} />
                  <Row label="Reply-to" value={s.replyTo || "Same as sender"} />
                  <Row label="Last updated" value={s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"} />
                </dl>
              ) : <p className="text-sm text-muted-foreground">Email is not configured yet. Add a Brevo API key and an approved sender to enable {school ? "this school's" : "platform"} email.</p>}
              {s.configured && !s.enabled && <p className="text-xs text-amber-800">Email is disabled. No {school ? "school" : "platform"} email will be sent until it is enabled.</p>}
            </div>
          )}
      </Panel>
      {s && <FormDialog open={dlg === "edit"} onOpenChange={(o) => !o && setDlg(null)} size="lg" testid="dialog-email-settings"
        title={s.configured ? "Edit email settings" : "Configure email"} description={school ? "This school’s own Brevo account." : "Brevo transactional email for the platform."}>
        {dlg === "edit" && <EmailForm key={n} s={s} school={school} onDone={() => setDlg(null)} />}
      </FormDialog>}
      <FormDialog open={dlg === "test"} onOpenChange={(o) => !o && setDlg(null)} size="sm" testid="dialog-test-email" title="Send test email">
        {dlg === "test" && <TestForm key={n} school={school} onDone={() => setDlg(null)} />}
      </FormDialog>
    </div>
  );
}
