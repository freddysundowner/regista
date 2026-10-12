import { useRef, useState } from "react";
import { useListSuppliers, getListSuppliersQueryKey, useRequestFileUpload, useCompleteFileUpload, getStoredFile, ExpenseInputCategory, FileUploadInputContentType } from "@workspace/api-client-react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Btn, NativeSelect, Pill } from "@/components/kit";
import { fileIdFromRef } from "@/components/stored-image";
import { errMsg, useSession } from "@/lib/session";

export const CATEGORY_LABEL: Record<string, string> = {
  salaries: "Salaries", statutory: "PAYE, NSSF & SHIF", food: "Food", transport: "Transport", fuel: "Fuel", supplies: "Supplies", stationery: "Stationery",
  books: "Books", cleaning: "Cleaning", uniforms: "Uniforms", medical: "Medical", exams: "Exams", events: "Trips & events", utilities: "Utilities (power, water, internet)",
  repairs: "Repairs", furniture: "Furniture & equipment", rent: "Rent", bank_charges: "Bank charges", other: "Other",
};
export const CATEGORIES = Object.values(ExpenseInputCategory);
export const categoryName = (c: string) => (CATEGORY_LABEL[c] ?? c).split(" (")[0];
export const METHOD_LABEL: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank", cheque: "Cheque" };
export const ks = (v?: string | number | null) => `KES ${Number(v ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
export const qtyText = (v?: string | null) => Number(v ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 });

export function CategorySelect({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }) {
  return <NativeSelect data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</NativeSelect>;
}

/** Active suppliers; `allowNone` adds a blank first choice. */
export function SupplierSelect({ value, onChange, allowNone, testid }: { value: string; onChange: (v: string) => void; allowNone?: string; testid?: string }) {
  const q = useListSuppliers({ query: { queryKey: getListSuppliersQueryKey() } });
  const list = (q.data ?? []).filter((s) => s.isActive || s.id === value);
  return (
    <NativeSelect data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} disabled={q.isLoading}>
      <option value="">{allowNone ?? (q.isLoading ? "Loading" : list.length ? "Choose a supplier" : "No suppliers yet")}</option>
      {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </NativeSelect>
  );
}

const MAX = 5 * 1024 * 1024;
const TYPES = Object.values(FileUploadInputContentType) as string[];

/** Attach a receipt or invoice: a photo or a PDF. Gives back the stored file reference. */
export function AttachmentInput({ value, onChange, label = "Attach receipt", testid = "attachment" }: { value: string; onChange: (ref: string) => void; label?: string; testid?: string }) {
  const { school } = useSession();
  const req = useRequestFileUpload();
  const done = useCompleteFileUpload();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const handle = async (file: File) => {
    setErr(null);
    if (!TYPES.includes(file.type)) return setErr("Use a photo (JPEG, PNG, WebP) or a PDF.");
    if (file.size > MAX) return setErr("The file must be 5 MB or smaller.");
    setBusy(true);
    try {
      const up = await req.mutateAsync({ data: { name: file.name.slice(0, 180), size: file.size, contentType: file.type as FileUploadInputContentType, purpose: "finance_document", entityId: school.id } });
      const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("The upload did not complete. Try again.");
      const ref = await done.mutateAsync({ fileId: up.id });
      setName(file.name);
      onChange(ref.objectPath);
    } catch (x) { setErr(errMsg(x, "Upload failed")); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <div className="flex flex-col gap-1">
      <input ref={input} type="file" accept={TYPES.join(",")} className="sr-only" aria-label={label} data-testid={`input-${testid}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); }} />
      {value ? (
        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm">
          <Paperclip className="h-3.5 w-3.5 text-primary" /><span className="max-w-[14rem] truncate">{name || "Attached"}</span>
          <button type="button" aria-label="Remove attachment" onClick={() => { onChange(""); setName(""); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </span>
      ) : (
        <Btn type="button" variant="outline" className="h-9 justify-start" disabled={busy} data-testid={`button-${testid}`} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}{busy ? "Uploading" : label}
        </Btn>
      )}
      {err && <span role="alert" className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

/** Opens an attached receipt or invoice in a new tab. */
export function AttachmentLink({ refPath, label = "Receipt" }: { refPath?: string | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  const id = fileIdFromRef(refPath);
  if (!id) return null;
  const open = async () => {
    // Open the tab first so the browser doesn't treat it as a popup.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const blob = await getStoredFile(id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { tab?.close(); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void open()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid={`link-attachment-${id}`}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}{label}
    </button>
  );
}

const LPO_STATUS: Record<string, { tone: string; label: string }> = {
  pending: { tone: "duplicate", label: "Waiting for approval" }, approved: { tone: "current", label: "Approved" }, rejected: { tone: "error", label: "Rejected" },
  partly_received: { tone: "duplicate", label: "Partly delivered" }, received: { tone: "active", label: "Delivered" }, cancelled: { tone: "inactive", label: "Cancelled" },
};
export const lpoStatusLabel = (s: string) => LPO_STATUS[s]?.label ?? s;
export function LpoStatus({ status }: { status: string }) {
  const s = LPO_STATUS[status] ?? { tone: "left", label: status };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
const INVOICE_STATE: Record<string, { tone: string; label: string }> = {
  unpaid: { tone: "current", label: "Unpaid" }, part_paid: { tone: "duplicate", label: "Part paid" }, overdue: { tone: "error", label: "Overdue" }, paid: { tone: "active", label: "Paid" }, voided: { tone: "inactive", label: "Voided" },
};
export function InvoiceState({ state }: { state: string }) {
  const s = INVOICE_STATE[state] ?? { tone: "left", label: state };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
