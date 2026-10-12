import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSunpayConnection, useConnectSunpay, useDisconnectSunpay, getGetSunpayConnectionQueryKey, type SunpayConnectInputType } from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

/** M-Pesa through SunPay: the school registers the till or paybill it already has, with no Daraja account of its own. */
export function SunpayCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetSunpayConnection({ query: { queryKey: getGetSunpayConnectionQueryKey() } });
  const connect = useConnectSunpay();
  const disconnect = useDisconnectSunpay();
  const [f, setF] = useState<{ type: SunpayConnectInputType; shortcode: string; phone: string }>({ type: "till", shortcode: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: getGetSunpayConnectionQueryKey() });
  const s = q.data;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!/^\d{4,9}$/.test(f.shortcode.trim())) return setErr("Enter the till or paybill number: 4 to 9 digits.");
    connect.mutate({ data: { type: f.type, shortcode: f.shortcode.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) } }, {
      onSuccess: () => { refresh(); toast({ title: "Connected to SunPay", description: "Parents can now pay by M-Pesa." }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const kind = s?.type === "paybill" ? "paybill" : "till";
  return (
    <Panel title="Or collect through SunPay" note="For schools without a Daraja account: use the till or paybill you already have. If Daraja above is set up, it stays in charge of M-Pesa prompts.">
      {q.isLoading ? <SkeletonRows rows={2} cols={2} /> : q.isError || !s ? <ErrorState msg={errMsg(q.error, "Could not load the SunPay connection.")} onRetry={() => q.refetch()} />
        : s.connected ? (
          <div className="space-y-4 p-5" data-testid="sunpay-connected">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /><span className="font-semibold">Connected</span>
              <Pill tone="active">{kind} {s.shortcode}</Pill>
              {s.connectedAt && <span className="text-xs text-muted-foreground">since {fmtDate(s.connectedAt)}</span>}
              <Btn variant="ghost" className="ml-auto h-8 px-2.5 text-xs text-destructive" data-testid="button-sunpay-disconnect" onClick={() => setLeaving(true)}>Disconnect</Btn>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="h-4 w-4 text-primary" />From a prompt on the parent's phone</div>
                <p className="mt-1.5 text-sm text-muted-foreground">Use <b>Send M-Pesa prompt</b> on the Payments page. The parent enters their PIN and the payment goes straight to that learner, with a receipt.</p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <div className="text-sm font-semibold">From the M-Pesa menu</div>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                  <li>Lipa na M-Pesa → Pay Bill</li>
                  <li>Business no: <b className="text-foreground">{s.collectionPaybill ?? "SunPay's paybill (ask Rejista for the number)"}</b></li>
                  <li>Account no: <b className="text-foreground">{s.shortcode}#</b>admission number, e.g. <b className="text-foreground">{s.shortcode}#ADM123</b></li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">Your number tells SunPay which school; the admission number after the # tells Rejista which learner. If a parent leaves the admission number out, the payment is matched by their phone number, or waits under Payments → Needs a learner.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">SunPay keeps {s.feePercent}% of each payment and sends the rest to your {kind}. The learner is still credited with the full amount the parent paid.</p>
          </div>
        ) : !s.available ? (
          <p className="p-5 text-sm text-muted-foreground" data-testid="sunpay-unavailable">SunPay isn't switched on for Rejista yet. Contact Rejista support, or use your own Daraja account above.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5" data-testid="sunpay-connect-form">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Your school has a" required><NativeSelect data-testid="select-sunpay-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as SunpayConnectInputType })}><option value="till">Till (Buy Goods)</option><option value="paybill">Paybill</option></NativeSelect></Field>
              <Field label={f.type === "till" ? "Till number" : "Paybill number"} required hint="Where the money should end up."><TextInput data-testid="input-sunpay-shortcode" inputMode="numeric" required value={f.shortcode} onChange={(e) => setF({ ...f, shortcode: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></Field>
              <Field label="Contact phone" hint="Optional. The person SunPay can reach."><TextInput data-testid="input-sunpay-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0712 345 678" /></Field>
            </div>
            <p className="text-xs text-muted-foreground">SunPay keeps {s.feePercent}% of each payment and sends the rest to this number. A number can be registered to one school only.</p>
            <FormError msg={err} />
            <FormActions><Btn data-testid="button-sunpay-connect" type="submit" disabled={connect.isPending}>{connect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Connect</Btn></FormActions>
          </form>
        )}
      <FormDialog open={leaving} onOpenChange={setLeaving} size="sm" title="Disconnect SunPay?" busy={disconnect.isPending}>
        <div className="space-y-4 p-5">
          <p className="text-sm">M-Pesa prompts will stop, and payments to SunPay's paybill will no longer reach your books. Payments already recorded stay as they are. You can reconnect the same number later.</p>
          <FormActions>
            <Btn variant="danger" data-testid="button-sunpay-confirm-disconnect" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => { refresh(); setLeaving(false); toast({ title: "SunPay disconnected" }); }, onError: (x) => toast({ title: "Could not disconnect", description: errMsg(x), variant: "destructive" }) })}>{disconnect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Disconnect</Btn>
            <Btn variant="ghost" onClick={() => setLeaving(false)}>Keep it</Btn>
          </FormActions>
        </div>
      </FormDialog>
    </Panel>
  );
}
