import { useState, type FormEvent } from "react";
import { Redirect, useSearch } from "wouter";
import MessagingSettingsPage from "@/pages/messaging-settings";
import EmailSettingsPanel from "@/pages/platform-email-settings";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSchool, useUpdateSchool, getGetSchoolQueryKey, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey, SchoolType, SchoolSettingsSiblingSplitRule, SchoolSettingsSiblingFallbackRule, SchoolSettingsKnecColumnsItem, getListSchoolsQueryKey, type School, type SchoolSettings } from "@workspace/api-client-react";
import { StoredImage, ImageUploadButton } from "@/components/stored-image";
import { Building, Loader2, Pencil } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Panel, ErrorState, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { errMsg, blank, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function SchoolForm({ school, onDone, embedded = false }: { school: School; onDone: () => void; embedded?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateSchool();
  const init = { name: school.name === "New school" ? "" : school.name, county: school.county ?? "", type: school.type, address: school.address ?? "", phone: school.phone ?? "", email: school.email ?? "" };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ data: { name: f.name.trim(), county: blank(f.county), type: f.type as SchoolType, address: blank(f.address), phone: blank(f.phone), email: blank(f.email) } }, {
      onSuccess: (s) => { qc.setQueryData(getGetSchoolQueryKey(), s); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: "School profile saved" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className={embedded ? "space-y-5" : "space-y-5 p-5"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-school-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Level"><NativeSelect data-testid="select-type" value={f.type} onChange={set("type")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="County"><TextInput data-testid="input-county" value={f.county} onChange={set("county")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Email"><TextInput data-testid="input-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Postal / physical address"><TextInput data-testid="input-address" value={f.address} onChange={set("address")} placeholder="P.O. Box 1234-00100, Nairobi" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-school" type="submit" disabled={!dirty || m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save profile</Btn>
        {!embedded && <>
          <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
          <span className="ml-auto text-xs text-muted-foreground">Registered {fmtDate(school.createdAt)} · {school.status}</span>
        </>}
      </FormActions>
    </form>
  );
}

const SPLIT_LABEL: Record<string, string> = { ask_parent: "Ask the parent", proportional_to_balance: "Proportional to balance", oldest_arrears_first: "Oldest arrears first", leave_in_queue: "Leave in review queue" };

export function LogoBlock({ school }: { school: School }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateSchool();
  const [err, setErr] = useState<string | null>(null);
  const after = (s: School) => { qc.setQueryData(getGetSchoolQueryKey(), s); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); };
  return (
    <div className="flex flex-wrap items-center gap-4 p-5">
      <StoredImage refPath={school.logoUrl} alt={`${school.name} logo`} className="h-20 w-20 rounded-md border border-border bg-card object-contain"
        fallback={<div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"><Building className="h-6 w-6" /></div>} />
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">JPEG, PNG or WebP up to 5 MB. Stored privately; only signed-in staff can view it.</p>
        <div className="flex flex-wrap items-start gap-2">
          <ImageUploadButton purpose="school_logo" entityId={school.id} label={school.logoUrl ? "Replace logo" : "Upload logo"} testid="upload-school-logo"
            onSaved={(ref) => m.mutateAsync({ data: { logoUrl: ref } }).then((s) => { after(s); toast({ title: "Logo saved" }); })} />
          {school.logoUrl && <Btn type="button" variant="ghost" className="h-8" data-testid="button-remove-logo" disabled={m.isPending}
            onClick={() => { setErr(null); m.mutate({ data: { logoUrl: null } }, { onSuccess: (s) => { after(s); toast({ title: "Logo removed" }); }, onError: (x) => setErr(errMsg(x)) }); }}>Remove</Btn>}
        </div>
        <FormError msg={err} />
      </div>
    </div>
  );
}

function OpsSettingsForm({ school, onDone }: { school: School; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateSchool();
  const cur: SchoolSettings = school.settings ?? {};
  const init = {
    autoPostThreshold: cur.autoPostThreshold?.toString() ?? "", siblingSplitRule: cur.siblingSplitRule ?? "", siblingFallbackRule: cur.siblingFallbackRule ?? "",
    siblingReplyHours: cur.siblingReplyHours?.toString() ?? "", reminderDays: (cur.reminderDays ?? []).join(", "), defaultAfterMissedInstallments: cur.defaultAfterMissedInstallments?.toString() ?? "",
    absenceAlertsEnabled: cur.absenceAlertsEnabled ?? false, absenceAlertTime: cur.absenceAlertTime ?? "",
    statusDigest: (cur.statusDigest ?? "weekly") as string, statusDigestChannel: (cur.statusDigestChannel ?? "sms") as string,
    knecColumns: (cur.knecColumns ?? []).join(", "), messageTemplates: cur.messageTemplates ? JSON.stringify(cur.messageTemplates, null, 2) : "",
  };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: Exclude<keyof typeof f, "absenceAlertsEnabled">) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const int = (v: string, lo: number, hi: number, label: string) => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label} must be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    let next: SchoolSettings;
    try {
      const days = f.reminderDays.split(/[\s,]+/).filter(Boolean).map((d) => int(d, -365, 365, "Each reminder day") as number);
      if (days.length > 20) throw new Error("Use at most 20 reminder days.");
      const knec = f.knecColumns.split(/[\s,]+/).filter(Boolean);
      const allowed = Object.values(SchoolSettingsKnecColumnsItem) as string[];
      const bad = knec.find((k) => !allowed.includes(k));
      if (bad) throw new Error(`Unknown KNEC column "${bad}". Use: ${allowed.join(", ")}.`);
      if (new Set(knec).size !== knec.length) throw new Error("KNEC columns must not repeat.");
      let templates: SchoolSettings["messageTemplates"];
      if (f.messageTemplates.trim()) {
        try { templates = JSON.parse(f.messageTemplates); } catch { throw new Error("Message templates must be valid JSON."); }
        if (!templates || typeof templates !== "object" || Array.isArray(templates)) throw new Error("Message templates must be an object keyed by purpose.");
      }
      next = {
        ...cur,
        knecColumns: knec.length ? (knec as SchoolSettings["knecColumns"]) : undefined,
        messageTemplates: templates,
        autoPostThreshold: int(f.autoPostThreshold, 0, 150, "Auto-post threshold"),
        siblingSplitRule: (f.siblingSplitRule || undefined) as SchoolSettings["siblingSplitRule"],
        siblingFallbackRule: (f.siblingFallbackRule || undefined) as SchoolSettings["siblingFallbackRule"],
        siblingReplyHours: int(f.siblingReplyHours, 1, 168, "Parent reply window"),
        reminderDays: days.length ? days : undefined,
        defaultAfterMissedInstallments: int(f.defaultAfterMissedInstallments, 1, 24, "Missed installments"),
        absenceAlertsEnabled: f.absenceAlertsEnabled,
        absenceAlertTime: f.absenceAlertTime || undefined,
        statusDigest: f.statusDigest as "off" | "weekly" | "monthly", statusDigestChannel: f.statusDigestChannel as "sms" | "whatsapp",
      };
    } catch (x) { return setErr((x as Error).message); }
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as SchoolSettings;
    m.mutate({ data: { settings: clean } }, {
      onSuccess: (s) => { qc.setQueryData(getGetSchoolQueryKey(), s); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); toast({ title: "School settings saved" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Auto-post match threshold" hint="0 to 150; used by payment matching later"><TextInput data-testid="input-auto-post" type="number" inputMode="numeric" min={0} max={150} value={f.autoPostThreshold} onChange={set("autoPostThreshold")} /></Field>
        <Field label="Parent reply window (hours)" hint="1 to 168"><TextInput data-testid="input-reply-hours" type="number" inputMode="numeric" min={1} max={168} value={f.siblingReplyHours} onChange={set("siblingReplyHours")} /></Field>
        <Field label="Sibling payment split"><NativeSelect data-testid="select-split-rule" value={f.siblingSplitRule} onChange={set("siblingSplitRule")}><option value="">Not set</option>{Object.values(SchoolSettingsSiblingSplitRule).map((r) => <option key={r} value={r}>{SPLIT_LABEL[r]}</option>)}</NativeSelect></Field>
        <Field label="If parent does not reply"><NativeSelect data-testid="select-fallback-rule" value={f.siblingFallbackRule} onChange={set("siblingFallbackRule")}><option value="">Not set</option>{Object.values(SchoolSettingsSiblingFallbackRule).map((r) => <option key={r} value={r}>{SPLIT_LABEL[r]}</option>)}</NativeSelect></Field>
        <Field label="Reminder days" hint="Relative to due date, comma separated, e.g. -7, -1, 3"><TextInput data-testid="input-reminder-days" className="font-mono" value={f.reminderDays} onChange={set("reminderDays")} /></Field>
        <Field label="Default after missed installments" hint="1 to 24"><TextInput data-testid="input-missed-installments" type="number" inputMode="numeric" min={1} max={24} value={f.defaultAfterMissedInstallments} onChange={set("defaultAfterMissedInstallments")} /></Field>
        <Field label="Status message to administrators" hint="A short summary of fees received, balances and anything waiting, sent to each school administrator's phone on Monday morning or the 1st of the month.">
          <NativeSelect data-testid="select-status-digest" value={f.statusDigest} onChange={set("statusDigest")}><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="off">Off</option></NativeSelect>
        </Field>
        <Field label="Send it by" hint="WhatsApp needs an approved template named school_digest; without one it goes by SMS.">
          <NativeSelect data-testid="select-status-digest-channel" value={f.statusDigestChannel} onChange={set("statusDigestChannel")} disabled={f.statusDigest === "off"}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></NativeSelect>
        </Field>
        <Field label="Absence alert time" hint="East Africa Time (Nairobi), 24-hour"><TextInput data-testid="input-absence-time" type="time" value={f.absenceAlertTime} onChange={set("absenceAlertTime")} disabled={!f.absenceAlertsEnabled} /></Field>
        <Field label="KNEC export columns" hint={`Ordered, comma separated: ${Object.values(SchoolSettingsKnecColumnsItem).join(", ")}`} className="sm:col-span-2"><TextInput data-testid="input-knec-columns" className="font-mono" value={f.knecColumns} onChange={set("knecColumns")} placeholder="admissionNo, upi, studentName, learningArea, percent, level, term" /></Field>
        <Field label="Message templates (JSON)" hint='Per purpose: {"fee_reminder": {"transport": "template", "name": "your_approved_name", "language": "en", "components": []}} or {"transport": "text"}. No secrets here.' className="sm:col-span-2"><textarea data-testid="input-message-templates" rows={6} spellCheck={false} className="w-full rounded-md border border-input bg-background/60 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring" value={f.messageTemplates} onChange={set("messageTemplates")} /></Field>
        <label className="flex items-center gap-2 self-center text-sm"><input data-testid="check-absence-alerts" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.absenceAlertsEnabled} onChange={(e) => setF({ ...f, absenceAlertsEnabled: e.target.checked })} /> Send absence alerts to guardians by WhatsApp and SMS</label>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-settings" type="submit" disabled={!dirty || m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
        <span className="ml-auto text-xs text-muted-foreground">Other saved settings are kept. Term dates live under Academics.</span>
      </FormActions>
    </form>
  );
}

function Facts({ rows, empty = "\u2014" }: { rows: [string, string][]; empty?: string }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        // Phone: one line per fact, the name on the left and its value on the right.
        <div key={k} className="border-b border-border/60 px-5 py-3 max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:!py-2 sm:odd:border-r">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground max-md:shrink-0">{k}</dt>
          <dd className={cn(v ? "mt-0.5 break-words text-sm font-medium" : "mt-0.5 text-sm text-muted-foreground", "max-md:mt-0 max-md:min-w-0 max-md:text-right")}>{v || empty}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Whether money changes wait for a second person. Small schools with one administrator usually switch it off. */
function ApprovalSwitch({ school }: { school: School }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateSchool();
  const on = school.settings?.requireSecondApproval !== false;
  const flip = () => m.mutate({ data: { settings: { ...(school.settings ?? {}), requireSecondApproval: !on } } }, {
    onSuccess: (x) => { qc.setQueryData(getGetSchoolQueryKey(), x); toast({ title: on ? "Second approval switched off" : "Second approval switched on", description: on ? "Money changes now apply as soon as they're saved." : "Money changes now wait for a second person." }); },
    onError: (x) => toast({ title: "Could not change the setting", description: errMsg(x) }),
  });
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Money changes need a second person's approval</div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {on ? "Discounts, waivers, refunds, reversals, bounced cheques and fee changes after billing wait until another administrator or the principal approves them under Approvals."
              : "Off: those changes apply as soon as they're saved. Each one is still recorded in the audit log."}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Money changes need a second person's approval" disabled={m.isPending} onClick={flip} data-testid="switch-second-approval"
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
        </button>
      </div>
    </Panel>
  );
}

export function SchoolProfileSection({ embedded = false }: { embedded?: boolean } = {}) {
  const q = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const [edit, setEdit] = useState<"profile" | "ops" | null>(null);
  const s = q.data;
  const st: SchoolSettings = s?.settings ?? {};
  return (
    <div className="space-y-6">
      {!embedded && <PageHeader eyebrow="Settings" title="School profile" meta="Appears on staff screens and future documents." />}
      {q.isLoading ? <Panel><div className="grid gap-4 p-5 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded bg-muted" />)}</div></Panel> :
        q.isError || !q.data ? <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel> : (
          <>
            <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <Panel title="Logo"><LogoBlock school={q.data} /></Panel>
            <Panel title="Profile" action={<Btn variant="outline" className="h-8" data-testid="button-edit-profile" onClick={() => setEdit("profile")}><Pencil className="h-3.5 w-3.5" /> Edit profile</Btn>}>
              <Facts rows={[["School name", q.data.name], ["School code", q.data.code], ["Level", q.data.type], ["County", q.data.county ?? ""], ["Phone", q.data.phone ?? ""], ["Email", q.data.email ?? ""], ["Address", q.data.address ?? ""], ["Registered", `${fmtDate(q.data.createdAt)} · ${q.data.status}`]]} />
            </Panel>
            </div>
            <ApprovalSwitch school={q.data} />
            <Panel title="Operational settings" note="Rules used by reminders, sibling payments and attendance alerts." action={<Btn variant="outline" className="h-8" data-testid="button-edit-settings" onClick={() => setEdit("ops")}><Pencil className="h-3.5 w-3.5" /> Edit settings</Btn>}>
              <Facts empty="Default" rows={[
                ["Auto-post threshold", st.autoPostThreshold?.toString() ?? ""], ["Parent reply window", st.siblingReplyHours ? `${st.siblingReplyHours} h` : ""],
                ["Sibling payment split", st.siblingSplitRule ? SPLIT_LABEL[st.siblingSplitRule] : ""], ["If parent does not reply", st.siblingFallbackRule ? SPLIT_LABEL[st.siblingFallbackRule] : ""],
                ["Reminder days", (st.reminderDays ?? []).join(", ")], ["Default after missed installments", st.defaultAfterMissedInstallments?.toString() ?? ""],
                ["Absence alerts", st.absenceAlertsEnabled ? `On${st.absenceAlertTime ? ` at ${st.absenceAlertTime} EAT` : ""}` : "Off"], ["Status message to administrators", st.statusDigest === "off" ? "Off" : `${st.statusDigest === "monthly" ? "Monthly" : "Weekly"} by ${st.statusDigestChannel === "whatsapp" ? "WhatsApp" : "SMS"}`], ["KNEC export columns", (st.knecColumns ?? []).join(", ")],
                ["Message templates", st.messageTemplates ? `${Object.keys(st.messageTemplates).length} purpose(s) configured` : ""],
              ]} />
            </Panel>
            <FormDialog phonePage open={edit === "profile"} onOpenChange={(o) => setEdit(o ? "profile" : null)} title="Edit school profile" description="Appears on staff screens and documents.">
              {s && <SchoolForm key={s.id} school={s} onDone={() => setEdit(null)} />}
            </FormDialog>
            <FormDialog open={edit === "ops"} onOpenChange={(o) => setEdit(o ? "ops" : null)} size="lg" title="Edit operational settings" description="Other saved settings are kept. Term dates live under Academics.">
              {s && <OpsSettingsForm key={`${s.id}-${JSON.stringify(s.settings ?? {})}`} school={s} onDone={() => setEdit(null)} />}
            </FormDialog>
          </>
        )}
    </div>
  );
}

const PAGES = {
  profile: { title: "School profile", meta: "Name, contacts and logo shown on receipts, statements and report cards." },
  email: { title: "Email", meta: "Send from this school's own email account instead of the platform's." },
  messaging: { title: "Messaging", meta: "How SMS and WhatsApp messages reach parents." },
} as const;

/** Each settings page is its own tab in the Settings section, so there is no second row of tabs here. */
export default function SettingsPage({ page = "profile" }: { page?: keyof typeof PAGES }) {
  const search = useSearch();
  // Old links used ?tab=…; send them to the page that replaced it.
  const legacy = new URLSearchParams(search).get("tab");
  if (legacy === "email" || legacy === "messaging") return <Redirect to={`/settings/${legacy}`} replace />;
  const head = PAGES[page];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title={head.title} meta={head.meta} />
      <div className="rise">
        {page === "profile" ? <SchoolProfileSection embedded /> : page === "email" ? <EmailSettingsPanel school /> : <MessagingSettingsPage embedded />}
      </div>
    </div>
  );
}
