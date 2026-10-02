import { createHash } from "node:crypto";
import type { FinanceInput, InvoiceBatchInput } from "@workspace/api-zod";
import { Prisma, type FinanceRecord } from "@workspace/db";
import { ApiError, audit, owned, validDate, type Actor, type Tx } from "../core";
import { allocate, counter, json, ledger, metadata, outbox, postInvoice, record, reverse, view } from "./posting";
import { money, sum, zero } from "./money";

const required = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === "") throw new ApiError(400, `${field} is required`);
};
function positive(value: string | undefined) {
  required(value, "amount");
  const amount = money(value!);
  if (!amount.greaterThan(0)) throw new ApiError(400, "Amount must be positive");
  return amount;
}
function dateString(value: Date | string | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!validDate(date)) throw new ApiError(400, "Invalid date");
  return date;
}
export async function createRecord(tx: Tx, actor: Actor, input: FinanceInput) {
  const schoolId = actor.school.id;
  const roles = input.kind === "payment" || input.kind === "cheque_status" || ["adjustment", "refund", "refund_paid", "reversal"].includes(input.kind)
    ? ["bursar"] : ["bursar", "school_admin", "super_admin"];
  if (!roles.includes(actor.user.role)) throw new ApiError(403, "Role cannot create this finance record");
  const normalized = { ...input, startDate: dateString(input.startDate), endDate: dateString(input.endDate), dueDate: dateString(input.dueDate) };
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(json(normalized)))).digest("hex");
  const uniqueKey = `request:${input.idempotencyKey}`;
  const existing = await tx.financeRecord.findUnique({ where: { schoolId_kind_uniqueKey: { schoolId, kind: input.kind, uniqueKey } } });
  if (existing) {
    if (metadata(existing).fingerprint && metadata(existing).fingerprint !== fingerprint) throw new ApiError(409, "Idempotency key was used with different input");
    return existing;
  }
  if (input.studentId) await owned(tx, "student", input.studentId, schoolId);
  if (input.termId) await owned(tx, "term", input.termId, schoolId);
  if (input.gradeId) await owned(tx, "grade", input.gradeId, schoolId);
  if (input.academicYearId) await owned(tx, "academicYear", input.academicYearId, schoolId);
  if (input.sponsorId) await record(tx, schoolId, input.sponsorId, "sponsor");
  if (input.feeItemId) await record(tx, schoolId, input.feeItemId, "fee_item");
  let parent = input.parentId ? await record(tx, schoolId, input.parentId) : undefined;
  if (parent?.studentId && input.studentId && parent.studentId !== input.studentId) throw new ApiError(400, "Related record belongs to a different student");
  const data: Record<string, any> = { ...normalized, fingerprint };
  let status = "active", amount = input.amount ? positive(input.amount) : zero();
  let studentId = input.studentId;
  if (input.kind === "fee_item") {
    for (const field of ["name", "code", "priority", "isOptional"] as const) required(input[field], field);
    const duplicate = await tx.financeRecord.findFirst({ where: { schoolId, kind: "fee_item", data: { path: ["code"], equals: input.code } } });
    if (duplicate) throw new ApiError(409, "Fee item code already exists");
  } else if (input.kind === "sponsor") {
    required(input.name, "name"); required(input.sponsorType, "sponsorType");
  } else if (input.kind === "fee_structure") {
    for (const field of ["name", "academicYearId", "termId", "gradeId", "lines"] as const) required(input[field], field);
    const term = await owned(tx, "term", input.termId!, schoolId);
    if (term.academicYearId !== input.academicYearId) throw new ApiError(400, "Term is not in academic year");
    for (const line of input.lines!) {
      const item = await record(tx, schoolId, line.feeItemId, "fee_item");
      if (metadata(item).isOptional) throw new ApiError(400, "Optional fee items must be assigned per student");
      positive(line.amount);
    }
    if (new Set(input.lines!.map(l => l.feeItemId)).size !== input.lines!.length) throw new ApiError(400, "Duplicate fee item");
    if (parent && (parent.kind !== "fee_structure" || parent.status !== "approved")) throw new ApiError(400, "New versions require an approved parent structure");
    if (parent && ["termId", "gradeId", "academicYearId", "boardingStatus"].some(k => metadata(parent!)[k] !== data[k])) throw new ApiError(400, "Versions must retain the original scope");
    data.version = parent ? metadata(parent).version + 1 : 1;
    amount = sum(input.lines!.map(l => money(l.amount))); status = "pending";
  } else if (input.kind === "optional_charge") {
    required(studentId, "studentId"); required(input.feeItemId, "feeItemId"); required(input.startDate, "startDate");
    if (!metadata(await record(tx, schoolId, input.feeItemId!, "fee_item")).isOptional) throw new ApiError(400, "Fee item is not optional");
    amount = positive(input.amount);
    if (normalized.endDate && normalized.endDate < normalized.startDate!) throw new ApiError(400, "End date precedes start date");
  } else if (input.kind === "invoice") {
    required(studentId, "studentId"); required(input.lines, "lines"); required(normalized.dueDate, "dueDate");
    const invoice = await postInvoice(tx, actor, { studentId: studentId!, termId: input.termId, uniqueKey, dueDate: normalized.dueDate!, lines: input.lines!, type: "one_off" });
    return tx.financeRecord.update({ where: { id: invoice.id }, data: { data: json({ ...metadata(invoice), fingerprint }) } });
  } else if (input.kind === "payment") {
    required(studentId, "studentId"); required(input.channel, "channel"); required(input.providerTxnId, "providerTxnId");
    amount = positive(input.amount);
    const duplicate = await tx.financeRecord.findFirst({ where: { schoolId, kind: "payment", data: { path: ["providerTxnId"], equals: input.providerTxnId } } });
    if (duplicate) {
      if (duplicate.studentId !== studentId || !duplicate.amount.equals(amount) || metadata(duplicate).channel !== input.channel) throw new ApiError(409, "Provider reference already posted with different details");
      return duplicate;
    }
    if (input.channel === "cheque") {
      for (const key of ["chequeNo", "bank", "drawer"] as const) required(input[key], key);
      data.chequeStatus = "received";
    }
    data.receiptNo = await counter(tx, schoolId, "receipt"); data.provider = "manual"; data.source = "manual";
    data.transactionTime = input.transactionTime ?? new Date().toISOString(); status = "posted";
  } else if (input.kind === "adjustment") {
    required(studentId, "studentId"); required(input.adjustmentType, "adjustmentType"); required(input.reason, "reason");
    amount = positive(input.amount);
    if (["bursary", "sponsorship"].includes(input.adjustmentType!)) required(input.sponsorId, "sponsorId");
    if (input.adjustmentType === "correction") {
      if (!parent || !["payment", "adjustment", "invoice"].includes(parent.kind)) throw new ApiError(400, "Correction requires the original invoice, payment or adjustment as parentId");
      if (input.recurring) throw new ApiError(400, "Corrections cannot recur");
      if (!amount.equals(parent.amount)) throw new ApiError(400, "Correction reverses the full original amount; post a replacement separately");
    } else if (parent && parent.kind !== "invoice") throw new ApiError(400, "Adjustment parent must be an invoice");
    status = "pending";
  } else if (input.kind === "refund") {
    required(studentId, "studentId"); required(input.reason, "reason"); required(input.method, "method");
    amount = positive(input.amount);
    if (parent && parent.kind !== "payment") throw new ApiError(400, "Refund parent must be a payment");
    status = "pending";
  } else if (input.kind === "refund_paid") {
    required(parent, "parentId"); required(input.reference, "reference");
    if (parent!.kind !== "refund" || parent!.status !== "approved") throw new ApiError(409, "Only approved refunds can be marked paid");
    studentId = parent!.studentId!;
    amount = parent!.amount;
    await tx.financeRecord.update({ where: { id: parent!.id }, data: { status: "paid" } });
    status = "posted";
  } else if (input.kind === "reversal" || input.kind === "cheque_status") {
    required(parent, "parentId"); required(input.reason, "reason");
    studentId = parent!.studentId ?? undefined;
    if (!["payment", "adjustment", "invoice"].includes(parent!.kind)) throw new ApiError(400, "Only posted invoices, payments or adjustments can be reversed");
    if (input.kind === "cheque_status") {
      required(input.chequeStatus, "chequeStatus");
      if (parent!.kind !== "payment" || metadata(parent!).channel !== "cheque") throw new ApiError(400, "Not a cheque payment");
      const prior = metadata(parent!).chequeStatus;
      const allowed: Record<string, string[]> = { received: ["banked", "bounced"], banked: ["cleared", "bounced"], cleared: ["bounced"] };
      if (!(allowed[prior] ?? []).includes(input.chequeStatus!)) throw new ApiError(409, "Invalid cheque status transition");
      status = input.chequeStatus === "bounced" ? "pending" : "posted";
      if (status === "posted") await tx.financeRecord.update({ where: { id: parent!.id }, data: { data: json({ ...metadata(parent!), chequeStatus: input.chequeStatus }) } });
    } else status = "pending";
    amount = parent!.amount;
  }
  const result = await tx.financeRecord.create({ data: {
    schoolId, kind: input.kind, studentId, termId: input.termId, parentId: input.parentId,
    uniqueKey, requestedBy: actor.user.id, status, amount, data: json(data),
  } });
  if (input.kind === "payment") {
    await ledger(tx, actor, { studentId: studentId!, type: "payment", credit: amount, referenceId: result.id, referenceType: "payment", description: data.receiptNo });
    await allocate(tx, actor, studentId!);
    await outbox(tx, schoolId, "payment.posted", result.id, { studentId, receiptNo: data.receiptNo });
  }
  await audit(tx, actor, "created", input.kind, result.id, undefined, view(result));
  return result;
}

export async function decideRecord(tx: Tx, actor: Actor, id: string, decision: "approved" | "rejected", reason: string) {
  if (!["school_admin", "principal", "super_admin"].includes(actor.user.role)) throw new ApiError(403, "Only principal or school administrator may approve");
  const request = await record(tx, actor.school.id, id), data = metadata(request);
  if (request.requestedBy === actor.user.id) throw new ApiError(403, "Cannot approve or reject your own request");
  if (request.status !== "pending") {
    if (request.approvedBy === actor.user.id && data.decision === decision) return request;
    throw new ApiError(409, "Request has already been decided");
  }
  if (decision === "approved") {
    if (request.kind === "fee_structure") {
      const existing = await tx.financeRecord.findMany({ where: { schoolId: actor.school.id, kind: "fee_structure", termId: request.termId, status: "approved" } });
      for (const prior of existing) {
        if (metadata(prior).gradeId !== data.gradeId || metadata(prior).boardingStatus !== data.boardingStatus) continue;
        if (request.parentId !== prior.id) throw new ApiError(409, "An approved structure exists; create a new version");
        await tx.financeRecord.update({ where: { id: prior.id }, data: { status: "archived" } });
      }
    } else if (request.kind === "adjustment" && data.adjustmentType === "correction") {
      await reverse(tx, actor, request);
    } else if (request.kind === "adjustment" && !data.recurring) {
      await ledger(tx, actor, { studentId: request.studentId!, termId: request.termId, type: "adjustment", credit: request.amount, referenceId: id, referenceType: "adjustment", description: data.reason });
      await allocate(tx, actor, request.studentId!);
    } else if (request.kind === "refund") {
      const balance = await tx.studentBalance.findFirst({ where: { schoolId: actor.school.id, studentId: request.studentId! } });
      if (!balance || balance.balance.negated().lessThan(request.amount)) throw new ApiError(409, "Refund exceeds available student credit");
      await ledger(tx, actor, { studentId: request.studentId!, type: "refund", debit: request.amount, referenceId: id, referenceType: "refund", description: data.reason });
      await allocate(tx, actor, request.studentId!);
    } else if (request.kind === "reversal" || request.kind === "cheque_status") {
      await reverse(tx, actor, request);
      if (request.kind === "cheque_status") {
        const payment = await record(tx, actor.school.id, request.parentId!);
        await tx.financeRecord.update({ where: { id: payment.id }, data: { data: json({ ...metadata(payment), chequeStatus: "bounced" }) } });
      }
    }
  }
  const updated = await tx.financeRecord.update({ where: { id }, data: {
    status: decision, approvedBy: actor.user.id, approvedAt: new Date(), data: json({ ...data, decision, decisionReason: reason }),
  } });
  await audit(tx, actor, decision, request.kind, id, view(request), view(updated));
  return updated;
}

export async function invoiceBatch(tx: Tx, actor: Actor, input: InvoiceBatchInput, commit: boolean) {
  const schoolId = actor.school.id;
  const term = await owned(tx, "term", input.termId, schoolId);
  if (input.gradeId) await owned(tx, "grade", input.gradeId, schoolId);
  const dueDate = dateString(input.dueDate)!;
  const students = await tx.student.findMany({ where: { schoolId, status: "active", ...(input.gradeId ? { gradeId: input.gradeId } : {}) }, orderBy: { admissionNo: "asc" } });
  const structures = await tx.financeRecord.findMany({ where: { schoolId, kind: "fee_structure", termId: input.termId, status: "approved" } });
  const invoices = [];
  for (const student of students) {
    const existing = await tx.financeRecord.findUnique({ where: { schoolId_kind_uniqueKey: { schoolId, kind: "invoice", uniqueKey: `term:${student.id}:${input.termId}` } } });
    if (existing) {
      const lines = await tx.invoiceLine.findMany({ where: { schoolId, invoiceId: existing.id } });
      invoices.push({ studentId: student.id, amount: existing.amount.toFixed(2), existing: true, invoiceId: existing.id, lines: lines.map(l => ({ feeItemId: l.feeItemId, amount: l.amount.toFixed(2), description: l.description })) }); continue;
    }
    const matches = structures.filter(s => metadata(s).gradeId === student.gradeId && (!metadata(s).boardingStatus || metadata(s).boardingStatus === student.boardingStatus));
    // A specific boarding structure takes precedence over an all-students structure.
    const specific = matches.filter(s => metadata(s).boardingStatus === student.boardingStatus);
    const selected = specific.length ? specific : matches;
    if (selected.length !== 1) throw new ApiError(409, `Student ${student.admissionNo} needs exactly one applicable approved fee structure`);
    const lines = [...metadata(selected[0]).lines] as { feeItemId: string; amount: string; description?: string }[];
    const optional = await tx.financeRecord.findMany({ where: { schoolId, studentId: student.id, kind: "optional_charge", status: "active", OR: [{ termId: null }, { termId: input.termId }] } });
    for (const charge of optional) {
      const c = metadata(charge);
      if (c.startDate > term.endDate.toISOString().slice(0, 10) || (c.endDate && c.endDate < term.startDate.toISOString().slice(0, 10))) continue;
      lines.push({ feeItemId: c.feeItemId, amount: charge.amount.toFixed(2) });
    }
    const proposal = { studentId: student.id, amount: sum(lines.map(l => money(l.amount))).toFixed(2), lines, existing: false, invoiceId: undefined as string | undefined };
    if (commit) proposal.invoiceId = (await postInvoice(tx, actor, { studentId: student.id, termId: input.termId, uniqueKey: `term:${student.id}:${input.termId}`, dueDate, lines, type: "term" })).id;
    invoices.push(proposal);
  }
  return { invoices };
}