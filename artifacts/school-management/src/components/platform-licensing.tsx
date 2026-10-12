import { useRef, useState, type FormEvent } from "react";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import { useGetPlatformLicensing, useIssueSchoolLicence, useRevokeSchoolLicence, getGetPlatformLicensingQueryKey, type School, type SchoolLicence, type SchoolSubscription } from "@workspace/api-client-react";
import { BadgeCheck, Ban, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, Field, TextInput, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { kes } from "@/components/platform-billing";
import { errMsg, fmtDateTime, localInputToUtc } from "@/lib/session";
import { DAY_MS, LIC_TONE, days, defaultStart, invalidateLicensing } from "@/lib/licensing";
import { useToast } from "@/hooks/use-toast";

const PRESETS = [{ label: "1 month", days: 30 }, { label: "1 term", days: 120 }, { label: "1 year", days: 365 }];

function IssueForm({ school, sub, onDone }: { school: School; sub: SchoolSubscription; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useIssueSchoolLicence();
  const reqId = useRef(crypto.randomUUID());
  const sent = useRef<string | null>(null);
  const [daysText, setDaysText] = useState(String(sub.pricing.configured ? sub.pricing.periodDays : 365));
  const [limit, setLimit] = useState(sub.pricing.maxLearners ? String(sub.pricing.maxLearners) : "");
  const [label, setLabel] = useState("");
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const durationDays = /^\d+$/.test(daysText) ? Number(daysText) : NaN;
  let startMs: number | null = defaultStart(sub.licences);
  if (custom) { try { startMs = start ? Date.parse(localInputToUtc(start)) : null; } catch { startMs = null; } }
  const endMs = Number.isFinite(durationDays) && durationDays > 0 && startMs !== null && Number.isFinite(startMs) ? startMs + durationDays * DAY_MS : null;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) return setErr("Enter between 1 and 3650 days.");
    if (limit.trim() && !/^\d+$/.test(limit.trim())) return setErr("Learner limit must be a whole number, or blank for unlimited.");
    let startsAt: string | undefined;
    if (custom) {
      if (!start) return setErr("Enter a start date and time, or untick custom start.");
      try { startsAt = localInputToUtc(start); } catch { return setErr("That start time is not valid."); }
    }
    const maxLearners = limit.trim() ? Number(limit.trim()) : null;
    const sig = JSON.stringify([durationDays, maxLearners, label.trim(), startsAt ?? null]);
    if (sent.current !== null && sent.current !== sig) reqId.current = crypto.randomUUID();
    sent.current = sig;
    m.mutate({ schoolId: school.id, data: { requestId: reqId.current, durationDays, maxLearners, ...(label.trim() ? { label: label.trim() } : {}), ...(startsAt ? { startsAt } : {}) } }, {
      onSuccess: (l) => { invalidateLicensing(qc, school.id); toast({ title: "Licence granted", description: `${fmtDateTime(l.startsAt)} to ${fmtDateTime(l.expiresAt)}` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <p className="rounded-md border border-amber-600/35 bg-amber-500/10 px-3 py-2 text-xs">Free grant: no payment or invoice is recorded. To charge, let the school pay from Subscription or sell them a licence key.</p>
      <Field label="How long" required>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => <button key={p.days} type="button" onClick={() => setDaysText(String(p.days))} className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${durationDays === p.days ? "bg-primary text-primary-foreground ring-primary" : "ring-border hover:bg-muted"}`}>{p.label}</button>)}
          <span className="flex items-center gap-2"><TextInput data-testid="input-issue-days" inputMode="numeric" className="w-24" value={daysText} onChange={(e) => setDaysText(e.target.value)} /><span className="text-sm text-muted-foreground">days</span></span>
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Learner limit" hint="Blank means unlimited"><TextInput data-testid="input-issue-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        <Field label="Label" hint="Shown in the school's history"><TextInput maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Pilot term" /></Field>
      </div>
      <label className="flex items-center gap-2.5 text-sm"><input data-testid="checkbox-custom-start" type="checkbox" className="h-4 w-4" checked={custom} onChange={(e) => setCustom(e.target.checked)} />Set a custom start</label>
      {custom && <Field label="Starts at" required hint="Your local time"><TextInput data-testid="input-issue-start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
      <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Starts</dt><dd>{startMs !== null && Number.isFinite(startMs) ? fmtDateTime(new Date(startMs).toISOString()) : "\u2014"}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Ends</dt><dd>{endMs ? fmtDateTime(new Date(endMs).toISOString()) : "\u2014"}</dd></div>
      </dl>
      {!custom && <p className="text-xs text-muted-foreground">Starts after the school's current time runs out, or now.</p>}
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-issue" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Grant licence</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function RevokeConfirm({ school, lic, sub, onDone }: { school: School; lic: SchoolLicence; sub: SchoolSubscription; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useRevokeSchoolLicence();
  const [err, setErr] = useState<string | null>(null);
  const others = sub.licences.some((l) => l.id !== lic.id && (l.status === "active" || l.status === "scheduled"));
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm">Revokes <span className="font-semibold">{lic.planName}</span> ({fmtDateTime(lic.startsAt)} to {fmtDateTime(lic.expiresAt)}). {lic.status === "active" && !others ? `${school.name} staff lose access to school operations immediately; only subscription and account pages stay open.` : "Its coverage is removed; other licences are unaffected."} The record stays in history. Payments are not refunded.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn variant="danger" data-testid="button-confirm-revoke" disabled={m.isPending} onClick={() => { setErr(null); m.mutate({ schoolId: school.id, licenceId: lic.id }, { onSuccess: () => { invalidateLicensing(qc, school.id); toast({ title: "Licence revoked" }); onDone(); }, onError: (x) => setErr(errMsg(x)) }); }}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Revoke licence</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </div>
  );
}

export function coverageText(sub: SchoolSubscription) {
  if (sub.status === "trial") return `Free trial with every feature until ${fmtDateTime(sub.currentEndsAt)}.`;
  if (!sub.managed && sub.status === "expired") return "The free trial has ended. Subscribe or enter a licence key to continue.";
  if (!sub.managed) return "Not licence-managed yet. Access continues until the first timed licence is granted.";
  if (sub.status === "active") return `Covered until ${fmtDateTime(sub.currentEndsAt)}.`;
  const next = sub.licences.filter((l) => l.status === "scheduled").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (sub.status === "scheduled") return `No current access. Next licence starts ${next ? fmtDateTime(next.startsAt) : "later"}; there is a gap until then.`;
  return "Licence expired. School operations are blocked until a licence is granted or a renewal invoice is paid.";
}

export function LicensingPanel({ school }: { school: School }) {
  const q = useGetPlatformLicensing(school.id, { query: { queryKey: getGetPlatformLicensingQueryKey(school.id), enabled: !!school.id, refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const [dlg, setDlg] = useState<{ kind: "issue"; n: number } | { kind: "revoke"; id: string } | null>(null);
  const sub = q.data;
  const approved = school.status === "active";
  const lic = dlg?.kind === "revoke" ? sub?.licences.find((l) => l.id === dlg.id) : undefined;
  const licences = [...(sub?.licences ?? [])].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const { rows, pager } = usePaged(licences);
  return (
    <Panel title="Licence" note="Decides whether the school can use Rejista."
      action={<Btn className="h-8" data-testid="button-issue-licence" disabled={!approved || !sub} title={!approved ? "Only approved, active schools can be granted a licence" : undefined} onClick={() => setDlg({ kind: "issue", n: Date.now() })}><Plus className="h-4 w-4" />Grant time</Btn>}>
      {q.isLoading ? <SkeletonRows rows={3} cols={3} /> : q.isError || !sub ? <ErrorState msg={errMsg(q.error, "Could not load licensing.")} onRetry={() => q.refetch()} /> : <>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3" data-testid="licence-coverage">
          <ShieldCheck className={`h-5 w-5 ${sub.accessAllowed ? "text-primary" : "text-destructive"}`} />
          <Pill tone={LIC_TONE[sub.status] ?? "inactive"}>{sub.status}</Pill>
          <span className="min-w-0 flex-1 text-sm">{coverageText(sub)}</span>
          <span className="text-xs font-semibold">{sub.accessAllowed ? "Access allowed" : "Access blocked"}</span>
        </div>
        {!approved && <p className="border-b border-border/60 px-5 py-2 text-xs text-muted-foreground">Granting is disabled while the school is {school.status}.</p>}
        {!licences.length ? <Empty icon={<BadgeCheck className="h-5 w-5" />} title="No licences yet" body="The school pays from its Subscription page, redeems a key, or you grant time." /> : (
          <ul className="divide-y divide-border/60">{rows.map((l) => (
            <li key={l.id} data-testid={`row-licence-${l.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l.planName}<Pill tone={LIC_TONE[l.status] ?? "inactive"}>{l.status}</Pill><span className="text-[11px] font-normal text-muted-foreground">{l.source === "admin" ? "granted" : l.source === "key" ? "licence key" : "paid"}</span></div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(l.startsAt)} to {fmtDateTime(l.expiresAt)} · {days(l.durationDays)} · <span className="font-mono">{Number(l.price) ? kes(l.price) : "free"}</span>{l.revokedAt ? ` · revoked ${fmtDateTime(l.revokedAt)}` : ""}</div>
              </div>
              {(l.status === "active" || l.status === "scheduled") && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-revoke-licence-${l.id}`} onClick={() => setDlg({ kind: "revoke", id: l.id })}><Ban className="h-3.5 w-3.5" />Revoke</Btn>}
            </li>
          ))}</ul>
        )}
        <Pager {...pager} />
      </>}
      <FormDialog open={dlg?.kind === "issue" && !!sub} onOpenChange={(o) => !o && setDlg(null)} title="Grant time" description={`Add licence time for ${school.name}.`} testid="dialog-issue-licence">
        {dlg?.kind === "issue" && sub && <IssueForm key={dlg.n} school={school} sub={sub} onDone={() => setDlg(null)} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "revoke" && !!lic} onOpenChange={(o) => !o && setDlg(null)} size="sm" title="Revoke licence?" testid="dialog-revoke-licence">
        {lic && sub && <RevokeConfirm school={school} lic={lic} sub={sub} onDone={() => setDlg(null)} />}
      </FormDialog>
    </Panel>
  );
}
