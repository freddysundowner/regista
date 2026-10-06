import { useMemo, useState, type FormEvent } from "react";
import { useCreateFinanceRecord, useUpdateFinanceRecord, type FinanceRecord, type FinanceInputBoardingStatus } from "@workspace/api-client-react";
import { Layers, Loader2, Pencil, Plus, Receipt, Tag } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useFinanceRecords, useStudentNames, useTermNames, useFeeItemNames, StatusPill, Money, MoneyInput, StudentPicker, TermSelect, GradeSelect, YearSelect, FeeItemSelect, LinesEditor, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDate, localToday } from "@/lib/session";
import { useIdemKey, useFinanceInvalidate, validMoney, rd, recLines, type Line } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";
import { useListGrades, useListAcademicYears, getListGradesQueryKey, getListAcademicYearsQueryKey } from "@workspace/api-client-react";

function FeeItems({ canEdit }: { canEdit: boolean }) {
  const q = useFinanceRecords({ kind: "fee_item" });
  const create = useCreateFinanceRecord();
  const upd = useUpdateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | FinanceRecord | null>(null);
  const [f, setF] = useState({ name: "", code: "", priority: "1", isOptional: false, reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const open = (r?: FinanceRecord) => { setErr(null); setF(r ? { name: rd(r, "name") ?? "", code: rd(r, "code") ?? "", priority: rd(r, "priority") ?? "1", isOptional: !!r.data?.isOptional, reason: "" } : { name: "", code: "", priority: String((q.data?.length ?? 0) + 1), isOptional: false, reason: "" }); setMode(r ?? "new"); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const priority = Number(f.priority);
    if (!Number.isInteger(priority) || priority < 1) return setErr("Priority must be a whole number from 1. Lower numbers are paid first.");
    if (mode === "new") {
      if (!/^[A-Z0-9_-]{2,20}$/.test(f.code)) return setErr("Code: 2 to 20 capital letters, digits, - or _.");
      create.mutate({ data: { kind: "fee_item", idempotencyKey: idem.key, name: f.name.trim(), code: f.code, priority, isOptional: f.isOptional } }, {
        onSuccess: () => { idem.renew(); inv(); toast({ title: "Fee item created" }); setMode(null); }, onError: (x) => setErr(errMsg(x)),
      });
    } else if (mode) {
      if (f.reason.trim().length < 3) return setErr("Give a reason for the change.");
      upd.mutate({ id: mode.id, data: { name: f.name.trim(), priority, reason: f.reason.trim() } }, { onSuccess: () => { inv(); toast({ title: "Fee item updated" }); setMode(null); }, onError: (x) => setErr(errMsg(x)) });
    }
  };
  const items = [...(q.data ?? [])].sort((a, b) => Number(a.data?.priority ?? 0) - Number(b.data?.priority ?? 0));
  return (
    <Panel title="Fee items" note="Vote heads in allocation priority. Optional items are assigned per student." action={canEdit ? <Btn variant="outline" className="h-8" data-testid="button-new-fee-item" onClick={() => open()}><Plus className="h-3.5 w-3.5" /> Add fee item</Btn> : undefined}>
      <FormDialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} busy={create.isPending || upd.isPending} title={mode === "new" ? "Add a fee item" : mode ? `Edit ${rd(mode, "name") ?? "fee item"}` : "Fee item"} description="Vote heads are allocated in priority order; 1 is paid first.">
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><TextInput data-testid="input-fee-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tuition" /></Field>
            <Field label="Code" required hint={mode !== "new" ? "Fixed after creation" : undefined}><TextInput data-testid="input-fee-code" disabled={mode !== "new"} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="TUI" className="font-mono" /></Field>
            <Field label="Priority" required hint="1 is paid first"><TextInput data-testid="input-fee-priority" type="number" min={1} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
            {mode === "new" ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input data-testid="check-optional" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.isOptional} onChange={(e) => setF({ ...f, isOptional: e.target.checked })} /> Optional (per student)</label>
              : <Field label="Reason for change" required><TextInput data-testid="input-fee-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-fee-item" disabled={create.isPending || upd.isPending}>{(create.isPending || upd.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "new" ? "Create fee item" : "Save fee item"}</Btn><Btn type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
      {q.isLoading ? <SkeletonRows rows={3} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !items.length ? <Empty icon={<Tag className="h-5 w-5" />} title="No fee items" body="Start with Tuition, Lunch, Transport and Activity." /> : (
        <ul className="divide-y divide-border/60">{items.map((r) => (
          <li key={r.id} data-testid={`row-fee-item-${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-6 font-mono text-xs text-muted-foreground">{rd(r, "priority")}</span>
            <span className="flex-1 font-semibold">{rd(r, "name")}</span>
            <span className="font-mono text-xs text-muted-foreground">{rd(r, "code")}</span>
            {r.data?.isOptional ? <Pill tone="current">Optional</Pill> : <Pill tone="left">Standard</Pill>}
            {canEdit && <button aria-label={`Edit ${rd(r, "name")}`} onClick={() => open(r)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
          </li>))}</ul>
      )}
    </Panel>
  );
}

type SForm = { name: string; academicYearId: string; termId: string; gradeId: string; boardingStatus: "" | FinanceInputBoardingStatus; lines: Line[] };
const emptyS: SForm = { name: "", academicYearId: "", termId: "", gradeId: "", boardingStatus: "", lines: [{ feeItemId: "", amount: "" }] };

function Structures({ canEdit }: { canEdit: boolean }) {
  const q = useFinanceRecords({ kind: "fee_structure" });
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const years = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const term = useTermNames(); const item = useFeeItemNames();
  const create = useCreateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [mode, setMode] = useState<null | { parent?: FinanceRecord }>(null);
  const [f, setF] = useState<SForm>(emptyS);
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify([f, mode?.parent?.id]));
  const gname = (id?: string) => grades.data?.find((g) => g.id === id)?.name ?? "Grade";
  const yname = (id?: string) => years.data?.find((y) => y.id === id)?.name ?? "";
  const versionOf = (r: FinanceRecord) => (r.parentId ? `v${rd(r, "version") ?? "?"}` : `v${rd(r, "version") ?? "1"}`);
  const sorted = useMemo(() => [...(q.data ?? [])].sort((a, b) => `${a.data?.termId}${a.data?.gradeId}${a.data?.boardingStatus}`.localeCompare(`${b.data?.termId}${b.data?.gradeId}${b.data?.boardingStatus}`) || Number(b.data?.version ?? 0) - Number(a.data?.version ?? 0)), [q.data]);
  const startVersion = (p: FinanceRecord) => { setErr(null); setF({ name: rd(p, "name") ?? "", academicYearId: rd(p, "academicYearId") ?? "", termId: rd(p, "termId") ?? p.termId ?? "", gradeId: rd(p, "gradeId") ?? "", boardingStatus: (rd(p, "boardingStatus") ?? "") as SForm["boardingStatus"], lines: recLines(p).map((l) => ({ feeItemId: l.feeItemId, amount: String(l.amount), description: l.description })) }); setMode({ parent: p }); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.academicYearId || !f.termId || !f.gradeId) return setErr("Choose academic year, term and grade.");
    if (f.lines.some((l) => !l.feeItemId || !validMoney(l.amount))) return setErr("Each line needs a fee item and an amount like 12500 or 12500.50.");
    if (new Set(f.lines.map((l) => l.feeItemId)).size !== f.lines.length) return setErr("Each fee item may appear once.");
    create.mutate({ data: { kind: "fee_structure", idempotencyKey: idem.key, name: f.name.trim(), academicYearId: f.academicYearId, termId: f.termId, gradeId: f.gradeId, ...(f.boardingStatus ? { boardingStatus: f.boardingStatus } : {}), ...(mode?.parent ? { parentId: mode.parent.id } : {}), lines: f.lines.map((l) => ({ feeItemId: l.feeItemId, amount: l.amount.trim(), ...(l.description?.trim() ? { description: l.description.trim() } : {}) })) } }, {
      onSuccess: () => { idem.renew(); inv(); toast({ title: "Draft submitted", description: "It takes effect once a principal or admin approves it." }); setMode(null); setF(emptyS); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const locked = !!mode?.parent;
  return (
    <Panel title="Fee structures" note="Drafts await approval. Approved structures are never edited; create a new version instead." action={canEdit ? <Btn variant="outline" className="h-8" data-testid="button-new-structure" onClick={() => { setF(emptyS); setErr(null); setMode({}); }}><Plus className="h-3.5 w-3.5" /> Draft structure</Btn> : undefined}>
      <FormDialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} busy={create.isPending} size="lg" title={locked ? "New fee structure version" : "Draft a fee structure"} description="Drafts await approval. Approved structures are never edited.">
        <form onSubmit={submit} className="space-y-4 p-5">
          {locked && <p className="text-sm text-muted-foreground">New version of <strong>{rd(mode.parent!, "name")}</strong> ({versionOf(mode.parent!)}). Scope stays the same.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required><TextInput data-testid="input-structure-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Grade 4 Day, Term 1" /></Field>
            {locked ? <div className="self-end pb-2 text-sm text-muted-foreground">{yname(f.academicYearId)} · {term(f.termId)} · {gname(f.gradeId)} · {f.boardingStatus || "All learners"}</div> : <>
              <YearSelect value={f.academicYearId} onChange={(v) => setF({ ...f, academicYearId: v })} />
              <TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />
              <GradeSelect required value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} />
              <Field label="Boarding"><NativeSelect data-testid="select-boarding" value={f.boardingStatus} onChange={(e) => setF({ ...f, boardingStatus: e.target.value as SForm["boardingStatus"] })}><option value="">All learners</option><option value="day">Day scholars</option><option value="boarder">Boarders</option></NativeSelect></Field>
            </>}
            <LinesEditor lines={f.lines} optional={false} onChange={(lines) => setF({ ...f, lines })} />
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-structure" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit for approval</Btn><Btn type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
      {q.isLoading ? <SkeletonRows rows={3} cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !sorted.length ? <Empty icon={<Layers className="h-5 w-5" />} title="No fee structures" body="Draft one per term and grade; invoices are generated from approved structures." /> : (
        <Table head={["Structure", "Scope", "Version", "Lines", "Total", "Status", ""]}>{sorted.map((r) => (
          <tr key={r.id} data-testid={`row-structure-${r.id}`} className={r.status === "archived" || r.status === "rejected" ? "opacity-60" : ""}>
            <td className={`${td} font-semibold`}>{rd(r, "name")}</td>
            <td className={`${td} text-xs text-muted-foreground`}>{yname(rd(r, "academicYearId"))} · {term(rd(r, "termId") ?? r.termId)}<br />{gname(rd(r, "gradeId"))} · {rd(r, "boardingStatus") ?? "all"}</td>
            <td className={`${td} font-mono text-xs`}>{versionOf(r)}</td>
            <td className={`${td} text-xs`}>{recLines(r).map((l, i) => <div key={i}>{item(l.feeItemId)} <span className="font-mono">{l.amount}</span></div>)}</td>
            <td className={td}><Money v={r.amount} /></td>
            <td className={td}><StatusPill status={r.status} /></td>
            <td className={td}>{canEdit && (r.status === "approved" || r.status === "active") && <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-version-${r.id}`} onClick={() => startVersion(r)}>New version</Btn>}</td>
          </tr>))}</Table>
      )}
    </Panel>
  );
}

function OptionalCharges({ canEdit }: { canEdit: boolean }) {
  const q = useFinanceRecords({ kind: "optional_charge" });
  const sname = useStudentNames(); const item = useFeeItemNames(); const term = useTermNames();
  const create = useCreateFinanceRecord();
  const upd = useUpdateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ studentId: "", feeItemId: "", amount: "", startDate: localToday(), termId: "", endDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const [ending, setEnding] = useState<{ id: string; endDate: string; reason: string } | null>(null);
  const [endErr, setEndErr] = useState<string | null>(null);
  const endingRec = q.data?.find((r) => r.id === ending?.id);
  const idem = useIdemKey(JSON.stringify(f));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.studentId || !f.feeItemId) return setErr("Choose a student and an optional fee item.");
    if (!validMoney(f.amount)) return setErr("Enter an amount like 3500 or 3500.50.");
    if (f.endDate && f.endDate < f.startDate) return setErr("End date is before start date.");
    create.mutate({ data: { kind: "optional_charge", idempotencyKey: idem.key, studentId: f.studentId, feeItemId: f.feeItemId, amount: f.amount.trim(), startDate: f.startDate, ...(f.termId ? { termId: f.termId } : {}), ...(f.endDate ? { endDate: f.endDate } : {}) } }, {
      onSuccess: () => { idem.renew(); inv(); toast({ title: "Optional charge added", description: "Billed on future invoices in its date range." }); setOpen(false); setF({ ...f, studentId: "", amount: "" }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <Panel title="Optional student charges" note="Lunch, transport, clubs: per-student items billed on invoice generation." action={canEdit ? <Btn variant="outline" className="h-8" data-testid="button-new-charge" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add charge</Btn> : undefined}>
      <FormDialog open={open} onOpenChange={setOpen} busy={create.isPending} size="lg" title="Add an optional charge" description="Billed on future invoices within its date range.">
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <StudentPicker value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />
            <FeeItemSelect optional value={f.feeItemId} onChange={(v) => setF({ ...f, feeItemId: v })} />
            <Field label="Amount per term (KES)" required><MoneyInput testid="input-charge-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
            <Field label="Starts" required><TextInput type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Ends"><TextInput type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            <TermSelect value={f.termId} allowNone="Every term in range" onChange={(v) => setF({ ...f, termId: v })} />
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-charge" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add charge</Btn><Btn type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn></FormActions>
        </form>
      </FormDialog>
      <FormDialog open={!!ending} onOpenChange={(o) => { if (!o) setEnding(null); }} busy={upd.isPending} size="sm" title="Set charge end date" description={endingRec ? `${sname(endingRec.studentId)} · ${item(rd(endingRec, "feeItemId"))}` : undefined}>
        {ending && <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (ending.reason.trim().length < 3 || !ending.endDate) return setEndErr("End date and a reason of at least 3 characters are required."); setEndErr(null); upd.mutate({ id: ending.id, data: { endDate: ending.endDate, reason: ending.reason.trim() } }, { onSuccess: () => { inv(); setEnding(null); toast({ title: "Charge end date set" }); }, onError: (x) => setEndErr(errMsg(x)) }); }}>
          <Field label="End date" required><TextInput data-testid="input-charge-end" type="date" value={ending.endDate} onChange={(e) => setEnding({ ...ending, endDate: e.target.value })} /></Field>
          <Field label="Reason" required><TextInput data-testid="input-charge-end-reason" value={ending.reason} onChange={(e) => setEnding({ ...ending, reason: e.target.value })} /></Field>
          <FormError msg={endErr} />
          <FormActions><Btn type="submit" data-testid="button-save-charge-end" disabled={upd.isPending}>{upd.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Set end date</Btn><Btn type="button" variant="ghost" onClick={() => setEnding(null)}>Cancel</Btn></FormActions>
        </form>}
      </FormDialog>
      {q.isLoading ? <SkeletonRows rows={3} cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Receipt className="h-5 w-5" />} title="No optional charges" body="Create an optional fee item first, then assign it to learners." /> : (
        <Table head={["Student", "Item", "Amount", "Period", "Status", ""]}>{q.data.map((r) => (
          <tr key={r.id} data-testid={`row-charge-${r.id}`}>
            <td className={td}>{sname(r.studentId)}</td><td className={td}>{item(rd(r, "feeItemId"))}</td><td className={td}><Money v={r.amount} /></td>
            <td className={`${td} text-xs`}>{fmtDate(rd(r, "startDate"))} to {rd(r, "endDate") ? fmtDate(rd(r, "endDate")) : "open"}{r.termId && <div className="text-muted-foreground">{term(r.termId)}</div>}</td>
            <td className={td}><StatusPill status={r.status} /></td>
            <td className={td}>{canEdit && <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-end-charge-${r.id}`} onClick={() => { setEndErr(null); setEnding({ id: r.id, endDate: localToday(), reason: "" }); }}>Set end date</Btn>}</td>
          </tr>))}</Table>
      )}
    </Panel>
  );
}

export default function Fees() {
  const p = usePerms();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Finance setup" title="Fees" meta={p.financeConfigure ? "Configure vote heads, termly structures and per-student extras." : "Read-only view. Structures are approved in Approvals."} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]"><FeeItems canEdit={p.financeConfigure} /><OptionalCharges canEdit={p.financeConfigure} /></div>
      <Structures canEdit={p.financeConfigure} />
    </div>
  );
}
