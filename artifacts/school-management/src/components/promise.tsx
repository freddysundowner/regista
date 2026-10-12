import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePaymentPromise, getGetFinanceArrearsQueryKey, getGetFinanceSummaryQueryKey, type PaymentPromise } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Btn, Field, TextInput, FormError, FormActions } from "@/components/kit";
import { MoneyInput } from "@/components/finance-kit";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { validMoney } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ks = (v?: string | null) => `KES ${Math.round(Number(v ?? 0)).toLocaleString("en-KE")}`;

/** "Promised KES 5,000 by 16 Oct" / "Promise broken" / "Promise kept", in one short coloured line. */
export function PromiseLine({ p, className }: { p?: PaymentPromise | null; className?: string }) {
  if (!p || p.state === "cancelled") return null;
  const text = p.state === "kept" ? `Kept promise of ${ks(p.amount)}` : p.state === "broken" ? `Broken promise: ${ks(p.amount)} by ${fmtDate(p.promisedFor)}` : `Promised ${ks(p.amount)} by ${fmtDate(p.promisedFor)}`;
  return <span className={cn("text-[11px] font-medium", p.state === "broken" ? "text-destructive" : p.state === "kept" ? "text-primary" : "text-amber-700", className)} title={p.note ?? undefined}>{text}</span>;
}

/** Record what a parent promised: an amount and a date. A new promise replaces the previous one. */
export function PromiseForm({ studentId, suggested, onDone }: { studentId: string; suggested?: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreatePaymentPromise();
  const [f, setF] = useState({ amount: suggested && Number(suggested) > 0 ? String(Math.round(Number(suggested))) : "", promisedFor: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!validMoney(f.amount) || Number(f.amount) <= 0) return setErr("Enter the amount the parent promised.");
    if (!f.promisedFor) return setErr("Choose the date they promised to pay by.");
    m.mutate({ data: { studentId, amount: f.amount.trim(), promisedFor: f.promisedFor, ...(f.note.trim() ? { note: f.note.trim() } : {}) } }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetFinanceArrearsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() }); toast({ title: "Promise recorded", description: "It shows as kept once the payments add up, or broken if the date passes first." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount promised (KES)" required><MoneyInput testid="input-promise-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Will pay by" required><TextInput type="date" data-testid="input-promise-date" min={localToday()} value={f.promisedFor} onChange={(e) => setF({ ...f, promisedFor: e.target.value })} /></Field>
        <Field label="Note" className="sm:col-span-2"><TextInput value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Said on the phone, will pay after harvest" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending} data-testid="button-save-promise">{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save promise</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}
