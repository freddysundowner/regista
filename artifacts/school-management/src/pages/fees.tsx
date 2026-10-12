import { useState, type FormEvent } from "react";
import { Redirect } from "wouter";
import { Pager, usePaged } from "@/components/pager";
import { useCreateFinanceRecord, useUpdateFinanceRecord, type FinanceRecord } from "@workspace/api-client-react";
import { Loader2, Plus, Receipt } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, FormActions } from "@/components/kit";
import { useFinanceRecords, useStudentNames, useTermNames, useFeeItemNames, StatusPill, Money, MoneyInput, StudentPicker, TermSelect, Table, td } from "@/components/finance-kit";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { useIdemKey, useFinanceInvalidate, validMoney, rd } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

/** Rename a fee item, or change which items a payment clears first. */
export function FeeItemEdit({ item, onDone }: { item: FinanceRecord; onDone: () => void }) {
  const upd = useUpdateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [f, setF] = useState({ name: rd(item, "name") ?? "", priority: rd(item, "priority") ?? "1", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const priority = Number(f.priority);
    if (f.name.trim().length < 2) return setErr("Give the item a name.");
    if (!Number.isInteger(priority) || priority < 1) return setErr("Use a whole number from 1. Payments clear 1 first.");
    if (f.reason.trim().length < 3) return setErr("Say why you're changing it; it's kept in the audit log.");
    upd.mutate({ id: item.id, data: { name: f.name.trim(), priority, reason: f.reason.trim() } }, {
      onSuccess: () => { inv(); toast({ title: "Fee item saved" }); onDone(); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><TextInput data-testid="input-fee-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Payment order" required hint="When a parent pays part of the fees, item 1 is cleared first, then 2…"><TextInput data-testid="input-fee-priority" type="number" min={1} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
        <Field label="Reason for the change" required className="sm:col-span-2"><TextInput data-testid="input-fee-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-fee-item" disabled={upd.isPending}>{upd.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

/** Extras only some learners pay (transport, lunch, clubs). Typing a new charge name creates it. */
export function OptionalCharges({ canEdit }: { canEdit: boolean }) {
  const q = useFinanceRecords({ kind: "optional_charge" });
  const chargePages = usePaged(q.data);
  const sname = useStudentNames(); const item = useFeeItemNames(); const term = useTermNames();
  const create = useCreateFinanceRecord();
  const upd = useUpdateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const items = useFinanceRecords({ kind: "fee_item" });
  const optionalItems = (items.data ?? []).filter((r) => r.status === "active" && r.data?.isOptional);
  const [f, setF] = useState({ studentId: "", itemName: "", amount: "", startDate: localToday(), termId: "", endDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const [ending, setEnding] = useState<{ id: string; endDate: string; reason: string } | null>(null);
  const [endErr, setEndErr] = useState<string | null>(null);
  const endingRec = q.data?.find((r) => r.id === ending?.id);
  const idem = useIdemKey(JSON.stringify(f));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const name = f.itemName.trim();
    if (!f.studentId || name.length < 2) return setErr("Choose the learner and say what the charge is for.");
    if (!validMoney(f.amount)) return setErr("Enter an amount like 3500 or 3500.50.");
    if (f.endDate && f.endDate < f.startDate) return setErr("The end date is before the start date.");
    try {
      let item = optionalItems.find((r) => String(r.data?.name ?? "").toLowerCase() === name.toLowerCase());
      if (!item) {
        const code = `${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "EXTRA"}${(items.data?.length ?? 0) + 1}`;
        item = await create.mutateAsync({ data: { kind: "fee_item", idempotencyKey: crypto.randomUUID(), name, code, priority: (items.data?.length ?? 0) + 1, isOptional: true } });
      }
      await create.mutateAsync({ data: { kind: "optional_charge", idempotencyKey: idem.key, studentId: f.studentId, feeItemId: item.id, amount: f.amount.trim(), startDate: f.startDate, ...(f.termId ? { termId: f.termId } : {}), ...(f.endDate ? { endDate: f.endDate } : {}) } });
      idem.renew(); inv(); toast({ title: "Charge added", description: "It's added to this learner's invoices from now on." }); setOpen(false); setF({ ...f, studentId: "", amount: "" });
    } catch (x) { setErr(errMsg(x)); inv(); }
  };
  return (
    <Panel title="Optional charges" note="Extras only some learners pay, like transport or lunch. They're added to those learners' invoices." action={canEdit ? <Btn variant="outline" className="h-8" data-testid="button-new-charge" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add charge</Btn> : undefined}>
      <FormDialog open={open} onOpenChange={setOpen} busy={create.isPending} size="lg" title="Add an optional charge" description="Added to this learner's invoices between the start and end dates.">
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
            <Field label="Charge for" required hint="Pick one you've used before, or type a new one"><TextInput data-testid="input-charge-item" list="optional-items" value={f.itemName} onChange={(e) => setF({ ...f, itemName: e.target.value })} placeholder="e.g. Transport" />
              <datalist id="optional-items">{optionalItems.map((r) => <option key={r.id} value={String(r.data?.name ?? "")} />)}</datalist></Field>
            <Field label="Amount per term (KES)" required><MoneyInput testid="input-charge-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
            <Field label="Starts" required><TextInput type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Ends"><TextInput type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            <TermSelect value={f.termId} allowNone="Every term between those dates" onChange={(v) => setF({ ...f, termId: v })} />
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-charge" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add charge</Btn><Btn type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
      <FormDialog open={!!ending} onOpenChange={(o) => { if (!o) setEnding(null); }} busy={upd.isPending} size="sm" title="Stop this charge" description={endingRec ? `${sname(endingRec.studentId)} · ${item(rd(endingRec, "feeItemId"))}` : undefined}>
        {ending && <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (ending.reason.trim().length < 3 || !ending.endDate) return setEndErr("End date and a reason of at least 3 characters are required."); setEndErr(null); upd.mutate({ id: ending.id, data: { endDate: ending.endDate, reason: ending.reason.trim() } }, { onSuccess: () => { inv(); setEnding(null); toast({ title: "Charge end date set" }); }, onError: (x) => setEndErr(errMsg(x)) }); }}>
          <Field label="End date" required><TextInput data-testid="input-charge-end" type="date" value={ending.endDate} onChange={(e) => setEnding({ ...ending, endDate: e.target.value })} /></Field>
          <Field label="Reason" required><TextInput data-testid="input-charge-end-reason" value={ending.reason} onChange={(e) => setEnding({ ...ending, reason: e.target.value })} /></Field>
          <FormError msg={endErr} />
          <FormActions><Btn type="submit" data-testid="button-save-charge-end" disabled={upd.isPending}>{upd.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Set end date</Btn><Btn type="button" variant="ghost" onClick={() => setEnding(null)}>Cancel</Btn></FormActions>
        </form>}
      </FormDialog>
      {q.isLoading ? <SkeletonRows rows={3} cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Receipt className="h-5 w-5" />} title="No optional charges" body="Add one for each learner who takes transport, lunch or another extra." /> : (
        <Table head={["Learner", "Charge", "Amount", "When", "Status", ""]}>{chargePages.rows.map((r) => (
          <tr key={r.id} data-testid={`row-charge-${r.id}`}>
            <td className={td}>{sname(r.studentId)}</td><td className={td}>{item(rd(r, "feeItemId"))}</td><td className={td}><Money v={r.amount} /></td>
            <td className={`${td} text-xs`}>{fmtDate(rd(r, "startDate"))} to {rd(r, "endDate") ? fmtDate(rd(r, "endDate")) : "open"}{r.termId && <div className="text-muted-foreground">{term(r.termId)}</div>}</td>
            <td className={td}><StatusPill status={r.status} /></td>
            <td className={td}>{canEdit && <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-end-charge-${r.id}`} onClick={() => { setEndErr(null); setEnding({ id: r.id, endDate: localToday(), reason: "" }); }}>Stop</Btn>}</td>
          </tr>))}</Table>
      )}
      <Pager {...chargePages.pager} />
    </Panel>
  );
}

/** Everything that was here now lives on the Fee setup page. */
export default function Fees() {
  return <Redirect to="/fee-structure" replace />;
}
