import { useState, type FormEvent } from "react";
import { useGetSchoolReport, useExportSchoolReport, useExportKnecResults, type ReportView, type ReportFilterInput } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, BarChart3, Download, FileDown, Loader2 } from "lucide-react";
import { PageHeader, Panel, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { StudentPicker, TermSelect, GradeSelect, MoneyInput, Table, td } from "@/components/finance-kit";
import { usePerms, errMsg, fmtDateTime } from "@/lib/session";
import { exportXlsx, exportCsv } from "@/lib/sheets";
import { useToast } from "@/hooks/use-toast";

type F = "dates" | "term" | "grade" | "student" | "balance" | "plan";
const TYPES: { id: string; label: string; f: F[]; finance?: boolean; academic?: boolean }[] = [
  { id: "collections", label: "Collections", f: ["dates", "grade"], finance: true },
  { id: "fee-items", label: "Collections by fee item", f: ["dates", "term", "grade"], finance: true },
  { id: "balances", label: "Balances", f: ["term", "grade", "balance"], finance: true },
  { id: "defaulters", label: "Defaulters", f: ["term", "grade", "balance", "plan"], finance: true },
  { id: "aged-arrears", label: "Aged arrears", f: ["grade", "balance"], finance: true },
  { id: "unmatched", label: "Unmatched payments", f: ["dates"], finance: true },
  { id: "reconciliation", label: "Reconciliation", f: ["dates"], finance: true },
  { id: "adjustments", label: "Waivers and adjustments", f: ["dates", "term"], finance: true },
  { id: "sponsors", label: "Sponsors", f: ["term"], finance: true },
  { id: "plans", label: "Payment plans", f: ["term", "grade"], finance: true },
  { id: "statement", label: "Learner statement", f: ["student", "dates"], finance: true },
  { id: "performance", label: "Performance / KNEC", f: ["term", "grade", "student"], academic: true },
  { id: "attendance", label: "Attendance", f: ["dates", "grade", "student"], academic: true },
];

function KnecServer() {
  const m = useExportKnecResults(); const { toast } = useToast();
  const [f, setF] = useState({ termId: "", gradeId: "" });
  const go = (format: "csv" | "xlsx") => { if (!f.termId) return void toast({ title: "Choose the term", variant: "destructive" });
    m.mutate({ data: { termId: f.termId, ...(f.gradeId ? { gradeId: f.gradeId } : {}), format } }, { onSuccess: (d) => window.open(d.downloadUrl, "_blank", "noopener"), onError: (x) => toast({ title: "KNEC export failed", description: errMsg(x), variant: "destructive" }) }); };
  return (
    <Panel title="KNEC export (school columns)" note="Uses the column order saved in school settings (admission no., UPI, name, learning area, percent, level, term). Values come straight from the database; a missing UPI stays blank. Check against the current KNEC upload template before submitting.">
      <div className="grid gap-3 p-5 sm:grid-cols-2"><TermSelect required value={f.termId} onChange={(v) => setF({ ...f, termId: v })} /><GradeSelect allowNone="All grades" value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} /></div>
      <div className="flex gap-2 border-t border-border/70 p-4"><Btn variant="outline" disabled={m.isPending} onClick={() => go("csv")}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}KNEC CSV</Btn><Btn variant="outline" disabled={m.isPending} onClick={() => go("xlsx")}><FileDown className="h-4 w-4" />KNEC Excel</Btn></div>
    </Panel>
  );
}

function Knec({ r }: { r: ReportView }) {
  const [cols, setCols] = useState(r.columns.map((c) => ({ ...c, on: true })));
  const move = (i: number, d: number) => { const n = [...cols]; [n[i], n[i + d]] = [n[i + d], n[i]]; setCols(n); };
  const chosen = cols.filter((c) => c.on);
  return (
    <Panel title="Custom column export" note="Ad-hoc: choose, rename and order the performance report columns for this download only.">
      <ul className="divide-y divide-border/60">{cols.map((c, i) => (
        <li key={c.key} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm sm:flex-nowrap">
          <input type="checkbox" aria-label={`Include ${c.key}`} className="h-4 w-4 accent-[hsl(var(--primary))]" checked={c.on} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
          <span className="min-w-0 flex-1 truncate font-mono sm:w-32 sm:flex-none text-xs text-muted-foreground">{c.key}</span>
          <TextInput aria-label="Header" className="order-last min-w-0 basis-full sm:order-none sm:h-8 sm:max-w-xs sm:basis-auto" value={c.label} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button type="button" aria-label="Move up" disabled={!i} onClick={() => move(i, -1)} className="flex h-10 w-10 items-center justify-center rounded disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label="Move down" disabled={i === cols.length - 1} onClick={() => move(i, 1)} className="flex h-10 w-10 items-center justify-center rounded disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1"><ArrowDown className="h-4 w-4" /></button>
        </li>))}</ul>
      <div className="flex gap-2 border-t border-border/70 p-4">
        <Btn variant="outline" disabled={!chosen.length} onClick={() => exportCsv(chosen, r.rows, "knec-export")}><FileDown className="h-4 w-4" />KNEC CSV</Btn>
        <Btn variant="outline" disabled={!chosen.length} onClick={() => void exportXlsx("KNEC", chosen, r.rows, "knec-export")}><FileDown className="h-4 w-4" />KNEC Excel</Btn>
      </div>
    </Panel>
  );
}

export default function Reports() {
  const p = usePerms(); const { toast } = useToast();
  const types = TYPES.filter((t) => (t.finance && p.financeRead) || (t.academic && (p.academicRead || p.financeRead)));
  const [type, setType] = useState(types[0]?.id ?? "");
  const [f, setF] = useState({ from: "", to: "", termId: "", gradeId: "", studentId: "", minimumBalance: "", activePlan: "" });
  const [err, setErr] = useState<string | null>(null);
  const run = useGetSchoolReport(); const ex = useExportSchoolReport();
  const [result, setResult] = useState<{ type: string; r: ReportView } | null>(null);
  const t = types.find((x) => x.id === type);
  const body = (): ReportFilterInput | null => {
    if (!t) return null;
    if (t.f.includes("student") && type === "statement" && !f.studentId) { setErr("Choose the learner."); return null; }
    if (f.from && f.to && f.to < f.from) { setErr("The end date is before the start date."); return null; }
    const has = (k: F) => t.f.includes(k);
    return { ...(has("dates") && f.from ? { from: f.from } : {}), ...(has("dates") && f.to ? { to: f.to } : {}), ...(has("term") && f.termId ? { termId: f.termId } : {}),
      ...(has("grade") && f.gradeId ? { gradeId: f.gradeId } : {}), ...(has("student") && f.studentId ? { studentId: f.studentId } : {}),
      ...(has("balance") && f.minimumBalance ? { minimumBalance: f.minimumBalance } : {}), ...(has("plan") && f.activePlan ? { activePlan: f.activePlan === "yes" } : {}) };
  };
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); const b = body(); if (!b) return;
    run.mutate({ type, data: { ...b, format: "json" } }, { onSuccess: (r) => setResult({ type, r }), onError: (x) => { setResult(null); setErr(errMsg(x)); } }); };
  const serverFile = (format: "xlsx" | "pdf") => { setErr(null); const b = body(); if (!b) return;
    ex.mutate({ type, data: { ...b, format } }, { onSuccess: (d) => window.open(d.downloadUrl, "_blank", "noopener"), onError: (x) => toast({ title: `${format.toUpperCase()} export failed`, description: errMsg(x), variant: "destructive" }) }); };
  const show = (k: F) => t?.f.includes(k);
  const r = result?.type === type ? result.r : null;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Insight" title="Reports" meta={p.limitedToAssigned ? "Academic reports for your assigned classes." : "Run a report, read it here, then export. Exports contain exactly the rows shown."} />
      {!types.length ? <Panel><Empty icon={<BarChart3 className="h-5 w-5" />} title="No reports for your role" body="Ask your administrator if you need access." /></Panel> : (
        <Panel>
          <form onSubmit={submit} data-readonly-safe="report-run" className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Report type">
                <NativeSelect data-testid="select-report-type" value={type} onChange={e => { setType(e.target.value); setErr(null); }}>
                  {types.some(x => x.finance) && <optgroup label="Finance">{types.filter(x => x.finance).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>}
                  {types.some(x => x.academic) && <optgroup label="Academics">{types.filter(x => x.academic).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>}
                </NativeSelect>
              </Field>
              {show("dates") && <><Field label="From"><TextInput type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><TextInput type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></>}
              {show("term") && <TermSelect allowNone="Any term" value={f.termId} onChange={(v) => setF({ ...f, termId: v })} />}
              {show("grade") && <GradeSelect allowNone="All grades" value={f.gradeId} onChange={(v) => setF({ ...f, gradeId: v })} />}
              {show("balance") && <Field label="Minimum balance (KES)"><MoneyInput value={f.minimumBalance} onChange={(v) => setF({ ...f, minimumBalance: v })} /></Field>}
              {show("plan") && <Field label="Payment plan"><select className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm" value={f.activePlan} onChange={(e) => setF({ ...f, activePlan: e.target.value })}><option value="">Any</option><option value="yes">With active plan</option><option value="no">Without plan</option></select></Field>}
              {show("student") && <StudentPicker required={type === "statement"} value={f.studentId} onChange={(v) => setF({ ...f, studentId: v })} />}
            </div>
            <FormError msg={err} />
            <FormActions>
              <Btn type="submit" data-testid="button-run-report" disabled={run.isPending}>{run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}Run report</Btn>
              <Btn type="button" variant="outline" disabled={ex.isPending} onClick={() => serverFile("pdf")}><Download className="h-4 w-4" />Export PDF</Btn>
              <Btn type="button" variant="outline" disabled={ex.isPending} onClick={() => serverFile("xlsx")}><Download className="h-4 w-4" />Export Excel</Btn>
            </FormActions>
          </form>
        </Panel>
      )}
      {r && (
        <Panel title={r.title} note={`${r.rows.length} rows · generated ${fmtDateTime(r.generatedAt)}`} action={<div className="flex gap-2">
          <Btn variant="outline" className="h-8" disabled={!r.rows.length} onClick={() => void exportXlsx(r.title, r.columns, r.rows, `${type}-report`)}><FileDown className="h-4 w-4" />Excel</Btn>
          <Btn variant="outline" className="h-8" disabled={!r.rows.length} onClick={() => exportCsv(r.columns, r.rows, `${type}-report`)}><FileDown className="h-4 w-4" />CSV</Btn></div>}>
          {!r.rows.length ? <Empty icon={<BarChart3 className="h-5 w-5" />} title="No rows" body="Nothing matches these filters." /> : (
            <Table head={r.columns.map((c) => c.label)}>{r.rows.slice(0, 500).map((row, i) => <tr key={i}>{r.columns.map((c) => <td key={c.key} className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row[c.key] == null ? "\u2014" : String(row[c.key])}</td>)}</tr>)}</Table>
          )}
          {r.rows.length > 500 && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">Showing 500 of {r.rows.length}; exports include all rows.</p>}
        </Panel>
      )}
      {type === "performance" && <KnecServer />}
      {r && type === "performance" && r.rows.length > 0 && <Knec key={r.generatedAt} r={r} />}
    </div>
  );
}
