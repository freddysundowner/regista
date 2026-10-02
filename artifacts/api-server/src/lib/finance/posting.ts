import { db, Prisma, type FinanceRecord } from "@workspace/db";
import { ApiError, audit, lock, owned, type Actor, type Tx } from "../core";
import { minimum, money, sum, zero } from "./money";

export type Metadata = Record<string, any>;
export const metadata = (record: FinanceRecord) => record.data as Metadata;
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const view = (value: unknown): any => JSON.parse(JSON.stringify(value));
export async function record(tx: Tx, schoolId: string, id: string, kind?: string) {
  const found = await tx.financeRecord.findFirst({ where: { id, schoolId, ...(kind ? { kind } : {}) } });
  if (!found) throw new ApiError(404, "Finance record not found");
  return found;
}
export async function financeTransaction<T>(actor: Actor, fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => {
    await lock(tx, actor.school.id);
    return fn(tx);
  }, { timeout: 60000 });
}
export async function counter(tx: Tx, schoolId: string, kind: "invoice" | "receipt") {
  const result = await tx.financeCounter.upsert({
    where: { schoolId }, create: { schoolId, [kind]: 1 }, update: { [kind]: { increment: 1 } },
  });
  return `${kind === "invoice" ? "INV" : "RCT"}-${new Date().getUTCFullYear()}-${String(result[kind]).padStart(6, "0")}`;
}
export async function outbox(tx: Tx, schoolId: string, event: string, referenceId: string, payload: unknown) {
  await tx.financeOutbox.create({ data: { schoolId, event, referenceId, payload: json(payload) } });
}
export async function ledger(tx: Tx, actor: Actor, input: {
  studentId: string; termId?: string | null; type: string; debit?: Prisma.Decimal; credit?: Prisma.Decimal;
  referenceId: string; referenceType: string; description: string; reversesId?: string;
}) {
  await owned(tx, "student", input.studentId, actor.school.id);
  const debit = input.debit ?? zero(), credit = input.credit ?? zero();
  if (debit.lessThan(0) || credit.lessThan(0) || (debit.greaterThan(0) && credit.greaterThan(0))) throw new ApiError(400, "Invalid ledger posting");
  const entry = await tx.ledgerEntry.create({ data: { ...input, schoolId: actor.school.id, createdBy: actor.user.id, debit, credit } });
  await tx.studentBalance.upsert({
    where: { studentId: input.studentId },
    create: { schoolId: actor.school.id, studentId: input.studentId, balance: debit.minus(credit) },
    update: { balance: { increment: debit.minus(credit) } },
  });
  await audit(tx, actor, "posted", "ledger", entry.id, undefined, view(entry));
  return entry;
}

// Allocation changes are also append-only: negate the prior net positions, then
// allocate the remaining credit sources in chronological order to oldest invoices.
// The school advisory lock serializes both postings and allocation rebuilding.
export async function allocate(tx: Tx, actor: Actor, studentId: string) {
  const schoolId = actor.school.id;
  const old = await tx.feeAllocation.findMany({ where: { schoolId, studentId, reversesId: null } });
  const reversed = new Set((await tx.feeAllocation.findMany({ where: { schoolId, studentId, reversesId: { not: null } } })).map(a => a.reversesId));
  for (const a of old) if (!reversed.has(a.id)) {
    await tx.feeAllocation.create({ data: {
      schoolId, studentId, sourceId: a.sourceId, invoiceId: a.invoiceId, invoiceLineId: a.invoiceLineId,
      amount: a.amount.negated(), createdBy: actor.user.id, reversesId: a.id,
    } });
  }
  const entries = await tx.ledgerEntry.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const reversedEntries = new Set(entries.map(e => e.reversesId).filter(Boolean));
  const credits = entries.filter(e => e.credit.greaterThan(0) && !e.reversesId && !reversedEntries.has(e.id))
    .map(e => ({ sourceId: e.referenceId, remaining: e.credit }));
  let consumed = sum(entries.filter(e => !["invoice", "reversal"].includes(e.type) && !reversedEntries.has(e.id)).map(e => e.debit));
  for (const source of credits) {
    const take = minimum(source.remaining, consumed);
    source.remaining = source.remaining.minus(take); consumed = consumed.minus(take);
  }
  const invoices = await tx.financeRecord.findMany({
    where: { schoolId, studentId, kind: "invoice", status: { not: "cancelled" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  invoices.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || String(metadata(a).invoiceNo).localeCompare(String(metadata(b).invoiceNo)));
  for (const invoice of invoices) {
    let paid = zero();
    const lines = await tx.invoiceLine.findMany({ where: { schoolId, invoiceId: invoice.id }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
    for (const line of lines) {
      let remaining = line.amount;
      for (const source of credits) {
        if (!remaining.greaterThan(0)) break;
        const take = minimum(source.remaining, remaining);
        if (!take.greaterThan(0)) continue;
        await tx.feeAllocation.create({ data: {
          schoolId, studentId, sourceId: source.sourceId, invoiceId: invoice.id,
          invoiceLineId: line.id, amount: take, createdBy: actor.user.id,
        } });
        source.remaining = source.remaining.minus(take); remaining = remaining.minus(take); paid = paid.plus(take);
      }
    }
    await tx.financeRecord.update({ where: { id: invoice.id }, data: {
      status: paid.equals(invoice.amount) ? "paid" : paid.greaterThan(0) ? "partially_paid" : "open",
    } });
  }
}
export async function postInvoice(tx: Tx, actor: Actor, input: {
  studentId: string; termId?: string; uniqueKey: string; dueDate: string;
  lines: { feeItemId: string; amount: string; description?: string }[]; type: "term" | "one_off";
}) {
  const schoolId = actor.school.id;
  const existing = await tx.financeRecord.findUnique({ where: { schoolId_kind_uniqueKey: { schoolId, kind: "invoice", uniqueKey: input.uniqueKey } } });
  if (existing) return existing;
  await owned(tx, "student", input.studentId, schoolId);
  if (input.termId) await owned(tx, "term", input.termId, schoolId);
  if (!input.lines.length) throw new ApiError(400, "Invoice requires at least one line");
  const lines = [];
  for (const line of input.lines) {
    const item = await record(tx, schoolId, line.feeItemId, "fee_item");
    const amount = money(line.amount);
    if (!amount.greaterThan(0)) throw new ApiError(400, "Invoice amounts must be positive");
    lines.push({ feeItemId: item.id, amount, description: line.description ?? metadata(item).name, priority: metadata(item).priority });
  }
  const amount = sum(lines.map(l => l.amount));
  const invoice = await tx.financeRecord.create({ data: {
    schoolId, studentId: input.studentId, termId: input.termId, kind: "invoice", uniqueKey: input.uniqueKey,
    requestedBy: actor.user.id, amount, status: "open",
    data: json({ invoiceNo: await counter(tx, schoolId, "invoice"), type: input.type, dueDate: input.dueDate, issueDate: new Date().toISOString().slice(0, 10), lines: input.lines }),
  } });
  await tx.invoiceLine.createMany({ data: lines.map(l => ({ ...l, schoolId, studentId: input.studentId, invoiceId: invoice.id })) });
  await ledger(tx, actor, {
    studentId: input.studentId, termId: input.termId, type: "invoice", debit: amount,
    referenceId: invoice.id, referenceType: "invoice", description: metadata(invoice).invoiceNo,
  });
  if (input.type === "term") {
    const templates = await tx.financeRecord.findMany({ where: { schoolId, studentId: input.studentId, kind: "adjustment", status: "approved" } });
    for (const template of templates) {
      const data = metadata(template);
      if (!data.recurring || (template.termId && template.termId !== input.termId)) continue;
      if (input.termId && (data.startDate || data.endDate)) {
        const term = await owned(tx, "term", input.termId, schoolId);
        if ((data.startDate && data.startDate > term.endDate.toISOString().slice(0, 10)) || (data.endDate && data.endDate < term.startDate.toISOString().slice(0, 10))) continue;
      }
      const applied = await tx.financeRecord.create({ data: {
        schoolId, studentId: input.studentId, termId: input.termId, parentId: invoice.id,
        kind: "adjustment", uniqueKey: `recurring:${template.id}:${invoice.id}`,
        amount: template.amount, requestedBy: template.requestedBy, approvedBy: template.approvedBy,
        approvedAt: template.approvedAt, status: "posted", data: json({ ...data, recurring: false, templateId: template.id }),
      } });
      await ledger(tx, actor, { studentId: input.studentId, termId: input.termId, type: "adjustment", credit: applied.amount, referenceId: applied.id, referenceType: "adjustment", description: data.reason });
    }
  }
  await allocate(tx, actor, input.studentId);
  await outbox(tx, schoolId, "invoice.posted", invoice.id, { studentId: input.studentId });
  await audit(tx, actor, "created", "invoice", invoice.id, undefined, view(invoice));
  return record(tx, schoolId, invoice.id);
}
export async function reverse(tx: Tx, actor: Actor, request: FinanceRecord) {
  if (!request.parentId) throw new ApiError(400, "Original transaction is required");
  const original = await record(tx, actor.school.id, request.parentId);
  if (!["payment", "adjustment", "invoice"].includes(original.kind) || ["reversed", "cancelled"].includes(original.status)) throw new ApiError(409, "Transaction cannot be reversed");
  const entry = await tx.ledgerEntry.findFirst({ where: { schoolId: actor.school.id, referenceId: original.id, reversesId: null } });
  if (!entry) throw new ApiError(409, "Original has no posted ledger entry");
  if (await tx.ledgerEntry.findFirst({ where: { schoolId: actor.school.id, reversesId: entry.id } })) throw new ApiError(409, "Transaction already reversed");
  await ledger(tx, actor, {
    studentId: entry.studentId, termId: entry.termId, type: "reversal", debit: entry.credit, credit: entry.debit,
    referenceId: request.id, referenceType: request.kind, description: metadata(request).reason, reversesId: entry.id,
  });
  await tx.financeRecord.update({ where: { id: original.id }, data: { status: original.kind === "invoice" ? "cancelled" : "reversed" } });
  if (original.kind === "invoice") {
    const automatic = await tx.financeRecord.findMany({ where: {
      schoolId: actor.school.id, parentId: original.id, kind: "adjustment", status: "posted",
    } });
    for (const adjustment of automatic) {
      if (!metadata(adjustment).templateId) continue;
      const cancellation = await tx.financeRecord.create({ data: {
        schoolId: actor.school.id, kind: "reversal", studentId: entry.studentId,
        parentId: adjustment.id, amount: adjustment.amount, uniqueKey: `cascade:${request.id}:${adjustment.id}`,
        requestedBy: request.requestedBy, approvedBy: actor.user.id, approvedAt: new Date(), status: "approved",
        data: { reason: `Cancelled invoice ${metadata(original).invoiceNo}: ${metadata(request).reason}`, invoiceReversalId: request.id },
      } });
      await reverse(tx, actor, cancellation);
    }
  }
  await allocate(tx, actor, entry.studentId);
  await audit(tx, actor, "reversed", original.kind, original.id, view(original), { reversalId: request.id });
}