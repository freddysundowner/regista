import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStartStkPayment, useGetStkPaymentStatus, getGetStkPaymentStatusQueryKey, useGetStudentFinanceHistory, getGetStudentFinanceHistoryQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { Btn, Field, TextInput, FormError, FormActions } from "@/components/kit";
import { StudentPicker, MoneyInput, Money } from "@/components/finance-kit";
import { errMsg } from "@/lib/session";
import { FormDialog } from "@/components/form-dialog";

import { kes, useFinanceInvalidate, useIdemKey, validMoney } from "@/lib/finance";

const WAITING = ["submitting", "pending", "awaiting_receipt", "processing", "received"];
// What the person waiting by the screen needs to know at each stage. A prompt being accepted is never treated as payment.
const LABEL: Record<string, { tone: "wait" | "ok" | "bad"; text: string }> = {
  submitting: { tone: "wait", text: "Sending the prompt…" },
  pending: { tone: "wait", text: "Waiting for the parent to enter their M-Pesa PIN." },
  awaiting_receipt: { tone: "wait", text: "Approved. Waiting for M-Pesa to confirm." },
  received: { tone: "wait", text: "M-Pesa confirmed. Adding it to the learner's account…" },
  processing: { tone: "wait", text: "M-Pesa confirmed. Adding it to the learner's account…" },
  paid: { tone: "ok", text: "Paid and added to the learner's account." },
  failed: { tone: "bad", text: "The prompt was cancelled or failed. Nothing was paid." },
  submission_unknown: { tone: "bad", text: "We couldn't confirm the prompt was sent. Don't send another; check Payments in a few minutes." },
  reconciliation_required: { tone: "bad", text: "Paid, but it needs checking under Payments → Needs a learner." },
};

function Status({ id, startedAt }: { id: string; startedAt: number }) {
  const inv = useFinanceInvalidate();
  const q = useGetStkPaymentStatus(id, { query: { queryKey: getGetStkPaymentStatusQueryKey(id),
    refetchInterval: (query) => { const s = query.state.data?.status; if (s === "paid") inv(); return s && WAITING.includes(s) && Date.now() - startedAt < 180000 ? 4000 : false; } } });
  const s = q.data?.status ?? "submitting";
  const l = LABEL[s] ?? { tone: "wait" as const, text: s.replace(/_/g, " ") };
  const timedOut = WAITING.includes(s) && Date.now() - startedAt >= 180000;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-5 py-3 text-sm" aria-live="polite">
      {l.tone === "wait" && !timedOut ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : l.tone === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}
      <span className={l.tone === "bad" ? "text-amber-800" : ""}>{timedOut ? "Still waiting for the parent. You can check again." : l.text}</span>{q.data && <Money v={q.data.amount} className="ml-auto" />}
      {q.isError && <span className="text-destructive">{errMsg(q.error)}</span>}
      {timedOut && <Btn variant="outline" className="h-7 px-2 text-xs" onClick={() => q.refetch()}>Check again</Btn>}
    </div>
  );
}

/** M-Pesa STK push for a learner already on the register. Acceptance is never treated as payment. */
export function StkPanel() {
  const [open, setOpen] = useState(false);
  return <>
    <Btn variant="outline" data-testid="button-open-stk" onClick={() => setOpen(true)}><Smartphone className="h-4 w-4" /> Send M-Pesa prompt</Btn>
    <FormDialog open={open} onOpenChange={setOpen} size="lg" title="Send an M-Pesa prompt" description="The parent gets a pop-up on their phone to pay with their M-Pesa PIN.">
      <StkForm onClose={() => setOpen(false)} />
    </FormDialog>
  </>;
}

/** With `studentId` the learner is fixed and `phone` prefilled, for use on the learner page. */
export function StkForm({ onClose, studentId, phone }: { onClose: () => void; studentId?: string; phone?: string }) {
  const m = useStartStkPayment();
  const [f, setF] = useState({ studentId: studentId ?? "", phone: phone ?? "", amount: "" });
  const [phones, setPhones] = useState<string[]>([]);
  // Once a learner is chosen, offer what they owe as the amount (only if nothing was typed yet).
  const fin = useGetStudentFinanceHistory(f.studentId, { query: { queryKey: getGetStudentFinanceHistoryQueryKey(f.studentId), enabled: !!f.studentId } });
  const owes = fin.data && Number(fin.data.balance) > 0 ? fin.data.balance : null;
  const filledFor = useRef("");
  useEffect(() => {
    if (!owes || filledFor.current === f.studentId) return;
    filledFor.current = f.studentId;
    setF((x) => (x.amount ? x : { ...x, amount: Number(owes).toFixed(2) }));
  }, [owes, f.studentId]);
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
      onError: (x) => setErr(`${errMsg(x)} Trying again with the same details won't charge twice.`),
    });
  };
  return (
    <div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {!studentId && <StudentPicker label="Learner" value={f.studentId} onChange={(v) => setF((x) => ({ ...x, studentId: v }))} onPick={(st) => { filledFor.current = ""; setPhones(st.guardianPhones); setF((x) => ({ ...x, phone: st.guardianPhones[0] ?? x.phone, amount: "" })); }} />}
          <Field label="Parent's phone" required><TextInput type="tel" data-testid="input-stk-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0712 345 678" />
            {phones.length > 1 && <div className="mt-1.5 flex flex-wrap gap-1.5">{phones.map((ph) => <button key={ph} type="button" onClick={() => setF({ ...f, phone: ph })} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${f.phone === ph ? "bg-primary text-primary-foreground ring-primary" : "ring-border hover:bg-muted"}`}>{ph}</button>)}</div>}
          </Field>
          <Field label="Amount (KES)" required hint={f.studentId && fin.data ? (owes ? `Owes ${kes(owes)}` : "Nothing owed right now") : undefined}><MoneyInput testid="input-stk-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="submit" data-testid="button-send-stk" disabled={m.isPending || !!req}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}Send prompt</Btn>{req && <Btn type="button" variant="ghost" onClick={() => { setReq(null); setF({ studentId: studentId ?? "", phone: phone ?? "", amount: "" }); }}>New prompt</Btn>}<Btn type="button" variant="ghost" onClick={onClose}>{req ? "Done" : "Cancel"}</Btn></FormActions>
      </form>
      {req && <Status id={req.id} startedAt={req.at} />}
    </div>
  );
}
