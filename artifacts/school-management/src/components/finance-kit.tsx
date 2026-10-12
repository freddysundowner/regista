import { useMemo, useState, type ReactNode } from "react";
import {
  useGetSchool, getGetSchoolQueryKey, useListStudents, useListFinanceRecords, useListTerms, useListGrades, useListAcademicYears, useCreateFinanceDocument, downloadFinanceDocument,
  getListStudentsQueryKey, getListFinanceRecordsQueryKey, getListTermsQueryKey, getListGradesQueryKey, getListAcademicYearsQueryKey,
  type FinanceRecord, type ListFinanceRecordsParams, type Student,
} from "@workspace/api-client-react";
import { Download, Loader2, Plus, X } from "lucide-react";
import { CardTable, Field, NativeSelect, TextInput, Btn, Pill } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { kes, sumMoney, type Line } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

export function useFinanceRecords(params?: ListFinanceRecordsParams & { page?: number; pageSize?: number; status?: string; search?: string; id?: string }, enabled = true) {
  return useListFinanceRecords(params, { query: { queryKey: getListFinanceRecordsQueryKey(params), enabled, staleTime: 15000, refetchInterval: 30000 } });
}

/** Whether money changes wait for a second person at this school (on unless switched off in Settings). */
export function useSecondApproval() {
  const q = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  return q.data?.settings?.requireSecondApproval !== false;
}

export function useStudentNames() {
  const q = useListStudents(undefined, { query: { queryKey: getListStudentsQueryKey() } });
  return useMemo(() => {
    const m = new Map<string, string>();
    q.data?.forEach((s) => m.set(s.id, `${s.fullName} · ${s.admissionNo}`));
    return (id?: string | null) => (id ? m.get(id) ?? "Student" : "\u2014");
  }, [q.data]);
}

export function useTermNames() {
  const q = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  return useMemo(() => { const m = new Map(q.data?.map((t) => [t.id, `${t.name} ${t.academicYearName}`])); return (id?: string | null) => (id ? m.get(id) ?? "Term" : "\u2014"); }, [q.data]);
}

export function useFeeItemNames() {
  const q = useFinanceRecords({ kind: "fee_item" });
  return useMemo(() => { const m = new Map(q.data?.map((r) => [r.id, String(r.data?.name ?? "Fee item")])); return (id?: string | null) => (id ? m.get(id) ?? "Fee item" : "\u2014"); }, [q.data]);
}

const STATUS: Record<string, { tone: string; label: string }> = {
  pending: { tone: "duplicate", label: "Pending approval" }, rejected: { tone: "error", label: "Rejected" },
  posted: { tone: "active", label: "Posted" }, approved: { tone: "current", label: "Approved" }, active: { tone: "active", label: "Active" },
  open: { tone: "current", label: "Open" }, partially_paid: { tone: "duplicate", label: "Partially paid" }, cancelled: { tone: "inactive", label: "Cancelled" }, paid: { tone: "active", label: "Paid" }, reversed: { tone: "inactive", label: "Reversed" }, archived: { tone: "inactive", label: "Superseded" },
};
export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "left", label: status.replace(/_/g, " ") };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function Money({ v, className }: { v?: string | null; className?: string }) {
  return <span className={`font-mono tabular-nums ${className ?? ""}`}>{kes(v)}</span>;
}

export function MoneyInput({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }) {
  return <TextInput data-testid={testid} inputMode="decimal" placeholder="0.00" pattern="\d{1,12}(\.\d{1,2})?" className="font-mono" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} />;
}

/** Server-scoped student picker with search. */
/**
 * One search box for choosing a learner: type a name or admission number, pick from the matches.
 * `onPick` also gets the learner record, e.g. to prefill a parent's phone.
 */
export function StudentPicker({ value, onChange, onPick, label = "Learner", required = true }: {
  value: string; onChange: (id: string) => void; onPick?: (s: Student) => void; label?: string; required?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [changing, setChanging] = useState(false);
  const name = useStudentNames();
  const params = search.trim().length >= 2 ? { search: search.trim() } : undefined;
  const q = useListStudents(params, { query: { queryKey: getListStudentsQueryKey(params), enabled: !!params } });
  const matches = (q.data ?? []).slice(0, 8);
  const choose = (s: Student) => { onChange(s.id); onPick?.(s); setSearch(""); setChanging(false); };
  if (value && !changing) return (
    <Field label={label} required={required} className="sm:col-span-2">
      <div className="flex h-10 items-center gap-3 rounded-md border border-input bg-card px-3 text-sm" data-testid="select-student">
        <span className="min-w-0 flex-1 truncate font-medium">{name(value)}</span>
        <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setChanging(true)}>Change</button>
      </div>
    </Field>
  );
  return (
    <Field label={label} required={required} className="sm:col-span-2">
      <div className="relative">
        <TextInput data-testid="input-student-search" autoFocus={changing} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name or admission number"
          onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); choose(matches[0]); } if (e.key === "Escape" && value) setChanging(false); }} />
        {params && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg" role="listbox">
            {q.isLoading ? <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
              : !matches.length ? <li className="px-3 py-2 text-sm text-muted-foreground">No learner matches “{search.trim()}”</li>
              : matches.map((s) => (
                <li key={s.id} role="option" aria-selected={s.id === value}>
                  <button type="button" onClick={() => choose(s)} className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="font-medium">{s.fullName}</span>
                    <span className="text-xs text-muted-foreground">{s.admissionNo}{s.gradeName ? ` · ${s.gradeName}${s.streamName ? ` ${s.streamName}` : ""}` : ""}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

export function TermSelect({ value, onChange, required, label = "Term", allowNone }: { value: string; onChange: (v: string) => void; required?: boolean; label?: string; allowNone?: string }) {
  const q = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  return <Field label={label} required={required}><NativeSelect data-testid="select-term" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{allowNone ?? "Select term"}</option>{q.data?.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.academicYearName}{t.isCurrent ? " (current)" : ""}</option>)}
  </NativeSelect></Field>;
}

export function GradeSelect({ value, onChange, required, allowNone }: { value: string; onChange: (v: string) => void; required?: boolean; allowNone?: string }) {
  const q = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  return <Field label="Grade" required={required}><NativeSelect data-testid="select-grade" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{allowNone ?? "Select grade"}</option>{[...(q.data ?? [])].sort((a, b) => a.order - b.order).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
  </NativeSelect></Field>;
}

export function YearSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  return <Field label="Academic year" required><NativeSelect data-testid="select-year" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Select year</option>{q.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
  </NativeSelect></Field>;
}

export function FeeItemSelect({ value, onChange, optional, label = "Fee item" }: { value: string; onChange: (v: string) => void; optional?: boolean; label?: string }) {
  const q = useFinanceRecords({ kind: "fee_item" });
  const items = (q.data ?? []).filter((r) => r.status === "active" && (optional === undefined || Boolean(r.data?.isOptional) === optional));
  return <Field label={label} required><NativeSelect data-testid="select-fee-item" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{q.isLoading ? "Loading" : items.length ? "Select item" : optional ? "No optional items yet" : "No fee items yet"}</option>
    {items.map((r) => <option key={r.id} value={r.id}>{String(r.data?.name)} ({String(r.data?.code)})</option>)}
  </NativeSelect></Field>;
}

/** Selects a record of the given kinds for a student (e.g. invoice, payment). */
export function RecordSelect({ studentId, kinds, value, onChange, label, required, filter }: { studentId: string; kinds: string[]; value: string; onChange: (r: FinanceRecord | undefined) => void; label: string; required?: boolean; filter?: (r: FinanceRecord) => boolean }) {
  const q = useFinanceRecords(studentId ? { studentId } : undefined, !!studentId);
  const list = (q.data ?? []).filter((r) => kinds.includes(r.kind) && (!filter || filter(r)));
  return <Field label={label} required={required}><NativeSelect data-testid={`select-${kinds[0]}-ref`} disabled={!studentId} value={value} onChange={(e) => onChange(list.find((r) => r.id === e.target.value))}>
    <option value="">{!studentId ? "Choose student first" : list.length ? "Select" : "None available"}</option>
    {list.map((r) => <option key={r.id} value={r.id}>{String(r.data?.receiptNo ?? r.data?.invoiceNo ?? r.data?.adjustmentType ?? r.kind)} · {kes(r.amount)} · {r.status}</option>)}
  </NativeSelect></Field>;
}

export function LinesEditor({ lines, onChange, optional }: { lines: Line[]; onChange: (l: Line[]) => void; optional?: boolean }) {
  const set = (i: number, p: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="col-span-full space-y-2">
      <div className="text-xs font-semibold text-foreground/80">Lines<span className="ml-0.5 text-amber-700">*</span></div>
      {lines.map((l, i) => (
        <div key={i} className="grid items-end gap-2 rounded-md border border-border/70 bg-background/40 p-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
          <FeeItemSelect value={l.feeItemId} optional={optional} onChange={(v) => set(i, { feeItemId: v })} />
          <Field label="Amount (KES)" required><MoneyInput testid={`input-line-amount-${i}`} value={l.amount} onChange={(v) => set(i, { amount: v })} /></Field>
          <Field label="Description"><TextInput value={l.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} /></Field>
          <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} className="mb-1 rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Btn type="button" variant="ghost" className="h-8" data-testid="button-add-line" onClick={() => onChange([...lines, { feeItemId: "", amount: "" }])}><Plus className="h-3.5 w-3.5" /> Add line</Btn>
        <span className="text-sm">Total <Money v={sumMoney(lines.map((l) => l.amount))} className="font-semibold" /></span>
      </div>
    </div>
  );
}

/** Generates a PDF on the server and downloads it with the authenticated client. Independent from posting. */
/** Generates a private PDF (receipt, statement, invoice) and downloads it. Used by buttons and menu items. */
export function useDocumentDownload() {
  const create = useCreateFinanceDocument();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = (type: "receipt" | "statement" | "invoice", referenceId: string, fileName?: string) => {
    setBusy(true);
    create.mutate({ data: { type, referenceId } }, {
      onSuccess: async (doc) => {
        try {
          const blob = await downloadFinanceDocument(doc.id);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `${(fileName ?? type).trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-")}.pdf`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (x) { toast({ title: "Download failed", description: `${errMsg(x)} The record is unaffected; try again.`, variant: "destructive" }); }
        setBusy(false);
      },
      onError: (x) => { setBusy(false); toast({ title: `Could not generate ${type}`, description: `${errMsg(x)} The record is unaffected; try again.`, variant: "destructive" }); },
    });
  };
  return { run, busy };
}

export function DocumentButton({ type, referenceId, label, children, fileName }: { type: "receipt" | "statement" | "invoice"; referenceId: string; label?: string; children?: ReactNode; fileName?: string }) {
  const { run, busy } = useDocumentDownload();
  return <Btn type="button" variant="outline" className="h-7 px-2 text-xs" disabled={busy} data-testid={`button-${type}-${referenceId}`} aria-label={label ?? `Download ${type}`} onClick={() => run(type, referenceId, fileName)}>
    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{children ?? (type === "receipt" ? "Receipt" : type === "invoice" ? "Invoice" : "Statement PDF")}
  </Btn>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return <CardTable><table className="w-full text-sm">
    <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-border/60">{children}</tbody>
  </table></CardTable>;
}
export const td = "px-4 py-2.5 align-top";
