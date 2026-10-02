import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import type { IncomingInput, StatementFileInput, StatementInput } from "@workspace/api-zod";
import { ApiError, type Actor } from "../core";
import { money, sum } from "../finance/money";
import { json } from "../finance/posting";
import { ingest } from "../payments/pipeline";

export interface BankAdapter {
  name: string;
  verifyWebhook(raw: Buffer, headers: Record<string, string>): Promise<boolean>;
  parseNotification(payload: unknown): IncomingInput;
  fetchTransactions(account: string, from: Date, to: Date): Promise<IncomingInput[]>;
}
export function selectedBankAdapter(): never {
  throw new ApiError(503, "Live bank adapter unavailable: pilot bank and approved notification/statement API contract have not been supplied");
}
export function csvRows(content: string) {
  const rows: string[][] = [], row: string[] = [];
  let current = "", quoted = false;
  for (let i = 0; i <= content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
    } else if ((c === "," || c === "\n" || c === undefined) && !quoted) {
      row.push(current.replace(/\r$/, "")); current = "";
      if (c !== ",") { if (row.some(Boolean)) rows.push([...row]); row.length = 0; }
    } else if (c !== undefined) current += c;
  }
  if (quoted) throw new ApiError(400, "Unclosed CSV quoted field");
  return rows;
}
export async function previewStatement(input: StatementFileInput) {
  let table: string[][] = [];
  if (input.format === "csv") table = csvRows(input.content);
  if (input.format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(input.content, "base64") as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ApiError(400, "Workbook has no worksheet");
    sheet.eachRow(row => {
      table.push(Array.from({ length: sheet.columnCount }, (_, i) => {
        const cell = row.getCell(i + 1);
        return cell.value instanceof Date ? cell.value.toISOString() : cell.text;
      }));
    });
  }
  if (input.format === "mt940") {
    // Parse only unambiguous credit :61: records with an explicit bank reference.
    // No invented payer identities; unsupported variants surface row errors.
    table = [["reference", "amount", "date", "narrative"]];
    for (const line of input.content.split(/\r?\n/)) if (line.startsWith(":61:")) {
      const match = /^:61:(\d{6})(?:\d{4})?C([A-Z])?(\d+,\d{0,2})[A-Z]\w{3}([^/]*)(?:\/\/(.+))?$/.exec(line);
      if (!match) throw new ApiError(400, "Unsupported MT940 :61: record; provide a mapped CSV/Excel statement including unique transaction references");
      const [, stamp, , amount, customerRef, bankRef] = match;
      if (!bankRef) throw new ApiError(400, "MT940 bank reference is required for idempotent ingestion");
      table.push([bankRef, amount.replace(",", "."), `20${stamp.slice(0, 2)}-${stamp.slice(2, 4)}-${stamp.slice(4, 6)}T00:00:00+03:00`, customerRef]);
    }
  }
  if (table.length > 10001) throw new ApiError(400, "Statement exceeds 10,000 rows");
  const mapping = input.format === "mt940" ? { providerTxnId: "reference", amount: "amount", transactionTime: "date", accountReference: "narrative" } : input.mapping;
  if (!mapping) throw new ApiError(400, "Column mapping required");
  const header = table.shift() ?? [], rows: IncomingInput[] = [], errors: { row: number; message: string }[] = [];
  for (const key of ["providerTxnId", "amount", "transactionTime"] as const) if (!header.includes(mapping[key])) throw new ApiError(400, `Mapped column missing: ${mapping[key]}`);
  table.forEach((values, index) => {
    try {
      const fields: Record<string, string> = {};
      for (const [key, column] of Object.entries(mapping)) if (column) fields[key] = values[header.indexOf(column)]?.trim() ?? "";
      const amount = money(fields.amount);
      if (!amount.greaterThan(0) || !fields.providerTxnId || !Number.isFinite(Date.parse(fields.transactionTime))) throw new Error("Unique transaction reference, positive amount and ISO date are required");
      rows.push({ provider: input.provider, providerTxnId: fields.providerTxnId, channel: "bank", amount: amount.toFixed(2), transactionTime: new Date(fields.transactionTime), accountReference: fields.accountReference, payerPhone: fields.payerPhone, payerName: fields.payerName });
    } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Invalid row" }); }
  });
  return { rows, errors };
}
export async function reconcileStatement(actor: Actor, input: StatementInput) {
  if (new Date(input.toDate) < new Date(input.fromDate)) throw new ApiError(400, "Invalid statement date range");
  if (input.rows.some(r => r.provider !== input.provider || new Date(r.transactionTime) < new Date(input.fromDate) || new Date(r.transactionTime) > new Date(input.toDate))) throw new ApiError(400, "Statement rows must match provider and date range");
  if (new Set(input.rows.map(r => r.providerTxnId)).size !== input.rows.length) throw new ApiError(400, "Duplicate transaction identities within statement");
  const existing = await db.incomingPayment.findMany({ where: { schoolId: actor.school.id, provider: input.provider, transactionTime: { gte: input.fromDate, lte: input.toDate } } });
  const discrepancies: { type: string; providerTxnId: string; detail: string }[] = [];
  for (const row of input.rows) {
    const prior = existing.find(p => p.providerTxnId === row.providerTxnId);
    if (prior && !prior.amount.equals(row.amount)) discrepancies.push({ type: "amount_mismatch", providerTxnId: row.providerTxnId, detail: `Statement ${row.amount}; system ${prior.amount.toFixed(2)}` });
    else if (!prior) {
      await ingest(actor, row, "statement_recon");
      discrepancies.push({ type: "missed_callback_ingested", providerTxnId: row.providerTxnId, detail: "Queued through normal matching pipeline" });
    }
  }
  if (input.completeStatement) for (const prior of existing) if (!input.rows.some(r => r.providerTxnId === prior.providerTxnId)) discrepancies.push({ type: "missing_from_statement", providerTxnId: prior.providerTxnId, detail: "Review provider evidence; no automatic reversal" });
  return db.reconciliationRun.create({ data: { schoolId: actor.school.id, provider: input.provider, fromDate: input.fromDate, toDate: input.toDate, status: discrepancies.length ? "review_required" : input.completeStatement ? "matched" : "partial_statement", statementCount: input.rows.length, systemCount: existing.length, statementTotal: sum(input.rows.map(r => money(r.amount))), systemTotal: sum(existing.map(p => p.amount)), discrepancies: json(discrepancies) } });
}