import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSchoolSubscription, useRequestLicenceRenewal, useCancelLicenceRenewal, getGetSchoolSubscriptionQueryKey, type LicenceOrder } from "@workspace/api-client-react";
import { BadgeCheck, CircleSlash, Loader2, ReceiptText, ShieldCheck } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { kes } from "@/components/platform-billing";
import { coverageText } from "@/components/platform-licensing";
import { useAuthSession, errMsg, fmtDateTime } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { LIC_TONE, ORDER_TONE, days, invalidateLicensing } from "@/lib/licensing";
import { useToast } from "@/hooks/use-toast";

export default function SubscriptionPage() {
  usePageTitle("Subscription");
  const s = useAuthSession();
  const isAdmin = s.user.role === "school_admin";
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetSchoolSubscription({ query: { queryKey: getGetSchoolSubscriptionQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const req = useRequestLicenceRenewal();
  const cancel = useCancelLicenceRenewal();
  const reqId = useRef(crypto.randomUUID());
  const lastPlan = useRef<string | null>(null);
  const [planId, setPlanId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<LicenceOrder | null>(null);
  const [cErr, setCErr] = useState<string | null>(null);
  const sub = q.data;

  if (q.isLoading) return <div className="space-y-6"><div className="h-16 animate-pulse rounded bg-muted" /><Panel><SkeletonRows rows={4} cols={3} /></Panel></div>;
  if (q.isError || !sub) return <ErrorState msg={errMsg(q.error, "Could not load your subscription.")} onRetry={() => q.refetch()} />;

  const plans = sub.plans.filter((p) => p.isActive);
  const outstanding = sub.orders.find((o) => o.status === "pending" || o.status === "partial");
  const chosen = plans.find((p) => p.id === planId);
  const order = () => {
    setErr(null);
    if (!chosen) return setErr("Choose a plan.");
    if (lastPlan.current !== null && lastPlan.current !== chosen.id) reqId.current = crypto.randomUUID();
    lastPlan.current = chosen.id;
    req.mutate({ data: { requestId: reqId.current, planId: chosen.id } }, {
      onSuccess: (o) => { reqId.current = crypto.randomUUID(); lastPlan.current = null; setPlanId(""); invalidateLicensing(qc); toast({ title: `Invoice ${o.invoiceNumber} created`, description: `${kes(o.price)} for ${days(o.durationDays)}` }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const licences = [...sub.licences].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="School" title="Subscription" meta={<span className="flex items-center gap-2"><Pill tone={LIC_TONE[sub.status] ?? "inactive"}>{sub.status}</Pill>{sub.accessAllowed ? "Access allowed" : "Access blocked"}</span>} />
      <div className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${sub.accessAllowed ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`} data-testid="subscription-coverage">
        <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${sub.accessAllowed ? "text-primary" : "text-destructive"}`} />
        <div>{coverageText(sub)}{!isAdmin && !sub.accessAllowed && " Contact your school administrator to renew."}</div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Renew" note={isAdmin ? "Requesting creates a fixed-price invoice. Pay outside the app; the licence starts once the platform owner records full payment. Early renewals start when current coverage ends." : "Only school administrators can request renewals."}>
            {!plans.length ? <Empty icon={<BadgeCheck className="h-5 w-5" />} title="No plans offered" body="The platform has not published licence plans yet. Contact Rejista support." /> : <>
              <ul className="divide-y divide-border/60" role="radiogroup">{plans.map((p) => (
                <li key={p.id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-5 py-3 ${planId === p.id ? "bg-primary/5" : ""} ${!isAdmin || outstanding ? "cursor-default" : ""}`}>
                    <input type="radio" name="plan" data-testid={`radio-plan-${p.id}`} disabled={!isAdmin || !!outstanding} checked={planId === p.id} onChange={() => setPlanId(p.id)} className="h-4 w-4" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{p.name}</span><span className="block break-words text-xs text-muted-foreground">{days(p.durationDays)}{p.description ? ` · ${p.description}` : ""}</span></span>
                    <span className="font-mono text-sm font-semibold">{kes(p.subscriptionPrice)}</span>
                  </label>
                </li>
              ))}</ul>
              {isAdmin && <div className="space-y-3 border-t border-border/60 px-5 py-4">
                {outstanding && <p className="text-xs text-muted-foreground">Invoice {outstanding.invoiceNumber} is still outstanding. Pay or cancel it before requesting another.</p>}
                <FormError msg={err} />
                <Btn data-testid="button-request-renewal" disabled={!chosen || !!outstanding || req.isPending} onClick={order}>{req.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Request invoice{chosen ? ` · ${kes(chosen.subscriptionPrice)}` : ""}</Btn>
              </div>}
            </>}
          </Panel>

          <Panel title="Renewal invoices" note="Status updates when the platform owner records your payment.">
            {!sub.orders.length ? <Empty icon={<ReceiptText className="h-5 w-5" />} title="No renewal invoices" body={isAdmin ? "Choose a plan above to request one." : "Your administrator has not requested a renewal."} /> : (
              <ul className="divide-y divide-border/60">{sub.orders.map((o) => (
                <li key={o.id} data-testid={`row-order-${o.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono">{o.invoiceNumber}</span><Pill tone={ORDER_TONE[o.status] ?? "inactive"}>{o.status}</Pill></div>
                    <div className="text-xs text-muted-foreground">{o.planName} · {days(o.durationDays)} · {fmtDateTime(o.createdAt)}</div>
                  </div>
                  <div className="text-right font-mono text-xs"><div className="font-semibold">{kes(o.price)}</div><div className="text-muted-foreground">paid {kes(o.paid)} · due {kes(o.balance)}</div></div>
                  {isAdmin && o.status === "pending" && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-cancel-order-${o.id}`} onClick={() => { setCErr(null); setCancelling(o); }}><CircleSlash className="h-3.5 w-3.5" />Cancel</Btn>}
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-6">
          <Panel title="Payment methods">
            <ul className="divide-y divide-border/60">{sub.paymentMethods.map((m) => (
              <li key={m.id} className="px-5 py-3 text-sm"><div className="flex items-center justify-between gap-2 font-semibold">{m.name}<Pill tone={m.available ? "active" : "inactive"}>{m.available ? "available" : "unavailable"}</Pill></div>{m.reason && <p className="text-xs text-muted-foreground">{m.reason}</p>}</li>
            ))}</ul>
            <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">No online checkout. Get payment instructions from Rejista support; there is no automatic renewal or recurring charge.</p>
          </Panel>
          <Panel title="Licence history">
            {!licences.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No licences yet.</p> : (
              <ul className="divide-y divide-border/60">{licences.map((l) => (
                <li key={l.id} className="px-5 py-3"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l.planName}<Pill tone={LIC_TONE[l.status] ?? "inactive"}>{l.status}</Pill></div><div className="text-xs text-muted-foreground">{fmtDateTime(l.startsAt)} to {fmtDateTime(l.expiresAt)} · {days(l.durationDays)}</div></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      </div>

      <FormDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} size="sm" title="Cancel renewal request?" busy={cancel.isPending} testid="dialog-cancel-order">
        {cancelling && <div className="space-y-4 p-5">
          <p className="text-sm">Invoice {cancelling.invoiceNumber} for {kes(cancelling.price)} will be voided. Do not pay it after cancelling. Your current licence is unaffected.</p>
          <FormError msg={cErr} />
          <FormActions>
            <Btn variant="danger" data-testid="button-confirm-cancel-order" disabled={cancel.isPending} onClick={() => cancel.mutate({ orderId: cancelling.id }, { onSuccess: () => { invalidateLicensing(qc); toast({ title: "Renewal cancelled" }); setCancelling(null); }, onError: (x) => setCErr(errMsg(x)) })}>{cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Cancel request</Btn>
            <Btn variant="ghost" onClick={() => setCancelling(null)}>Keep it</Btn>
          </FormActions>
        </div>}
      </FormDialog>
    </div>
  );
}
