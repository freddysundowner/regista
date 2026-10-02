import { useState, type FormEvent } from "react";
import { useStartStkPayment, useGetStkPaymentStatus, getGetStkPaymentStatusQueryKey } from "@workspace/api-client-react";
import { Loader2, Smartphone } from "lucide-react";
import { Panel, Btn, Field, TextInput, FormError, FormActions, Pill } from "@/components/kit";
import { StudentPicker, MoneyInput, Money } from "@/components/finance-kit";
import { errMsg } from "@/lib/session";
import { useFinanceInvalidate, useIdemKey, validMoney } from "@/lib/finance";

const WAITING = ["submitting", "pending", "awaiting_receipt"];
const LABEL: Record<string, { tone: string; text: string }> = {
  submitting: { tone: "current", text: "Sending prompt" },
  pending: { tone: "duplicate", text: "Prompt accepted by Safaricom; waiting for the payer. Not paid yet." },
  awaiting_receipt: { tone: "duplicate", text: "Payer approved; waiting for the M-Pesa confirmation before posting. Not paid yet." },
  submission_unknown: { tone: "error", text: "Unknown whether the prompt was sent. Do not resend; check incoming payments shortly." },
  failed: { tone: "error", text: "Prompt failed or was cancelled. Nothing was paid." },
  paid: { tone: "active", text: "Paid and posted to the learner's account." },
};

function Status({ id, startedAt }: { id: string; startedAt: number }) {
  const inv = useFinanceInvalidate();
  const q = useGetStkPaymentStatus(id, { query: { queryKey: getGetStkPaymentStatusQueryKey(id),
    refetchInterval: (query) => { const s = query.state.data?.status; if (s === "paid") inv(); return s && WAITING.includes(s) && Date.now() - startedAt < 180000 ? 4000 : false; } } });
  const s = q.data?.status ?? "submitting";
  const l = LABEL[s] ?? { tone: "left", text: s.replace(/_/g, " ") };
  const timedOut = WAITING.includes(s) && Date.now() - startedAt >= 180000;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-5 py-3 text-sm" aria-live="polite">
      {WAITING.includes(s) && !timedOut && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      <Pill tone={l.tone}>{s.replace(/_/g, " ")}</Pill><span>{l.text}</span>{q.data && <Money v={q.data.amount} className="ml-auto" />}
      {q.isError && <span className="text-destructive">{errMsg(q.error)}</span>}
      {timedOut && <Btn variant="outline" className="h-7 px-2 text-xs" onClick={() => q.refetch()}>Check again</Btn>}
    </div>
  );
}

/** M-Pesa STK push for a learner already on the register. Acceptance is never treated as payment. */
export function StkPanel() {
  const m = useStartStkPayment();
  const [f, setF] = useState({ studentId: "", phone: "", amount: "" });
  const [req, setReq] = useState<{ id: string; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId) return setErr("Choose the learner the payment is for.");
    if (!/^(\+?254|0)[17]\d{8}$/.test(f.phone.replace(/\s/g, ""))) return setErr("Enter a Safaricom number, e.g. 0712 345 678.");
    if (!validMoney(f.amount)) return setErr("Enter the amount.");
    m.mutate({ data: { studentId: f.studentId, phone: f.phone.replace(/\s/g, ""), amount: f.amount.trim(), idempotencyKey: idem.key } }, {
      onSuccess: (r) => { setReq({ id: r.id, at: Date.now() }); idem.renew(); },
      onError: (x) => setErr(`${errMsg(x)} Retrying with the same details will not send a second charge.`),
    });
  };
  return (
    <Panel title="M-Pesa prompt" note="Sends an STK push to the payer's phone. Daraja sandbox and live acceptance are not verified on this install.">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StudentPicker label="Pay for learner" value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
          <Field label="Payer phone" required><TextInput type="tel" data-testid="input-stk-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0712 345 678" /></Field>
          <Field label="Amount (KES)" required><MoneyInput testid="input-stk-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}Send prompt</Btn>{req && <Btn type="button" variant="ghost" onClick={() => { setReq(null); setF({ studentId: "", phone: "", amount: "" }); }}>New prompt</Btn>}</FormActions>
      </form>
      {req && <Status id={req.id} startedAt={req.at} />}
    </Panel>
  );
}
