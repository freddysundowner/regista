import { useEffect, useRef, useState } from "react";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import {
  useGetSchoolSubscription, useRequestLicenceRenewal, useCancelLicenceRenewal, useStartSubscriptionCheckout, useGetSubscriptionCheckout, useRedeemLicenceKey,
  getGetSchoolSubscriptionQueryKey, getGetSubscriptionCheckoutQueryKey, type LicenceOrder, type PaymentProvider,
} from "@workspace/api-client-react";
import { CircleSlash, CreditCard, KeyRound, Landmark, Loader2, ReceiptText, ShieldCheck, Smartphone, Users } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill, FormError, FormActions, Field, TextInput } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { kes as fullKes } from "@/components/platform-billing";
import { coverageText } from "@/components/platform-licensing";
import { useAuthSession, errMsg, fmtDate, fmtDateTime } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { LIC_TONE, ORDER_TONE, DAY_MS, days, invalidateLicensing } from "@/lib/licensing";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Whole shillings read cleaner; cents show only when there are some. */
const kes = (v: string | null | undefined) => fullKes(v).replace(/\.00$/, "");
const METHOD_ICON: Record<string, typeof Smartphone> = { mpesa: Smartphone, stripe: CreditCard, paystack: CreditCard, manual: Landmark };

/** Follows one checkout until the provider confirms or rejects it. */
function useCheckoutWatch(id: string | null, onDone: (status: string, message: string) => void) {
  const q = useGetSubscriptionCheckout(id ?? "", { query: { queryKey: getGetSubscriptionCheckoutQueryKey(id ?? ""), enabled: !!id,
    refetchInterval: (query) => query.state.data?.status === "pending" ? 3000 : false } });
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const c = q.data;
    if (!c || c.status === "pending" || reported.current === c.id) return;
    reported.current = c.id;
    onDone(c.status, c.message);
  }, [q.data, onDone]);
  return q.data;
}

export default function SubscriptionPage() {
  usePageTitle("Subscription");
  const s = useAuthSession();
  const isAdmin = s.user.role === "school_admin";
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const [, navigate] = useLocation();
  const q = useGetSchoolSubscription({ query: { queryKey: getGetSchoolSubscriptionQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const renew = useRequestLicenceRenewal();
  const checkout = useStartSubscriptionCheckout();
  const cancel = useCancelLicenceRenewal();
  const redeem = useRedeemLicenceKey();
  const reqId = useRef(crypto.randomUUID());
  const [paying, setPaying] = useState<LicenceOrder | null>(null);
  const [method, setMethod] = useState<PaymentProvider | "manual" | null>(null);
  const [phone, setPhone] = useState(s.user.phone ?? "");
  const [payErr, setPayErr] = useState<string | null>(null);
  const [watching, setWatching] = useState<string | null>(() => new URLSearchParams(search).get("checkout"));
  const [code, setCode] = useState("");
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [cancelling, setCancelling] = useState<LicenceOrder | null>(null);
  const [cErr, setCErr] = useState<string | null>(null);

  const watched = useCheckoutWatch(watching, (status, message) => {
    invalidateLicensing(qc);
    toast({ title: status === "paid" ? "Payment received" : "Payment not completed", description: message });
    setWatching(null); setPaying(null);
    if (search.includes("checkout=")) navigate("/subscription", { replace: true });
  });

  const sub = q.data;
  const orders = usePaged(sub?.orders);
  const licencePages = usePaged([...(sub?.licences ?? [])].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)));
  if (q.isLoading) return <div className="space-y-6"><div className="h-16 animate-pulse rounded bg-muted" /><Panel><SkeletonRows rows={4} cols={3} /></Panel></div>;
  if (q.isError || !sub) return <ErrorState msg={errMsg(q.error, "Could not load your subscription.")} onRetry={() => q.refetch()} />;

  const pricing = sub.pricing;
  const outstanding = sub.orders.find((o) => o.status === "pending" || o.status === "partial");
  const methods = sub.paymentMethods.filter((m) => m.available);
  const daysLeft = sub.currentEndsAt ? Math.max(0, Math.ceil((Date.parse(sub.currentEndsAt) - Date.now()) / DAY_MS)) : 0;
  const usage = sub.learners.max ? Math.min(100, Math.round((sub.learners.active / sub.learners.max) * 100)) : null;

  const openPay = (order: LicenceOrder) => { setPayErr(null); setMethod(methods[0]?.id ?? null); setPaying(order); };
  // The smallest package that covers the school's learners today.
  const recommended = sub.packages.find((p) => p.fits) ?? null;
  const currentPkg = sub.packages.find((p) => p.current) ?? null;
  const choose = (planId: string, upgrade: boolean) => {
    renew.mutate({ data: { requestId: reqId.current, planId, ...(upgrade ? { upgrade: true } : {}) } }, {
      onSuccess: (o) => { reqId.current = crypto.randomUUID(); invalidateLicensing(qc); openPay(o); },
      onError: (x) => toast({ title: upgrade ? "Could not start the upgrade" : "Could not start the subscription", description: errMsg(x) }),
    });
  };
  const startRenewal = () => {
    if (outstanding) return openPay(outstanding);
    renew.mutate({ data: { requestId: reqId.current } }, {
      onSuccess: (o) => { reqId.current = crypto.randomUUID(); invalidateLicensing(qc); openPay(o); },
      onError: (x) => toast({ title: "Could not start renewal", description: errMsg(x) }),
    });
  };
  const pay = () => {
    if (!paying || !method) return;
    if (method === "manual") { setPaying(null); toast({ title: `Invoice ${paying.invoiceNumber}`, description: "Pay Rejista by bank transfer or cash and quote this invoice number. Access renews once the payment is recorded." }); return; }
    setPayErr(null);
    checkout.mutate({ orderId: paying.id, data: { requestId: crypto.randomUUID(), method, ...(method === "mpesa" ? { phone } : {}), ...(s.user.email ? { email: s.user.email } : {}) } }, {
      onSuccess: (c) => {
        if (c.redirectUrl) { window.location.assign(c.redirectUrl); return; }
        if (c.status === "pending") setWatching(c.id);
      },
      onError: (x) => setPayErr(errMsg(x)),
    });
  };
  const submitKey = () => {
    setKeyErr(null);
    redeem.mutate({ data: { code: code.trim() } }, {
      onSuccess: (l) => { setCode(""); invalidateLicensing(qc); toast({ title: "Licence key applied", description: `${days(l.durationDays)} added, until ${fmtDateTime(l.expiresAt)}.` }); },
      onError: (x) => setKeyErr(errMsg(x)),
    });
  };
  const licences = [...sub.licences].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const waitingMpesa = !!watching && watched?.provider === "mpesa" && watched.status === "pending";
  const choices = [...methods, ...sub.paymentMethods.filter((m) => m.id === "manual")].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);

  // Redeeming a prepaid key sits under whichever way of paying is on offer.
  const keyRow = isAdmin && (
        <div className="border-t border-border/60 px-5 py-3">
          {!keyOpen ? <button type="button" data-testid="button-have-key" onClick={() => setKeyOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><KeyRound className="h-3.5 w-3.5" />I have a licence key</button> : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <TextInput data-testid="input-licence-key" autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RJST-XXXX-XXXX-XXXX" className="font-mono uppercase tracking-wider" autoComplete="off" spellCheck={false} />
                <div className="mt-2"><FormError msg={keyErr} /></div>
              </div>
              <Btn data-testid="button-redeem-key" disabled={code.replace(/[^A-Z0-9]/gi, "").length < 12 || redeem.isPending} onClick={submitKey}>{redeem.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Apply key</Btn>
            </div>
          )}
        </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="School" title="Subscription" />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={cn("flex items-start gap-4 rounded-xl border p-5", sub.accessAllowed ? "border-primary/25 bg-primary/5" : "border-destructive/30 bg-destructive/5")} data-testid="subscription-coverage">
          <ShieldCheck className={cn("mt-0.5 h-6 w-6 shrink-0", sub.accessAllowed ? "text-primary" : "text-destructive")} />
          <div className="min-w-0">
            <div className="text-lg font-semibold">{sub.status === "trial" ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial` : sub.status === "active" ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining` : sub.accessAllowed ? "Active" : "Renewal needed"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{coverageText(sub)}{!isAdmin && !sub.accessAllowed && " Contact your school administrator to renew."}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-primary" />Active learners</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{sub.learners.active.toLocaleString()}<span className="text-base font-normal text-muted-foreground"> / {sub.learners.max ? sub.learners.max.toLocaleString() : "unlimited"}</span></div>
          {usage !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", usage >= 90 ? "bg-amber-500" : "bg-primary")} style={{ width: `${usage}%` }} /></div>}
        </div>
      </div>

      {sub.packages.length > 0 ? (
        <Panel title={sub.status === "active" ? "Your package" : "Choose a package"} note={`Packages go by how many learners you have. You have ${sub.learners.active.toLocaleString()} active learner${sub.learners.active === 1 ? "" : "s"}${recommended ? `, so ${recommended.name} fits` : ""}.`}>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="packages">
            {sub.packages.map((pkg) => {
              const best = !currentPkg && pkg.id === recommended?.id;
              return (
                <div key={pkg.id} data-testid={`package-${pkg.id}`} className={cn("flex flex-col rounded-xl border p-4", pkg.current ? "border-primary bg-primary/5" : best ? "border-primary/50" : "border-border", !pkg.fits && "opacity-60")}>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{pkg.name}</span>{pkg.current && <Pill tone="active">Current</Pill>}{best && <Pill tone="current">Fits your school</Pill>}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{pkg.maxLearners ? `Up to ${pkg.maxLearners.toLocaleString()} learners` : "Any number of learners"}</div>
                  <div className="mt-3 text-2xl font-semibold tracking-tight">{kes(pkg.price)}<span className="text-sm font-normal text-muted-foreground"> / {days(pkg.durationDays)}</span></div>
                  {pkg.description && <p className="mt-1 text-xs text-muted-foreground">{pkg.description}</p>}
                  <div className="mt-auto pt-4">
                    {!pkg.fits ? <p className="text-xs text-muted-foreground">Too small: you have {sub.learners.active.toLocaleString()} learners.</p>
                      : !isAdmin ? <p className="text-xs text-muted-foreground">Only school administrators can pay.</p>
                      : pkg.upgradePrice ? <Btn className="w-full" data-testid={`button-upgrade-${pkg.id}`} disabled={renew.isPending || !!outstanding} onClick={() => choose(pkg.id, true)}>Upgrade now · {kes(pkg.upgradePrice)}</Btn>
                      : <Btn className="w-full" variant={pkg.current || best ? undefined : "outline"} data-testid={`button-package-${pkg.id}`} disabled={renew.isPending || !!outstanding} onClick={() => choose(pkg.id, false)}>{sub.status === "active" ? (pkg.current ? "Renew" : "Renew on this package") : "Subscribe"}</Btn>}
                    {pkg.upgradePrice && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">The difference for the days left on your current licence.</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {outstanding && isAdmin && <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-5 py-3 text-sm"><span className="flex-1">You have an unpaid invoice for {outstanding.planName}. Pay or cancel it before choosing again.</span><Btn className="h-9" data-testid="button-pay-outstanding" onClick={() => openPay(outstanding)}>Pay {kes(outstanding.balance)}</Btn></div>}
          {keyRow}
        </Panel>
      ) : (
        <Panel title={sub.status === "trial" ? "Subscribe" : "Renew"}>
          {!pricing.configured ? <Empty icon={<ReceiptText className="h-5 w-5" />} title="Pricing not published" body="Rejista hasn't published subscription pricing yet. Contact support, or use a licence key below." /> : (
            <div className="flex flex-wrap items-center gap-5 px-5 py-5">
              <div className="min-w-0 flex-1">
                <div className="text-3xl font-semibold tracking-tight">{kes(pricing.price)}<span className="text-base font-normal text-muted-foreground"> / {pricing.periodLabel}</span></div>
                <p className="mt-1 text-sm text-muted-foreground">{days(pricing.periodDays)} of full access{pricing.maxLearners ? `, up to ${pricing.maxLearners.toLocaleString()} active learners` : ", unlimited learners"}. {sub.status === "active" ? "Renewing early adds time after your current end date." : "Access starts as soon as payment is confirmed."}</p>
              </div>
              {isAdmin
                ? <Btn data-testid="button-renew" className="h-11 px-6" disabled={renew.isPending} onClick={startRenewal}>{renew.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{outstanding ? `Pay ${kes(outstanding.balance)}` : sub.status === "active" ? "Renew" : "Subscribe"}</Btn>
                : <p className="text-xs text-muted-foreground">Only school administrators can pay.</p>}
            </div>
          )}
          {keyRow}
        </Panel>
      )}

      {(
        <Panel title="Invoices">
          {!sub.orders.length ? <Empty icon={<ReceiptText className="h-5 w-5" />} title="No invoices yet" body={isAdmin ? "Your invoices appear here when you pay." : "Your administrator has not paid online yet."} /> : <ul className="divide-y divide-border/60">{orders.rows.map((o) => (
            <li key={o.id} data-testid={`row-order-${o.id}`} className={cn("flex flex-wrap items-center gap-3 px-5 py-3", o.status === "cancelled" && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono">{o.invoiceNumber}</span>{o.status !== "paid" && <Pill tone={ORDER_TONE[o.status] ?? "inactive"}>{o.status}</Pill>}</div>
                <div className="text-xs text-muted-foreground">{fmtDate(o.createdAt)} · {days(o.durationDays)}</div>
              </div>
              <div className="text-right text-sm"><div className="font-semibold">{kes(o.price)}</div>{o.status === "partial" && <div className="text-xs text-muted-foreground">{kes(o.balance)} still due</div>}</div>
              {isAdmin && (o.status === "pending" || o.status === "partial") && <Btn className="h-8 px-3 text-xs" data-testid={`button-pay-order-${o.id}`} onClick={() => openPay(o)}>Pay</Btn>}
              {isAdmin && o.status === "pending" && <Btn variant="ghost" className="h-8 px-2.5 text-xs text-destructive" data-testid={`button-cancel-order-${o.id}`} onClick={() => { setCErr(null); setCancelling(o); }}><CircleSlash className="h-3.5 w-3.5" />Cancel</Btn>}
            </li>
          ))}</ul>}
          <Pager {...orders.pager} />
        </Panel>
      )}

      {licences.length > 0 && (
        <Panel title="Licence history">
          <ul className="divide-y divide-border/60">{licencePages.rows.map((l) => (
            <li key={l.id} className="px-5 py-3"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l.planName}<Pill tone={LIC_TONE[l.status] ?? "inactive"}>{l.status}</Pill></div><div className="text-xs text-muted-foreground">{fmtDate(l.startsAt)} to {fmtDate(l.expiresAt)} · {l.source === "key" ? "licence key" : l.source === "payment" ? "paid" : "issued by Rejista"}</div></li>
          ))}</ul>
          <Pager {...licencePages.pager} />
        </Panel>
      )}

      <FormDialog open={!!paying} onOpenChange={(o) => { if (!o && !waitingMpesa) setPaying(null); }} title={paying ? `Pay ${kes(paying.balance)}` : "Pay"} description={paying ? `Invoice ${paying.invoiceNumber} · ${paying.planName}` : undefined} busy={checkout.isPending || waitingMpesa} testid="dialog-pay">
        {paying && (waitingMpesa ? (
          <div className="space-y-3 p-6 text-center" data-testid="mpesa-waiting">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <div className="font-semibold">Check your phone</div>
            <p className="text-sm text-muted-foreground">Enter your M-Pesa PIN on {phone} to pay {kes(paying.balance)}. This page updates by itself.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid gap-2" role="radiogroup" aria-label="Payment method">
              {choices.map((m) => {
                const Icon = METHOD_ICON[m.id] ?? CreditCard;
                const on = method === m.id;
                return (
                  <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition", on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
                    <input type="radio" name="method" className="sr-only" checked={on} onChange={() => setMethod(m.id)} data-testid={`radio-method-${m.id}`} />
                    <Icon className={cn("h-5 w-5", on ? "text-primary" : "text-muted-foreground")} />
                    <span className="flex-1"><span className="block text-sm font-semibold">{m.name}</span>{m.id === "manual" && <span className="block text-xs text-muted-foreground">{m.reason}</span>}</span>
                  </label>
                );
              })}
            </div>
            {method === "mpesa" && <Field label="M-Pesa phone number" required><TextInput data-testid="input-mpesa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></Field>}
            {(method === "stripe" || method === "paystack") && <p className="text-xs text-muted-foreground">You'll go to a secure {method === "stripe" ? "Stripe" : "Paystack"} page and come back here once paid.</p>}
            <FormError msg={payErr} />
            <FormActions>
              <Btn data-testid="button-confirm-pay" disabled={!method || checkout.isPending || (method === "mpesa" && phone.replace(/\D/g, "").length < 9)} onClick={pay}>{checkout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{method === "manual" ? "Show invoice details" : method === "mpesa" ? "Send M-Pesa prompt" : "Continue to payment"}</Btn>
              <Btn variant="ghost" onClick={() => setPaying(null)}>Cancel</Btn>
            </FormActions>
          </div>
        ))}
      </FormDialog>

      <FormDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} size="sm" title="Cancel this invoice?" busy={cancel.isPending} testid="dialog-cancel-order">
        {cancelling && <div className="space-y-4 p-5">
          <p className="text-sm">Invoice {cancelling.invoiceNumber} for {kes(cancelling.price)} will be voided. Do not pay it after cancelling. Your current access is unaffected.</p>
          <FormError msg={cErr} />
          <FormActions>
            <Btn variant="danger" data-testid="button-confirm-cancel-order" disabled={cancel.isPending} onClick={() => cancel.mutate({ orderId: cancelling.id }, { onSuccess: () => { invalidateLicensing(qc); toast({ title: "Invoice cancelled" }); setCancelling(null); }, onError: (x) => setCErr(errMsg(x)) })}>{cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Cancel invoice</Btn>
            <Btn variant="ghost" onClick={() => setCancelling(null)}>Keep it</Btn>
          </FormActions>
        </div>}
      </FormDialog>
    </div>
  );
}
