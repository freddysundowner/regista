import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetPlatformLicensing, useIssueSchoolLicence, useRevokeSchoolLicence, getGetPlatformLicensingQueryKey, type School, type SchoolLicence, type SchoolSubscription } from "@workspace/api-client-react";
import { BadgeCheck, Ban, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { kes } from "@/components/platform-billing";
import { errMsg, fmtDateTime, localInputToUtc } from "@/lib/session";
import { DAY_MS, LIC_TONE, ORDER_TONE, days, defaultStart, invalidateLicensing } from "@/lib/licensing";
import { useToast } from "@/hooks/use-toast";

function IssueForm({ school, sub, onDone }: { school: School; sub: SchoolSubscription; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useIssueSchoolLicence();
  const reqId = useRef(crypto.randomUUID());
  const sent = useRef<string | null>(null);
  const plans = sub.plans.filter((p) => p.isActive);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId);
  let startMs: number | null = defaultStart(sub.licences);
  if (custom) { try { startMs = start ? Date.parse(localInputToUtc(start)) : null; } catch { startMs = null; } }
  const endMs = plan && startMs !== null && Number.isFinite(startMs) ? startMs + plan.durationDays * DAY_MS : null;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!plan) return setErr("Choose an offered plan.");
    let startsAt: string | undefined;
    if (custom) {
      if (!start) return setErr("Enter a start date and time, or untick custom start.");
      try { startsAt = localInputToUtc(start); } catch { return setErr("That start time is not valid."); }
    }
    const sig = JSON.stringify([planId, startsAt ?? null]);
    if (sent.current !== null && sent.current !== sig) reqId.current = crypto.randomUUID();
    sent.current = sig;
    m.mutate({ schoolId: school.id, data: { requestId: reqId.current, planId, ...(startsAt ? { startsAt } : {}) } }, {
      onSuccess: (l) => { invalidateLicensing(qc, school.id); toast({ title: `${l.planName} granted`, description: `${fmtDateTime(l.startsAt)} to ${fmtDateTime(l.expiresAt)}` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  if (!plans.length) return <div className="p-5"><Empty icon={<BadgeCheck className="h-5 w-5" />} title="No offered plans" body="Create or re-activate a licence plan before granting."><Link href="/platform/licence-plans" className="text-sm font-semibold text-primary hover:underline">Open licence plans</Link></Empty></div>;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <p className="rounded-md border border-amber-600/35 bg-amber-500/10 px-3 py-2 text-xs">Manual admin grant. No payment or invoice is recorded; you may grant without payment. To bill, issue an invoice separately.</p>
      <Field label="Plan" required><NativeSelect data-testid="select-issue-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {days(p.durationDays)} · {kes(p.price)}</option>)}</NativeSelect></Field>
      <label className="flex items-center gap-2.5 text-sm"><input data-testid="checkbox-custom-start" type="checkbox" className="h-4 w-4" checked={custom} onChange={(e) => setCustom(e.target.checked)} />Set a custom start</label>
      {custom && <Field label="Starts at" required hint="Your local time"><TextInput data-testid="input-issue-start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
      <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Starts</dt><dd>{startMs !== null && Number.isFinite(startMs) ? fmtDateTime(new Date(startMs).toISOString()) : "\u2014"}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Ends</dt><dd>{endMs ? fmtDateTime(new Date(endMs).toISOString()) : "\u2014"}</dd></div>
      </dl>
      {!custom && <p className="text-xs text-muted-foreground">Starts after existing live or scheduled coverage, or now. The server sets the final times.</p>}
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
  return (
    <Panel title="Licence" note="Timed licences control access once a school is managed. Renewal invoices appear in Subscription billing; record the receipt there."
      action={<Btn className="h-8" data-testid="button-issue-licence" disabled={!approved || !sub} title={!approved ? "Only approved, active schools can be granted a licence" : undefined} onClick={() => setDlg({ kind: "issue", n: Date.now() })}><Plus className="h-4 w-4" />Grant</Btn>}>
      {q.isLoading ? <SkeletonRows rows={3} cols={3} /> : q.isError || !sub ? <ErrorState msg={errMsg(q.error, "Could not load licensing.")} onRetry={() => q.refetch()} /> : <>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3" data-testid="licence-coverage">
          <ShieldCheck className={`h-5 w-5 ${sub.accessAllowed ? "text-primary" : "text-destructive"}`} />
          <Pill tone={LIC_TONE[sub.status] ?? "inactive"}>{sub.status}</Pill>
          <span className="min-w-0 flex-1 text-sm">{coverageText(sub)}</span>
          <span className="text-xs font-semibold">{sub.accessAllowed ? "Access allowed" : "Access blocked"}</span>
        </div>
        {!approved && <p className="border-b border-border/60 px-5 py-2 text-xs text-muted-foreground">Granting is disabled while the school is {school.status}.</p>}
        <h3 className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">History</h3>
        {!licences.length ? <Empty icon={<BadgeCheck className="h-5 w-5" />} title="No licences" body="Grant a licence, or wait for the school to request a renewal invoice." /> : (
          <ul className="divide-y divide-border/60">{licences.map((l) => (
            <li key={l.id} data-testid={`row-licence-${l.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l.planName}<Pill tone={LIC_TONE[l.status] ?? "inactive"}>{l.status}</Pill><span className="text-[11px] font-normal text-muted-foreground">{l.source === "admin" ? "admin grant" : "paid"}</span></div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(l.startsAt)} to {fmtDateTime(l.expiresAt)} · {days(l.durationDays)} · <span className="font-mono">{kes(l.price)}</span>{l.revokedAt ? ` · revoked ${fmtDateTime(l.revokedAt)}` : ""}</div>
              </div>
              {(l.status === "active" || l.status === "scheduled") && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-revoke-licence-${l.id}`} onClick={() => setDlg({ kind: "revoke", id: l.id })}><Ban className="h-3.5 w-3.5" />Revoke</Btn>}
            </li>
          ))}</ul>
        )}
        <h3 className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Renewal requests</h3>
        {!sub.orders.length ? <p className="px-5 pb-4 pt-2 text-sm text-muted-foreground">No renewal requests from this school.</p> : (
          <ul className="divide-y divide-border/60">{sub.orders.map((o) => (
            <li key={o.id} data-testid={`row-order-${o.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono">{o.invoiceNumber}</span><Pill tone={ORDER_TONE[o.status] ?? "inactive"}>{o.status}</Pill></div>
                <div className="text-xs text-muted-foreground">{o.planName} · {days(o.durationDays)} · requested {fmtDateTime(o.createdAt)}{(o.status === "pending" || o.status === "partial") ? " · record payment on this invoice in Subscription billing" : ""}</div>
              </div>
              <div className="text-right font-mono text-xs"><div className="font-semibold">{kes(o.price)}</div><div className="text-muted-foreground">paid {kes(o.paid)} · due {kes(o.balance)}</div></div>
            </li>
          ))}</ul>
        )}
      </>}
      <FormDialog open={dlg?.kind === "issue" && !!sub} onOpenChange={(o) => !o && setDlg(null)} title="Grant licence" description={`Direct timed licence for ${school.name}.`} testid="dialog-issue-licence">
        {dlg?.kind === "issue" && sub && <IssueForm key={dlg.n} school={school} sub={sub} onDone={() => setDlg(null)} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "revoke" && !!lic} onOpenChange={(o) => !o && setDlg(null)} size="sm" title="Revoke licence?" testid="dialog-revoke-licence">
        {lic && sub && <RevokeConfirm school={school} lic={lic} sub={sub} onDone={() => setDlg(null)} />}
      </FormDialog>
    </Panel>
  );
}
