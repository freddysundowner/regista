import { useState, useEffect, type FormEvent } from "react";
import { Redirect } from "wouter";
import { Pager, usePaged, useServerPage } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListIncomingPayments, useIngestIncomingPayment, useListPaymentExceptions, useResolvePaymentException, usePreviewBankStatement, useReconcileStatement,
  useListReconciliationRuns, useAllocateSponsorPayment, useListStudents, getListStudentsQueryKey, useListSponsorBatches, getListSponsorBatchesQueryKey,
  getListIncomingPaymentsQueryKey, getListPaymentExceptionsQueryKey, getListReconciliationRunsQueryKey,
  type IncomingPaymentView, type ExceptionView, type ResolutionInputAction, type IncomingInput, type IncomingInputChannel, type StatementFileInputFormat, type SponsorInputType,
} from "@workspace/api-client-react";
import { ArrowLeftRight, FileSpreadsheet, HandCoins, Loader2, Plus, Upload, X } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { useFinanceRecords, useStudentNames, Money, MoneyInput, StudentPicker, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime, localToday } from "@/lib/session";
import { useFinanceInvalidate, useIdemKey, validMoney, sumMoney, toCents, kes } from "@/lib/finance";
import { readSheet, fileBase64 } from "@/lib/sheets";
import { CollectionRefundsPanel, SponsorBatchesPanel } from "@/components/collections-extra";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const PAY_TONE: Record<string, string> = { matched: "active", received: "current", unmatched: "error", suspended: "duplicate", sponsor_pending: "duplicate", duplicate: "inactive" };
const CH: Record<string, string> = { mpesa_c2b: "M-Pesa paybill", mpesa_stk: "M-Pesa prompt", bank: "Bank" };

function useReconInvalidate() {
  const qc = useQueryClient(); const fin = useFinanceInvalidate();
  return () => { fin(); [getListIncomingPaymentsQueryKey(), getListPaymentExceptionsQueryKey(), getListReconciliationRunsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k })); qc.invalidateQueries({ predicate: (q) => /^\/api\/(payments\/incoming|reconciliation|approvals)/.test(String(q.queryKey[0])) }); };
}

type Split = { studentId: string; amount: string };
function SplitRows({ rows, onChange }: { rows: Split[]; onChange: (r: Split[]) => void }) {
  const sname = useStudentNames();
  const [pick, setPick] = useState("");
  return (
    <div className="col-span-full space-y-2">
      {rows.map((r, i) => (
        <div key={r.studentId} className="grid items-end gap-2 rounded-md border border-border/70 p-2 sm:grid-cols-[2fr_1fr_auto]">
          <div className="pb-2 text-sm">{sname(r.studentId)}</div>
          <Field label="Amount (KES)" required><MoneyInput value={r.amount} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></Field>
          <button type="button" aria-label="Remove" className="mb-1 rounded p-2 text-muted-foreground hover:text-destructive" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="grid items-end gap-2 sm:grid-cols-[3fr_auto]">
        <StudentPicker label="Add learner" required={false} value={pick} onChange={setPick} />
        <Btn type="button" variant="outline" disabled={!pick || rows.some((r) => r.studentId === pick)} onClick={() => { onChange([...rows, { studentId: pick, amount: "" }]); setPick(""); }}><Plus className="h-4 w-4" />Add</Btn>
      </div>
    </div>
  );
}

function Resolve({ ex, pay, onDone }: { ex: ExceptionView; pay?: IncomingPaymentView; onDone: () => void }) {
  const m = useResolvePaymentException();
  const inv = useReconInvalidate();
  const { toast } = useToast();
  // Siblings sharing one payment: start with an equal split (to the cent) that the bursar can adjust.
  const equalSplit = (): Split[] => {
    const ids = ex.candidates.map((c) => c.studentId);
    if (!pay || ids.length < 2) return [];
    const cents = Math.round(Number(pay.amount) * 100), base = Math.floor(cents / ids.length);
    return ids.map((studentId, i) => ({ studentId, amount: ((base + (i === 0 ? cents - base * ids.length : 0)) / 100).toFixed(2) }));
  };
  const siblings = ex.reason === "multiple_siblings" && ex.candidates.length > 1;
  const [action, setActionRaw] = useState<ResolutionInputAction>(siblings ? "split" : "assign");
  const [student, setStudent] = useState(ex.candidates[0]?.studentId ?? "");
  const [rows, setRows] = useState<Split[]>(() => siblings ? equalSplit() : []);
  const setAction = (a: ResolutionInputAction) => { setActionRaw(a); if (a === "split" && !rows.length) setRows(equalSplit()); };
  const [reason, setReason] = useState("");
  const [learn, setLearn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (reason.trim().length < 3) return setErr("Give a reason; it is kept in the audit trail.");
    let allocations: Split[] | undefined;
    if (action === "assign") { if (!student || !pay) return setErr("Choose the learner."); allocations = [{ studentId: student, amount: pay.amount }]; }
    if (action === "split") {
      if (rows.length < 2 || rows.some((r) => !validMoney(r.amount))) return setErr("Add at least two learners with valid amounts.");
      if (pay && toCents(sumMoney(rows.map((r) => r.amount))) !== toCents(pay.amount)) return setErr(`Split must total exactly ${kes(pay.amount)}.`);
      allocations = rows;
    }
    m.mutate({ id: ex.id, data: { action, reason: reason.trim(), ...(allocations ? { allocations } : {}), ...(action === "assign" && learn ? { learnAlias: true } : {}) } }, {
      onSuccess: (r) => { inv(); toast({ title: action === "suspense" ? "Kept in suspense" : "Payment resolved", description: r.message }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const sname = useStudentNames();
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Action" required><NativeSelect data-testid="select-resolve-action" value={action} onChange={(e) => setAction(e.target.value as ResolutionInputAction)}>
          <option value="assign">Assign to one learner</option><option value="split">Split across siblings</option><option value="suspense">Keep in suspense</option><option value="refund">Refund to payer</option></NativeSelect></Field>
        {action === "assign" && <>
          {ex.candidates.length > 0 && <Field label="Suggested match"><NativeSelect value={ex.candidates.some((c) => c.studentId === student) ? student : ""} onChange={(e) => setStudent(e.target.value)}><option value="">Other learner</option>{ex.candidates.map((c) => <option key={c.studentId} value={c.studentId}>{sname(c.studentId)} ({c.score})</option>)}</NativeSelect></Field>}
          <StudentPicker label="Learner" value={student} onChange={setStudent} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> Remember this account reference for this learner</label>
        </>}
        {action === "split" && <SplitRows rows={rows} onChange={setRows} />}
        {action === "refund" && <p className="text-xs text-amber-800 sm:col-span-2">Creates a refund request below. A different checker approves it before you record the payout reference.</p>}
        <Field label="Reason" required className="sm:col-span-2"><TextInput data-testid="input-resolve-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      {action === "split" && pay && <p className="text-xs text-muted-foreground">Allocated {kes(sumMoney(rows.map((r) => r.amount)))} of {kes(pay.amount)}</p>}
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-resolution" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Resolve payment</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

export function Queue({ pays }: { pays: Map<string, IncomingPaymentView> }) {
  const p = usePerms();
  const q = useListPaymentExceptions({ query: { queryKey: getListPaymentExceptionsQueryKey() } });
  const sname = useStudentNames();
  const [open, setOpen] = useState<string | null>(null);
  const { rows, pager } = usePaged(q.data);
  return (
    <Panel title="Needs a learner" note="Oldest first. Assign each payment to the right learner; nothing reaches a balance until you do.">
      {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<ArrowLeftRight className="h-5 w-5" />} title="All matched" body="Every payment received has been matched to a learner." /> : (
        <ul className="divide-y divide-border/70">{rows.map((ex) => { const pay = pays.get(ex.paymentId); return (
          <li key={ex.id} data-testid={`row-exception-${ex.id}`}>
            <div className="flex flex-wrap items-start gap-4 p-4">
              <div className="min-w-[12rem] flex-1">
                <div className="flex items-center gap-2"><Money v={pay?.amount} className="font-semibold" /><Pill tone="error">{ex.reason.replace(/_/g, " ")}</Pill>{ex.status !== "open" && <Pill tone="left">{ex.status}</Pill>}</div>
                <div className="mt-1 text-xs text-muted-foreground">{pay ? <>{CH[pay.channel] ?? pay.channel} · <span className="font-mono">{pay.providerTxnId}</span> · {pay.payerName ?? "Unknown payer"} {pay.payerPhone ?? ""} · Ref “{pay.accountReference ?? ""}” · {fmtDateTime(pay.transactionTime)}</> : "Payment details loading"}</div>
                {ex.expiresAt && <div className="text-[11px] text-amber-800">Escalates {fmtDateTime(ex.expiresAt)}</div>}
              </div>
              <div className="min-w-[14rem] flex-1 space-y-1">{ex.candidates.length ? ex.candidates.map((c) => (
                <div key={c.studentId} className="flex items-start gap-2 text-sm"><span className="w-10 shrink-0 rounded bg-primary/10 px-1 text-center font-mono text-xs leading-5 text-primary">{c.score}</span><div>{sname(c.studentId)}<div className="text-[11px] text-muted-foreground">{c.reasons.join(" · ")}</div></div></div>
              )) : <span className="text-xs text-muted-foreground">No candidate learners</span>}</div>
              {p.bursar && <Btn variant="outline" data-testid={`button-resolve-${ex.id}`} onClick={() => setOpen(ex.id)}>Resolve</Btn>}
            </div>
          </li>); })}</ul>
      )}
      <Pager {...pager} />
      {p.bursar && (() => { const ex = q.data?.find((x) => x.id === open); const pay = ex ? pays.get(ex.paymentId) : undefined; return (
        <FormDialog open={!!ex} onOpenChange={(o) => { if (!o) setOpen(null); }} size="lg" title="Resolve unmatched payment" description={pay ? `${kes(pay.amount)} · ${CH[pay.channel] ?? pay.channel} · ${pay.providerTxnId} · ${pay.payerName ?? "Unknown payer"}` : undefined}>
          {ex && <Resolve key={ex.id} ex={ex} pay={pay} onDone={() => setOpen(null)} />}
        </FormDialog>); })()}
    </Panel>
  );
}

const emptyIn = { channel: "bank" as IncomingInputChannel, provider: "", providerTxnId: "", amount: "", transactionTime: "", payerName: "", payerPhone: "", accountReference: "", bankAccountFrom: "" };
export function Ingest({ onDone }: { onDone: () => void }) {
  const m = useIngestIncomingPayment(); const inv = useReconInvalidate(); const { toast } = useToast();
  const [f, setF] = useState(emptyIn); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.provider.trim() || !f.providerTxnId.trim() || !f.transactionTime) return setErr("Provider, transaction reference and time are required.");
    if (!validMoney(f.amount)) return setErr("Enter the exact amount.");
    const opt = (["payerName", "payerPhone", "accountReference", "bankAccountFrom"] as const).reduce((o, k) => (f[k].trim() ? { ...o, [k]: f[k].trim() } : o), {});
    m.mutate({ data: { provider: f.provider.trim(), providerTxnId: f.providerTxnId.trim(), channel: f.channel, amount: f.amount.trim(), transactionTime: new Date(`${f.transactionTime}:00+03:00`).toISOString(), ...opt } }, {
      onSuccess: (r) => { inv(); toast({ title: `Payment ${r.status.replace(/_/g, " ")}`, description: r.duplicateOfId ? "Same reference already received; nothing was posted twice." : undefined }); setF(emptyIn); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Channel" required><NativeSelect value={f.channel} onChange={set("channel")}><option value="bank">Bank</option><option value="mpesa_c2b">M-Pesa paybill</option><option value="mpesa_stk">M-Pesa prompt</option></NativeSelect></Field>
        <Field label="Provider" required hint="e.g. KCB, Equity, daraja"><TextInput value={f.provider} onChange={set("provider")} /></Field>
        <Field label="Transaction reference" required><TextInput className="font-mono" value={f.providerTxnId} onChange={set("providerTxnId")} /></Field>
        <Field label="Amount (KES)" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Transaction time" required hint="Nairobi time"><TextInput type="datetime-local" value={f.transactionTime} onChange={set("transactionTime")} /></Field>
        <Field label="Account reference"><TextInput value={f.accountReference} onChange={set("accountReference")} /></Field>
        <Field label="Payer name"><TextInput value={f.payerName} onChange={set("payerName")} /></Field>
        <Field label="Payer phone"><TextInput type="tel" value={f.payerPhone} onChange={set("payerPhone")} /></Field>
        {f.channel === "bank" && <Field label="From account"><TextInput className="font-mono" value={f.bankAccountFrom} onChange={set("bankAccountFrom")} /></Field>}
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Run matching</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}


const MAPKEYS = [["providerTxnId", "Transaction reference", true], ["amount", "Amount", true], ["transactionTime", "Date / time", true], ["accountReference", "Account reference", false], ["payerName", "Payer name", false], ["payerPhone", "Payer phone", false]] as const;
export function Statement({ onDone }: { onDone: () => void }) {
  const preview = usePreviewBankStatement(); const commit = useReconcileStatement(); const inv = useReconInvalidate(); const { toast } = useToast();
  const [f, setF] = useState({ provider: "", fromDate: "", toDate: localToday(), complete: true });
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [res, setRes] = useState<{ rows: IncomingInput[]; errors: { row: number; message: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const format: StatementFileInputFormat | null = !file ? null : /\.xlsx$/i.test(file.name) ? "xlsx" : /\.(sta|mt940|txt)$/i.test(file.name) ? "mt940" : "csv";
  const pick = async (fl?: File) => {
    setFile(fl ?? null); setRes(null); setHeader([]); setErr(null);
    if (fl && !/\.(sta|mt940|txt)$/i.test(fl.name)) try { setHeader((await readSheet(fl)).header); } catch (x) { setErr(errMsg(x)); }
  };
  const run = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setRes(null);
    if (!file || !format || !f.provider.trim()) return setErr("Choose the bank and the statement file.");
    if (format !== "mt940" && MAPKEYS.some(([k, , req]) => req && !map[k])) return setErr("Map the reference, amount and date columns.");
    const content = format === "xlsx" ? await fileBase64(file) : await file.text();
    const mapping = format === "mt940" ? undefined : Object.fromEntries(Object.entries(map).filter(([, v]) => v)) as { providerTxnId: string; amount: string; transactionTime: string };
    preview.mutate({ data: { provider: f.provider.trim(), format, content, ...(mapping ? { mapping } : {}) } }, { onSuccess: setRes, onError: (x) => setErr(errMsg(x)) });
  };
  const go = () => {
    if (!res || !f.fromDate || !f.toDate) return setErr("Set the statement period.");
    commit.mutate({ data: { provider: f.provider.trim(), fromDate: f.fromDate, toDate: f.toDate, rows: res.rows, completeStatement: f.complete } }, {
      onSuccess: (r) => { inv(); toast({ title: `Reconciliation ${r.status}`, description: `${r.discrepancies.length} discrepancies.` }); setRes(null); setFile(null); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <div>
      <form onSubmit={run} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Bank" required><TextInput value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="KCB" /></Field>
          <Field label="Statement file" required hint="CSV, XLSX or MT940"><TextInput type="file" data-testid="input-statement-file" accept=".csv,.xlsx,.sta,.mt940,.txt" onChange={(e) => pick(e.target.files?.[0])} /></Field>
          <Field label="Period from" required><TextInput type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
          <Field label="Period to" required><TextInput type="date" value={f.toDate} min={f.fromDate || undefined} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
          {header.length > 0 && MAPKEYS.map(([k, label, req]) => (
            <Field key={k} label={label} required={req}><NativeSelect value={map[k] ?? ""} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">{req ? "Select column" : "Not in file"}</option>{header.map((h) => <option key={h}>{h}</option>)}</NativeSelect></Field>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.complete} onChange={(e) => setF({ ...f, complete: e.target.checked })} /> This is the complete statement for the period (flags system payments missing from it)</label>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn><Btn type="submit" variant="outline" data-testid="button-preview-statement" disabled={preview.isPending}>{preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}<Upload className="h-4 w-4" />Preview</Btn></FormActions>
      </form>
      {res && <div className="border-t border-border/70">
        <div className="flex flex-wrap gap-3 px-5 py-3 text-sm"><strong>{res.rows.length} valid rows</strong><span className={res.errors.length ? "text-destructive" : "text-muted-foreground"}>{res.errors.length} errors</span><span className="ml-auto">Total <Money v={sumMoney(res.rows.map((r) => r.amount))} className="font-semibold" /></span></div>
        {res.errors.length > 0 && <ul className="max-h-32 overflow-auto px-5 pb-2 text-xs text-destructive">{res.errors.map((x, i) => <li key={i}>Row {x.row}: {x.message}</li>)}</ul>}
        <div className="max-h-72 overflow-auto"><Table head={["Reference", "Amount", "Time", "Account ref", "Payer"]}>{res.rows.slice(0, 200).map((r, i) => <tr key={i}><td className={`${td} font-mono text-xs`}>{r.providerTxnId}</td><td className={td}><Money v={r.amount} /></td><td className={`${td} text-xs`}>{fmtDateTime(r.transactionTime)}</td><td className={`${td} text-xs`}>{r.accountReference}</td><td className={`${td} text-xs`}>{r.payerName}</td></tr>)}</Table></div>
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border p-5"><Btn disabled={!res.rows.length || commit.isPending} onClick={go}>{commit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Commit and reconcile</Btn>{res.errors.length > 0 && <span className="text-xs text-muted-foreground">Rows with errors are not committed.</span>}</div>
      </div>}
    </div>
  );
}


/** Unmatched payments now live on the Payments page, under its "Needs a learner" filter. */
export default function Reconciliation() {
  return <Redirect to="/payments?show=unmatched" replace />;
}
