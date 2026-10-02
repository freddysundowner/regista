import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAuditLogsQueryKey, getGetDashboardSummaryQueryKey, type FinanceRecord } from "@workspace/api-client-react";

/** Exact KES string, max 2 decimals, positive. Never parsed to float. */
export const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
export function validMoney(v: string) { return MONEY_RE.test(v.trim()) && toCents(v.trim()) > 0n; }

export function toCents(v: string): bigint {
  const neg = v.startsWith("-"); const s = neg ? v.slice(1) : v;
  const [i, f = ""] = s.split(".");
  const c = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -c : c;
}
export function fromCents(c: bigint): string {
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}
export function sumMoney(vs: (string | null | undefined)[]) { return fromCents(vs.reduce((t, v) => t + (v && /^-?\d+(\.\d+)?$/.test(v) ? toCents(v) : 0n), 0n)); }

/** Formats exact string as "KES 12,345.00" without float conversion. */
export function kes(v?: string | null, withCurrency = true) {
  if (v == null || v === "") return "\u2014";
  const s = String(v); if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const neg = s.startsWith("-"); const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const out = `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(f + "00").slice(0, 2)}`;
  return `${neg ? "-" : ""}${withCurrency ? "KES " : ""}${out}`;
}

/** Idempotency key: stable across retries of the same input; renewed when input changes or after success. */
export function useIdemKey(fingerprint: string) {
  const [gen, setGen] = useState(0);
  const key = useMemo(() => crypto.randomUUID(), [fingerprint, gen]); // eslint-disable-line react-hooks/exhaustive-deps
  const renew = useCallback(() => setGen((g) => g + 1), []);
  return { key, renew };
}

export function useFinanceInvalidate() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/finance") });
    qc.invalidateQueries({ queryKey: getListAuditLogsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }, [qc]);
}

export function str(o: Record<string, unknown> | undefined | null, k: string): string | undefined {
  const v = o?.[k]; return v == null || v === "" ? undefined : String(v);
}
export function rd(r: FinanceRecord, k: string) { return str(r.data, k); }

export type Line = { feeItemId: string; amount: string; description?: string };
export function recLines(r: FinanceRecord): Line[] {
  const l = r.data?.lines; return Array.isArray(l) ? (l as Line[]).filter((x) => x && typeof x === "object") : [];
}

export const KIND_LABEL: Record<string, string> = {
  fee_item: "Fee item", fee_structure: "Fee structure", optional_charge: "Optional charge", sponsor: "Sponsor", invoice: "Invoice",
  payment: "Payment", adjustment: "Adjustment", refund: "Refund request", refund_paid: "Refund payout", reversal: "Reversal", cheque_status: "Cheque status",
};
export const ADJ_LABEL: Record<string, string> = {
  discount: "Discount", sibling_discount: "Sibling discount", waiver: "Waiver", bursary: "Bursary", sponsorship: "Sponsorship", write_off: "Write-off", correction: "Correction",
};
export const SPONSOR_LABEL: Record<string, string> = { ngcdf: "NG-CDF", county: "County government", ngo: "NGO", church: "Church", individual: "Individual", company: "Company", other: "Other" };

export function recordTitle(r: FinanceRecord) {
  const t = rd(r, "adjustmentType");
  return rd(r, "name") ?? rd(r, "receiptNo") ?? rd(r, "invoiceNo") ?? (t ? ADJ_LABEL[t] ?? t : undefined) ?? KIND_LABEL[r.kind] ?? r.kind;
}
