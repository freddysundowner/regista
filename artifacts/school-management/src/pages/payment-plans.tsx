import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListPaymentPlans, useCreatePaymentPlan, useDecidePaymentPlan, getListPaymentPlansQueryKey, type PlanView, type DecisionInputDecision } from "@workspace/api-client-react";
import { CalendarClock, Loader2, Plus, X } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useStudentNames, useTermNames, Money, MoneyInput, StudentPicker, TermSelect, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDate, nairobiToday } from "@/lib/session";
import { useFinanceInvalidate, validMoney, sumMoney } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

const TONE: Record<string, string> = { proposed: "duplicate", active: "current", completed: "active", rejected: "error", defaulted: "error", paid: "active", overdue: "error", due: "duplicate", partially_paid: "duplicate", upcoming: "left" };

function useInv() { const qc = useQueryClient(); const fin = useFinanceInvalidate(); return () => { fin(); qc.invalidateQueries({ queryKey: getListPaymentPlansQueryKey() }); }; }

function NewPlan({ onDone }: { onDone: () => void }) {
  const m = useCreatePaymentPlan(); const inv = useInv(); const { toast } = useToast();
  const [f, setF] = useState({ studentId: "", termId: "" });
  const [rows, setRows] = useState([{ dueDate: nairobiToday(), amount: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId || !f.termId) return setErr("Choose the learner and term.");
    if (rows.some((r) => !r.dueDate || !validMoney(r.amount))) return setErr("Each instalment needs a date and amount.");
    if (new Set(rows.map((r) => r.dueDate)).size !== rows.length) return setErr("Instalment dates must be different.");
    m.mutate({ data: { ...f, installments: [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((r) => ({ dueDate: r.dueDate, amount: r.amount.trim() })) } }, {
      onSuccess: () => { inv(); toast({ title: "Plan proposed", description: "It becomes active once a principal or administrator approves it." }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
        <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
        <div className="space-y-2 sm:col-span-2 lg:col-span-4">
          {rows.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={`Instalment ${i + 1} due`} required><TextInput type="date" value={r.dueDate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} /></Field>
              <Field label="Amount (KES)" required><MoneyInput value={r.amount} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></Field>
              <button type="button" aria-label="Remove instalment" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="mb-1 rounded p-2 text-muted-foreground hover:text-destructive disabled:opacity-30"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between"><Btn type="button" variant="ghost" className="h-8" disabled={rows.length >= 24} onClick={() => setRows([...rows, { dueDate: "", amount: "" }])}><Plus className="h-3.5 w-3.5" />Add instalment</Btn><span className="text-sm">Total <Money v={sumMoney(rows.map((r) => r.amount))} className="font-semibold" /></span></div>
        </div>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Propose plan</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function Decide({ plan }: { plan: PlanView }) {
  const m = useDecidePaymentPlan(); const inv = useInv(); const { toast } = useToast();
  const [d, setD] = useState<"" | DecisionInputDecision>(""); const [reason, setReason] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (!d || reason.trim().length < 3) return void toast({ title: "Choose a decision and give a reason", variant: "destructive" });
      m.mutate({ id: plan.id, data: { decision: d, reason: reason.trim() } }, { onSuccess: () => { inv(); toast({ title: `Plan ${d}` }); }, onError: (x) => toast({ title: "Could not decide", description: errMsg(x), variant: "destructive" }) }); }}>
      <NativeSelect aria-label="Decision" className="h-7 w-28 text-xs" value={d} onChange={(e) => setD(e.target.value as typeof d)}><option value="">Decide</option><option value="approved">Approve</option><option value="rejected">Reject</option></NativeSelect>
      {d && <><TextInput aria-label="Reason" placeholder="Reason" className="h-7 w-32 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /><Btn type="submit" className="h-7 px-2 text-xs" disabled={m.isPending}>Save</Btn></>}
    </form>
  );
}

export function PlanTable({ plans, decide }: { plans: PlanView[]; decide?: boolean }) {
  const sname = useStudentNames(); const term = useTermNames();
  return (
    <Table head={["Learner", "Term", "Total", "Instalments", "Status", ""]}>{plans.map((p) => (
      <tr key={p.id} data-testid={`row-plan-${p.id}`}><td className={td}>{sname(p.studentId)}{p.requestedVia && <div className="text-[11px] text-muted-foreground">via {p.requestedVia}</div>}</td><td className={`${td} text-xs`}>{term(p.termId)}</td><td className={td}><Money v={p.totalAmount} /></td>
        <td className={`${td} text-xs`}>{p.installments.map((i) => <div key={i.id} className="flex items-center gap-2 py-0.5"><span className="w-24">{fmtDate(i.dueDate)}</span><Money v={i.amount} /><span className="text-muted-foreground">paid {i.amountPaid}</span><Pill tone={TONE[i.status] ?? "left"}>{i.status.replace(/_/g, " ")}</Pill></div>)}</td>
        <td className={td}><Pill tone={TONE[p.status] ?? "left"}>{p.status}</Pill></td><td className={td}>{decide && p.status === "proposed" && <Decide plan={p} />}</td></tr>))}</Table>
  );
}

export default function PaymentPlans() {
  const p = usePerms();
  const q = useListPaymentPlans({ query: { queryKey: getListPaymentPlansQueryKey() } });
  const [open, setOpen] = useState(false); const [st, setSt] = useState("");
  const list = (q.data ?? []).filter((x) => !st || x.status === st);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Collections" title="Payment plans" meta="Instalment agreements. Proposed by the bursar or a parent, approved by the principal or administrator.">
        {p.bursar && !open && <Btn data-testid="button-new-plan" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New plan</Btn>}
      </PageHeader>
      {open && <Panel title="Propose plan" note="A learner can have one proposed or active plan. The total cannot exceed the outstanding balance."><NewPlan onDone={() => setOpen(false)} /></Panel>}
      <Panel action={<NativeSelect aria-label="Status" className="h-8 w-36 text-xs" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All plans</option>{["proposed", "active", "completed", "defaulted", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>} title="Plans">
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<CalendarClock className="h-5 w-5" />} title="No plans" body="Plans that parents request through the bot also appear here." /> : <PlanTable plans={list} decide={p.planDecide} />}
      </Panel>
    </div>
  );
}
