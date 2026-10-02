import { db } from "@workspace/db";
import { ApiError, audit, type Actor, type Tx } from "../core";
import { financeTransaction, metadata, record } from "../finance/posting";
import { money, sum } from "../finance/money";
import { savePdf } from "../academics/documents";

export async function suspenseEntry(tx: Tx, actor: Actor, paymentId: string, event: string, debit: string) {
  const payment = await tx.incomingPayment.findFirst({ where: { id: paymentId, schoolId: actor.school.id } });
  if (!payment) throw new ApiError(404, "Payment not found");
  await tx.suspenseEntry.upsert({ where: { paymentId_event: { paymentId, event: "received" } }, create: { schoolId: actor.school.id, paymentId, event: "received", credit: payment.amount, createdBy: actor.user.id }, update: {} });
  if (event === "received") return;
  const existing = await tx.suspenseEntry.findUnique({ where: { paymentId_event: { paymentId, event } } });
  if (existing) {
    if (!existing.debit.equals(debit)) throw new ApiError(409, "Settlement amount changed");
    return;
  }
  const entries = await tx.suspenseEntry.findMany({ where: { schoolId: actor.school.id, paymentId } });
  if (!money(debit).gt(0) || sum(entries.map(e => e.credit.minus(e.debit))).lt(debit)) throw new ApiError(409, "Settlement exceeds held funds");
  await tx.suspenseEntry.create({ data: { schoolId: actor.school.id, paymentId, event, debit: money(debit), createdBy: actor.user.id } });
}
export async function requestUnmatchedRefund(tx: Tx, actor: Actor, exceptionId: string, reason: string) {
  if (actor.user.role !== "bursar" || !reason.trim()) throw new ApiError(403, "Bursar and refund reason required");
  const exception = await tx.matchException.findFirst({ where: { id: exceptionId, schoolId: actor.school.id, status: "open" } });
  if (!exception) throw new ApiError(409, "Open exception required");
  const payment = await tx.incomingPayment.findFirstOrThrow({ where: { id: exception.paymentId, schoolId: actor.school.id } });
  if (!["unmatched", "suspended", "refund_rejected"].includes(payment.status)) throw new ApiError(409, "Payment cannot be refunded");
  if (await tx.paymentStudentAllocation.count({ where: { paymentId: payment.id } })) throw new ApiError(409, "Allocated funds require the student finance refund workflow");
  const prior = await tx.collectionRefund.findUnique({ where: { paymentId: payment.id } });
  if (prior && prior.status !== "rejected") return prior;
  const refund = await tx.collectionRefund.upsert({ where: { paymentId: payment.id }, create: { schoolId: actor.school.id, paymentId: payment.id, exceptionId, amount: payment.amount, reason, requestedBy: actor.user.id }, update: { status: "pending", reason, requestedBy: actor.user.id, decidedBy: null, decidedAt: null, decisionReason: null } });
  await suspenseEntry(tx, actor, payment.id, "received", "0.00");
  await tx.incomingPayment.update({ where: { id: payment.id }, data: { status: "refund_pending" } });
  await tx.matchException.update({ where: { id: exceptionId }, data: { status: "refund_pending", expiresAt: null } });
  await audit(tx, actor, "requested", "collection_refund", refund.id, undefined, { reason, amount: refund.amount.toFixed(2) });
  return refund;
}
export async function decideUnmatchedRefund(actor: Actor, id: string, decision: "approved" | "rejected", reason: string) {
  return financeTransaction(actor, async tx => {
    if (!["principal", "school_admin", "super_admin"].includes(actor.user.role)) throw new ApiError(403, "Independent approver required");
    const refund = await tx.collectionRefund.findFirst({ where: { id, schoolId: actor.school.id } });
    if (!refund) throw new ApiError(404, "Refund not found");
    if (!reason.trim() || refund.requestedBy === actor.user.id) throw new ApiError(403, "Independent decision and reason required");
    if (refund.status !== "pending") throw new ApiError(409, "Refund already decided");
    await tx.incomingPayment.update({ where: { id: refund.paymentId }, data: { status: decision === "approved" ? "refund_approved" : "refund_rejected" } });
    await tx.matchException.update({ where: { id: refund.exceptionId }, data: { status: decision === "approved" ? "refund_approved" : "open", resolution: decision === "approved" ? "refund" : null } });
    const updated = await tx.collectionRefund.update({ where: { id }, data: { status: decision, decidedBy: actor.user.id, decidedAt: new Date(), decisionReason: reason } });
    await audit(tx, actor, decision, "collection_refund", id, undefined, { reason });
    return updated;
  });
}
export async function payUnmatchedRefund(actor: Actor, id: string, reference: string) {
  return financeTransaction(actor, async tx => {
    if (actor.user.role !== "bursar" || !reference.trim()) throw new ApiError(403, "Bursar and disbursement evidence reference required");
    const refund = await tx.collectionRefund.findFirst({ where: { id, schoolId: actor.school.id } });
    if (!refund) throw new ApiError(404, "Refund not found");
    if (refund.status === "paid" && refund.paidReference === reference) return refund;
    if (refund.status !== "approved") throw new ApiError(409, "Approved unpaid refund required");
    await suspenseEntry(tx, actor, refund.paymentId, "refund_paid", refund.amount.toFixed(2));
    await tx.incomingPayment.update({ where: { id: refund.paymentId }, data: { status: "refunded" } });
    await tx.matchException.update({ where: { id: refund.exceptionId }, data: { status: "resolved", resolution: "refund", resolvedBy: actor.user.id, resolvedAt: new Date() } });
    const updated = await tx.collectionRefund.update({ where: { id }, data: { status: "paid", paidReference: reference, paidAt: new Date() } });
    await audit(tx, actor, "paid", "collection_refund", id, undefined, { reference, amount: refund.amount.toFixed(2) });
    return updated;
  });
}
export async function refreshSponsorBatch(tx: Tx, actor: Actor, financeRecordId: string) {
  const link = await tx.sponsorAllocation.findUnique({ where: { financeRecordId } });
  if (!link || link.schoolId !== actor.school.id) return;
  const batch = await tx.sponsorBatch.findFirstOrThrow({ where: { id: link.batchId, schoolId: actor.school.id } });
  const allocations = await tx.sponsorAllocation.findMany({ where: { batchId: batch.id, schoolId: actor.school.id } });
  const records = await tx.financeRecord.findMany({ where: { schoolId: actor.school.id, id: { in: allocations.map(a => a.financeRecordId) } } });
  for (const allocation of allocations) {
    const source = records.find(r => r.id === allocation.financeRecordId)!;
    if (["approved", "posted"].includes(source.status)) await suspenseEntry(tx, actor, batch.paymentId, `sponsor:${source.id}`, allocation.amount.toFixed(2));
  }
  const approved = sum(allocations.filter(a => records.some(r => r.id === a.financeRecordId && ["approved", "posted"].includes(r.status))).map(a => a.amount));
  const rejected = records.some(r => r.status === "rejected"), pending = records.some(r => r.status === "pending");
  const payment = await tx.incomingPayment.findUniqueOrThrow({ where: { id: batch.paymentId } });
  const heldAmount = payment.amount.minus(approved);
  const status = pending ? "pending" : rejected ? "partially_rejected" : "approved";
  await tx.sponsorBatch.update({ where: { id: batch.id }, data: { status, heldAmount } });
  await tx.incomingPayment.update({ where: { id: batch.paymentId }, data: { status: pending ? "sponsor_pending" : heldAmount.gt(0) ? "sponsor_remainder_held" : "matched" } });
  await tx.matchException.updateMany({ where: { schoolId: actor.school.id, paymentId: batch.paymentId }, data: { status: pending ? "sponsor_pending" : heldAmount.gt(0) ? "sponsor_remainder_held" : "resolved", resolution: "sponsor_batch", expiresAt: null } });
}
export async function sponsorAcknowledgement(actor: Actor, id: string) {
  const batch = await db.sponsorBatch.findFirst({ where: { id, schoolId: actor.school.id } });
  if (!batch) throw new ApiError(404, "Sponsor batch not found");
  if (batch.status !== "approved") throw new ApiError(409, "All allocated credits must be independently approved first");
  const sponsor = await record(db, actor.school.id, batch.sponsorId, "sponsor");
  const allocations = await db.sponsorAllocation.findMany({ where: { batchId: id, schoolId: actor.school.id } });
  const students = await db.student.findMany({ where: { schoolId: actor.school.id, id: { in: allocations.map(a => a.studentId) } } });
  return savePdf(actor, "sponsor_acknowledgement", id, [
    { text: actor.school.name, fontSize: 20 }, { text: `Sponsor acknowledgement: ${metadata(sponsor).name}`, fontSize: 16 },
    { text: `Approved learner credits KES ${batch.allocatedAmount.toFixed(2)}; unallocated funds held KES ${batch.heldAmount.toFixed(2)}` },
    { table: { body: [["Admission", "Learner", "Credit (KES)"], ...allocations.map(a => { const s = students.find(s => s.id === a.studentId)!; return [s.admissionNo, `${s.firstName} ${s.lastName}`, a.amount.toFixed(2)]; })] } },
  ]);
}