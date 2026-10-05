import { useRef, useState, type DragEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { usePreviewStudentImport, useCommitStudentImport, getListStudentsQueryKey, getListGuardiansQueryKey, getListFamiliesQueryKey, getGetDashboardSummaryQueryKey, getListGradesQueryKey, getListStreamsQueryKey, getListAuditLogsQueryKey, type StudentImportRow, type StudentImportPreview, type StudentImportResult } from "@workspace/api-client-react";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { PageHeader, Panel, Btn, FormError, Pill, CardTable } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { cn } from "@/lib/utils";

const COLS: (keyof StudentImportRow)[] = ["admissionNo", "firstName", "middleName", "lastName", "gender", "dateOfBirth", "gradeName", "streamName", "boardingStatus", "admissionDate", "guardianName", "guardianPhone", "guardianRelationship"];
const REQUIRED = new Set(["admissionNo", "firstName", "lastName"]);

async function loadExcel() {
  const mod = await import("exceljs/dist/exceljs.min.js");
  return mod.default;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return cellText(o.result);
    return "";
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function toRows(grid: string[][]): { rows: StudentImportRow[]; missing: string[] } {
  const header = (grid[0] ?? []).map((h) => h.trim());
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const idx = new Map<string, number>();
  COLS.forEach((c) => { const i = header.findIndex((h) => norm(h) === norm(c)); if (i >= 0) idx.set(c, i); });
  const missing = [...REQUIRED].filter((c) => !idx.has(c));
  const rows = grid.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const o: Record<string, string | null> = {};
    COLS.forEach((c) => { const i = idx.get(c); const v = i == null ? "" : (r[i] ?? "").trim(); o[c] = REQUIRED.has(c) ? v : v || null; });
    return o as unknown as StudentImportRow;
  });
  return { rows, missing };
}

export default function ImportPage() {
  const qc = useQueryClient();
  const preview = usePreviewStudentImport();
  const commit = useCommitStudentImport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<StudentImportRow[]>([]);
  const [pv, setPv] = useState<StudentImportPreview | null>(null);
  const [result, setResult] = useState<StudentImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState<"all" | "valid" | "error" | "duplicate">("all");
  const [tplBusy, setTplBusy] = useState(false);

  const reset = () => { setFile(null); setRows([]); setPv(null); setResult(null); setErr(null); setFilter("all"); if (fileRef.current) fileRef.current.value = ""; };

  const downloadTemplate = async () => {
    setTplBusy(true);
    try {
      const ExcelJS = await loadExcel();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Students");
      ws.columns = COLS.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 4) }));
      ws.addRow({ admissionNo: "ADM/2025/001", firstName: "Achieng", middleName: "Grace", lastName: "Otieno", gender: "female", dateOfBirth: "2016-03-14", gradeName: "Grade 4", streamName: "East", boardingStatus: "day", admissionDate: "2025-01-06", guardianName: "Mary Otieno", guardianPhone: "0712345678", guardianRelationship: "Mother" });
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = "student-import-template.xlsx"; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr(errMsg(e, "Could not build template")); } finally { setTplBusy(false); }
  };

  const handleFile = async (f: File) => {
    reset(); setParsing(true); setFile(f.name);
    try {
      let grid: string[][];
      if (/\.csv$/i.test(f.name)) grid = parseCsv(await f.text());
      else if (/\.xlsx$/i.test(f.name)) {
        const ExcelJS = await loadExcel();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) throw new Error("The workbook has no sheets.");
        grid = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          for (let i = 1; i <= ws.columnCount; i++) vals.push(cellText(row.getCell(i).value));
          grid.push(vals);
        });
      } else throw new Error("Use an .xlsx or .csv file.");
      const { rows: parsed, missing } = toRows(grid);
      if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}. Download the template for exact headings.`);
      if (!parsed.length) throw new Error("No data rows found below the header.");
      if (parsed.length > 1000) throw new Error(`File has ${parsed.length} rows; split it into batches of 1,000 or fewer.`);
      setRows(parsed);
      preview.mutate({ data: { rows: parsed } }, { onSuccess: setPv, onError: (x) => setErr(errMsg(x, "Validation failed")) });
    } catch (e) { setErr(errMsg(e, "Could not read file")); } finally { setParsing(false); }
  };

  const doCommit = () => commit.mutate({ data: { rows } }, {
    onSuccess: (r) => {
      setResult(r);
      [getListStudentsQueryKey(), getListGuardiansQueryKey(), getListFamiliesQueryKey(), getGetDashboardSummaryQueryKey(), getListGradesQueryKey(), getListStreamsQueryKey(), getListAuditLogsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (x) => setErr(errMsg(x, "Import failed")),
  });

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  const step = result ? 3 : pv ? 2 : 1;
  const shown = pv?.rows.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Bulk admission" title="Import register" meta="Upload the class lists you already keep in Excel. Nothing is saved until you confirm.">
        <Btn data-testid="button-download-template" variant="outline" disabled={tplBusy} onClick={downloadTemplate}>{tplBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Template (.xlsx)</Btn>
      </PageHeader>

      <ol className="rise rise-1 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-card-border bg-border text-sm">
        {["Choose file", "Review validation", "Committed"].map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2.5 bg-card px-4 py-3", step === i + 1 && "bg-accent/40")}>
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border font-mono text-xs", step > i + 1 ? "border-primary bg-primary text-primary-foreground" : step === i + 1 ? "border-amber-600 text-amber-800" : "border-input text-muted-foreground")}>{i + 1}</span>
            <span className={cn("hidden sm:inline", step >= i + 1 ? "font-semibold" : "text-muted-foreground")}>{s}</span>
          </li>
        ))}
      </ol>

      {result ? (
        <Panel className="rise">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <h2 className="font-display text-2xl font-semibold">Import committed</h2>
            <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              {[["Students created", result.createdStudents], ["Guardians linked", result.linkedGuardians], ["Sibling groups", result.siblingGroupsCreated], ["Rows skipped", result.skippedRows]].map(([k, v]) => (
                <div key={k as string} className="bg-card px-5 py-3"><div data-testid={`result-${k}`} className="font-display text-2xl font-semibold tabular-nums">{v}</div><div className="text-[11px] text-muted-foreground">{k}</div></div>
              ))}
            </div>
            <div className="mt-4 flex gap-2"><Link href="/students" className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground">View students</Link><Btn variant="outline" data-testid="button-import-another" onClick={reset}>Import another file</Btn></div>
          </div>
        </Panel>
      ) : !pv ? (
        <Panel className="rise-2">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} data-testid="dropzone"
            className={cn("m-4 flex cursor-pointer flex-col items-center gap-3 rounded-md border-2 border-dashed px-6 py-14 text-center transition", drag ? "scale-[1.01] border-primary bg-primary/5" : "border-input hover:border-primary/50 hover:bg-accent/20")}>
            {parsing || preview.isPending ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-primary" />}
            <div className="font-display text-xl font-semibold">{parsing ? `Reading ${file}…` : preview.isPending ? `Validating ${rows.length} rows…` : "Drop your .xlsx or .csv here"}</div>
            <p className="max-w-md text-sm text-muted-foreground">First row must be the template headings. Required: <span className="font-mono text-xs">admissionNo, firstName, lastName</span>. Grades and streams match by name.</p>
            <input ref={fileRef} data-testid="input-file" type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
          {err && <div className="px-4 pb-4"><FormError msg={err} /></div>}
        </Panel>
      ) : (
        <Panel className="rise">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-3">
            <FileSpreadsheet className="h-4 w-4 text-primary" /><span className="font-semibold">{file}</span>
            <span className="text-xs text-muted-foreground">{pv.totalRows} rows · {pv.siblingMatches} sibling matches</span>
            <div className="ml-auto inline-flex rounded-md border border-border p-0.5 text-xs">
              {([["all", pv.totalRows], ["valid", pv.validRows], ["error", pv.errorRows], ["duplicate", pv.duplicateRows]] as const).map(([k, n]) => (
                <button key={k} data-testid={`filter-${k}`} onClick={() => setFilter(k)} className={cn("rounded px-2.5 py-1 font-semibold capitalize", filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{k} <span className="tabular-nums opacity-70">{n}</span></button>
              ))}
            </div>
          </div>
          <div className="max-h-[60dvh] overflow-auto md:max-h-[480px]">
            <CardTable><table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2">Row</th><th className="px-3 py-2">Adm. no</th><th className="px-3 py-2">Student</th><th className="hidden px-3 py-2 md:table-cell">Guardian phone</th><th className="px-3 py-2">Result</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.rowNumber} data-testid={`row-preview-${r.rowNumber}`} className={cn("border-b border-border/40 align-top", r.status === "error" && "bg-destructive/[0.03]")}>
                  <td className="px-5 py-2 font-mono text-xs text-muted-foreground">{r.rowNumber}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.admissionNo || "—"}</td>
                  <td className="px-3 py-2 font-medium">{r.studentName}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{r.guardianPhone ?? "—"}</td>
                  <td className="px-3 py-2"><Pill tone={r.status}>{r.status}</Pill>
                    {r.errors.map((e, i) => <div key={i} className="mt-1 text-xs text-destructive">{e}</div>)}
                    {r.warnings.map((w, i) => <div key={i} className="mt-1 text-xs text-amber-800">{w}</div>)}
                  </td>
                </tr>))}</tbody>
            </table></CardTable>
          </div>
          <div className="space-y-3 border-t border-border/70 p-5">
            <FormError msg={err} />
            <div className="flex flex-wrap items-center gap-2">
              <Btn data-testid="button-commit" disabled={pv.validRows === 0 || commit.isPending} onClick={doCommit}>{commit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Import {pv.validRows} valid row{pv.validRows === 1 ? "" : "s"}</Btn>
              <Btn variant="ghost" data-testid="button-reset" onClick={reset}><RotateCcw className="h-4 w-4" /> Choose another file</Btn>
              {pv.errorRows + pv.duplicateRows > 0 && <span className="text-xs text-muted-foreground">{pv.errorRows + pv.duplicateRows} row(s) will be skipped. Fix them in the spreadsheet and re-import later.</span>}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
