import { useState, useEffect, type FormEvent } from "react";
import { usePreviewFinanceInvoices, useCommitFinanceInvoices, useCreateFinanceRecord, type InvoiceProposal } from "@workspace/api-client-react";
import { FileText, Loader2, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useFinanceRecords, useStudentNames, useTermNames, useFeeItemNames, StatusPill, Money, StudentPicker, TermSelect, GradeSelect, LinesEditor, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDate, fmtDateTime, nairobiToday } from "@/lib/session";
import { useFinanceInvalidate, useIdemKey, validMoney, sumMoney, rd, type Line } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

function Batch({ onClose }: { onClose: () => void }) {
  const preview = usePreviewFinanceInvoices();
  const commit = useCommitFinanceInvoices();
  const inv = useFinanceInvalidate();
  const sname = useStudentNames(); const item = useFeeItemNames();
  const { toast } = useToast();
  const [f, setF] = useState({ termId: "", gradeId: "", dueDate: "" });
  const [rows, setRows] = useState<InvoiceProposal[] | null>(null);
  const [previewToken, setPreviewToken] = useState<string>();
  const [done, setDone] = useState<InvoiceProposal[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const body = () => ({ termId: f.termId, dueDate: f.dueDate, previewToken, ...(f.gradeId ? { gradeId: f.gradeId } : {}) });
  const change = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setRows(null); setConfirm(false); };
  const run = (e: FormEvent) => {
    e.preventDefault(); setErr(null); setDone(null);
    if (!f.termId || !f.dueDate) return setErr("Choose a term and a due date.");
    preview.mutate({ data: body() }, { onSuccess: (r) => { setRows(r.invoices); setPreviewToken((r as typeof r & { previewToken: string }).previewToken); }, onError: (x) => setErr(errMsg(x)) });
  };
  const fresh = rows?.filter((r) => !r.existing) ?? [];
  const go = () => commit.mutate({ data: body() }, {
    onSuccess: (r) => { inv(); setDone(r.invoices); setRows(null); setConfirm(false); toast({ title: "Invoices generated", description: `${r.invoices.filter((x) => !x.existing).length} new; existing invoices were left untouched.` }); onClose(); },
    onError: (x) => setErr(`${errMsg(x)} If the connection failed, retry this same preview safely. A stale-preview rejection requires a fresh preview.`),
  });
  return (
    <div>
      <form onSubmit={run} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <TermSelect required value={f.termId} onChange={(v) => change({ termId: v })} />
          <GradeSelect value={f.gradeId} allowNone="All grades" onChange={(v) => change({ gradeId: v })} />
          <Field label="Due date" required><TextInput data-testid="input-due-date" type="date" value={f.dueDate} min={nairobiToday()} onChange={(e) => change({ dueDate: e.target.value })} /></Field>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="button" variant="ghost" onClick={onClose}>{done ? "Close" : "Cancel"}</Btn><Btn type="submit" variant="outline" data-testid="button-preview-invoices" disabled={preview.isPending}>{preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Preview invoices</Btn></FormActions>
      </form>
      {rows && (
        <div className="border-t border-border/70" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><strong>{fresh.length} new</strong><span className="text-muted-foreground">{rows.length - fresh.length} already invoiced</span><span className="ml-auto">New total <Money v={sumMoney(fresh.map((r) => r.amount))} className="font-semibold" /></span></div>
          {!rows.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">No learners match an approved structure for this term.</p> : (
            <div className="max-h-96 overflow-auto"><Table head={["Student", "Lines", "Amount", "State"]}>{rows.map((r) => (
              <tr key={r.studentId} className={r.existing ? "opacity-60" : ""}><td className={td}>{sname(r.studentId)}</td><td className={`${td} text-xs`}>{r.lines.map((l, i) => <div key={i}>{item(l.feeItemId)} <span className="font-mono">{l.amount}</span></div>)}</td><td className={td}><Money v={r.amount} /></td><td className={td}>{r.existing ? <Pill tone="left">Exists</Pill> : <Pill tone="duplicate">Will create</Pill>}</td></tr>))}</Table></div>
          )}
          {fresh.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border p-5">
            <label className="flex items-center gap-2 text-sm"><input data-testid="check-confirm-invoices" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I checked this list; post {fresh.length} invoices to learner ledgers.</label>
            <Btn data-testid="button-commit-invoices" disabled={!confirm || commit.isPending} onClick={go}>{commit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Commit invoices</Btn>
          </div>}
        </div>
      )}
      {done && <p className="border-t border-border/70 px-5 py-3 text-sm text-primary">Committed. {done.filter((r) => !r.existing).length} invoices posted.</p>}
    </div>
  );
}

function OneOff({ onDone }: { onDone: () => void }) {
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [f, setF] = useState<{ studentId: string; termId: string; dueDate: string; lines: Line[] }>({ studentId: "", termId: "", dueDate: nairobiToday(), lines: [{ feeItemId: "", amount: "" }] });
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId || !f.dueDate) return setErr("Choose a student and due date.");
    if (f.lines.some((l) => !l.feeItemId || !validMoney(l.amount))) return setErr("Each line needs a fee item and a valid amount.");
    create.mutate({ data: { kind: "invoice", idempotencyKey: idem.key, studentId: f.studentId, dueDate: f.dueDate, ...(f.termId ? { termId: f.termId } : {}), lines: f.lines.map((l) => ({ feeItemId: l.feeItemId, amount: l.amount.trim(), ...(l.description?.trim() ? { description: l.description.trim() } : {}) })) } }, {
      onSuccess: () => { idem.renew(); inv(); toast({ title: "Invoice posted" }); onDone(); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
        <TermSelect value={f.termId} allowNone="Not term-bound" onChange={(v) => setF({ ...f, termId: v })} />
        <Field label="Due date" required><TextInput type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <LinesEditor lines={f.lines} onChange={(lines) => setF({ ...f, lines })} />
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-invoice" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Post invoice</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

export default function Invoices() {
  const p = usePerms();
  const sname = useStudentNames(); const term = useTermNames();
  const [oneoff, setOneoff] = useState(false);
  const [batch, setBatch] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, filter]);
  const q = useFinanceRecords({ kind: "invoice", page, pageSize: 50, status, search: filter });
  const list = q.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Billing" title="Invoices" meta="Term invoices from approved structures, plus one-off charges.">
        {p.financeConfigure && <Btn variant="outline" data-testid="button-generate-invoices" onClick={() => setBatch(true)}><FileText className="h-4 w-4" /> Generate term invoices</Btn>}
        {p.financeConfigure && <Btn data-testid="button-new-invoice" onClick={() => setOneoff(true)}><Plus className="h-4 w-4" /> One-off invoice</Btn>}
      </PageHeader>
      {p.financeConfigure && <>
        <FormDialog open={oneoff} onOpenChange={setOneoff} size="lg" title="Post a one-off invoice" description="Trips, damages, uniforms. Posts to the ledger immediately."><OneOff onDone={() => setOneoff(false)} /></FormDialog>
        <FormDialog open={batch} onOpenChange={setBatch} size="full" title="Generate term invoices" description="Preview against approved structures and optional charges, then commit. Re-running never duplicates."><Batch onClose={() => setBatch(false)} /></FormDialog>
      </>}
      <Panel title="All invoices" action={<div className="flex gap-2"><NativeSelect aria-label="Invoice status" className="h-8 w-36 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></NativeSelect><TextInput aria-label="Filter invoices" placeholder="Filter by student or no." className="h-8 w-52 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<FileText className="h-5 w-5" />} title="No invoices" body="Generate term invoices once structures are approved." /> : (
          <Table head={["Invoice no.", "Student", "Term", "Issued / due", "Amount", "Status", "Created"]}>{list.map((r) => (
            <tr key={r.id} data-testid={`row-invoice-${r.id}`}><td className={`${td} font-mono text-xs`}>{rd(r, "invoiceNo") ?? "\u2014"}<div className="font-sans text-[11px] text-muted-foreground">{rd(r, "type") === "one_off" ? "One-off" : "Term"}</div></td><td className={td}>{sname(r.studentId)}</td><td className={`${td} text-xs`}>{term(r.termId)}</td><td className={`${td} text-xs`}>{fmtDate(rd(r, "issueDate"))}<div className="text-muted-foreground">Due {fmtDate(rd(r, "dueDate"))}</div></td><td className={td}><Money v={r.amount} /></td><td className={td}><StatusPill status={r.status} /></td><td className={`${td} text-xs text-muted-foreground`}>{fmtDateTime(r.createdAt)}</td></tr>))}</Table>
        )}
      </Panel>
      <div className="flex items-center justify-end gap-3"><Btn variant="outline" disabled={page === 1 || q.isFetching} onClick={() => setPage(page - 1)}>Previous</Btn><span>Page {page}</span><Btn variant="outline" disabled={list.length < 50 || q.isFetching} onClick={() => setPage(page + 1)}>Next</Btn></div>
    </div>
  );
}
