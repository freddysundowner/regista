import { db, Prisma } from "@workspace/db";
import type { IncomingInput, ResolutionInput } from "@workspace/api-zod";
import { ApiError, audit, lock, owned, type Actor, type Tx } from "../core";
import { allocate, counter, financeTransaction, json, ledger, outbox } from "../finance/posting";
import { minimum, money, sum, zero } from "../finance/money";
import { choose, editDistance, fullPhone, jaroWinkler, reference, type Candidate } from "./matching";
import { systemActor } from "../integrations/security";
import { queueMessage } from "../integrations/messages";
import { requestUnmatchedRefund, suspenseEntry } from "./settlements";
import { nudgePayments } from "./nudge";

/**
 * High-value or oddly timed payments cannot be independently verified yet (no approved Transaction Status
 * contract), so they are never auto-posted. They are still stored and go to the Unmatched list for the bursar:
 * refusing the callback would lose a payment the parent has already made.
 */
export async function needsVerification(actor: Actor, provider: string, amount: string, at: Date, transactionId: string) {
  const settings = actor.school.settings as Record<string, any>;
  const threshold = money(String(settings.highValuePaymentThreshold ?? "100000"));
  const hold = !threshold.gt(0) || money(amount).gte(threshold) || at.getTime() > Date.now() + 300000 || Date.now() - at.getTime() > 48 * 3600000;
  if (hold) await db.integrationEvent.create({ data: { schoolId: actor.school.id, provider, event: "transaction_verification_required", status: "held_for_review", detail: { transactionId, amount } } });
  return hold;
}
export async function ingest(actor: Actor, input: IncomingInput, source = "manual_import", rawPayload: unknown = input) {
  const amount = money(input.amount);
  if (!amount.greaterThan(0)) throw new ApiError(400, "Payment amount must be positive");
  if (input.knownStudentId) await owned(db, "student", input.knownStudentId, actor.school.id);
  const key = { schoolId: actor.school.id, provider: input.provider, providerTxnId: input.providerTxnId };
  const existing = await db.incomingPayment.findUnique({ where: { schoolId_provider_providerTxnId: key } });
  if (existing) {
    if (!existing.amount.equals(amount) || (["kcb", "ncba"].includes(input.provider) && existing.accountReference !== (input.accountReference ?? null))) throw new ApiError(409, "Provider transaction identity has conflicting amount or reference");
    return existing;
  }
  const phone = fullPhone(input.payerPhone);
  const duplicate = phone ? await db.incomingPayment.findFirst({ where: { schoolId: actor.school.id, payerPhone: phone, amount, transactionTime: { gte: new Date(new Date(input.transactionTime).getTime() - 600000), lte: new Date(new Date(input.transactionTime).getTime() + 600000) } } }) : null;
  try {
    return await db.$transaction(async tx => {
      const created = await tx.incomingPayment.create({ data: {
        ...key, channel: input.channel, amount, transactionTime: input.transactionTime, payerPhone: phone ?? input.payerPhone,
        payerName: input.payerName, accountReference: input.accountReference, normalizedReference: reference(input.accountReference ?? ""),
        bankAccountFrom: input.bankAccountFrom, source, rawPayload: json(rawPayload), knownStudentId: input.knownStudentId,
        requestedBy: actor.user.id, duplicateOfId: duplicate?.id,
      } });
      await audit(tx, actor, "received", "incoming_payment", created.id, undefined, { provider: input.provider, providerTxnId: input.providerTxnId, amount: amount.toFixed(2), source, duplicateOfId: duplicate?.id });
      await suspenseEntry(tx, actor, created.id, "received", "0.00");
      return created;
    }).then(created => {
      // Ask the worker to match it now so receipts go out in seconds; the minute sweep remains the safety net.
      nudgePayments();
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const prior = await db.incomingPayment.findUniqueOrThrow({ where: { schoolId_provider_providerTxnId: key } });
      if (!prior.amount.equals(amount) || (["kcb", "ncba"].includes(input.provider) && prior.accountReference !== (input.accountReference ?? null))) throw new ApiError(409, "Conflicting duplicate payment");
      return prior;
    }
    throw error;
  }
}
export async function postedStkStatus<T extends { id: string; schoolId: string; studentId: string; checkoutRequestId: string | null; amount: Prisma.Decimal; status: string }>(tx: Tx, request: T): Promise<T> {
  const link = await tx.financeRecord.findUnique({ where: { schoolId_kind_uniqueKey: { schoolId: request.schoolId, kind: "stk_confirmation", uniqueKey: request.id } } });
  const payment = link ? await tx.incomingPayment.findFirst({ where: { schoolId: request.schoolId, id: (link.data as any).incomingPaymentId } })
    : request.checkoutRequestId ? await tx.incomingPayment.findFirst({ where: { schoolId: request.schoolId, rawPayload: { path: ["Body", "stkCallback", "CheckoutRequestID"], equals: request.checkoutRequestId } } }) : null;
  const allocation = payment && await tx.paymentStudentAllocation.findFirst({ where: { schoolId: request.schoolId, paymentId: payment.id, studentId: request.studentId, amount: request.amount } });
  const posted = allocation && await tx.ledgerEntry.findFirst({ where: { schoolId: request.schoolId, referenceId: allocation.postingId, type: "payment", credit: request.amount } });
  return { ...request, status: posted ? "paid" : request.status === "paid" ? "processing" : request.status };
}
export async function candidates(tx: Tx, actor: Actor, payment: { accountReference: string | null; payerPhone: string | null; payerName: string | null; bankAccountFrom: string | null; amount: Prisma.Decimal }) {
  const schoolId = actor.school.id, settings = actor.school.settings as Record<string, any>;
  const scores = { exact: 100, normalized: 95, alias: 90, guardian: 85, name: 70, typo: 65, bonus: 10, inactive: 30, ...(settings.matchingScores ?? {}) };
  const students = await tx.student.findMany({ where: { schoolId }, include: { guardians: { include: { guardian: true } } } });
  const balances = await tx.studentBalance.findMany({ where: { schoolId } });
  const aliases = await tx.payerAlias.findMany({ where: { schoolId } });
  const normalized = reference(payment.accountReference ?? ""), phone = fullPhone(payment.payerPhone);
  const phoneChildren = students.filter(s => s.status === "active" && phone && s.guardians.some(g => g.guardian.phone === phone || g.guardian.altPhone === phone));
  const results: Candidate[] = [];
  for (const student of students) {
    const reasons: string[] = []; let score = 0;
    if (payment.accountReference && payment.accountReference.toUpperCase().trim() === student.admissionNo.toUpperCase()) { score = scores.exact; reasons.push("exact_reference"); }
    else if (normalized && normalized === reference(student.admissionNo)) { score = scores.normalized; reasons.push("normalized_reference"); }
    else if (aliases.some(a => a.studentId === student.id && ((a.type === "reference" && a.value === normalized && normalized) || (a.type === "phone" && a.value === phone && phone) || (a.type === "bank_account" && a.value === payment.bankAccountFrom && payment.bankAccountFrom)))) { score = scores.alias; reasons.push("learned_alias"); }
    else if (phoneChildren.length === 1 && phoneChildren[0].id === student.id) { score = scores.guardian; reasons.push("guardian_phone"); }
    else if (phoneChildren.some(s => s.id === student.id)) { score = scores.guardian; reasons.push("multiple_siblings"); }
    else if (payment.payerName && payment.payerName.toUpperCase().includes(student.lastName.toUpperCase()) && student.guardians.some(g => jaroWinkler(g.guardian.name.toUpperCase().replace(/[^A-Z ]/g, ""), payment.payerName!.toUpperCase().replace(/[^A-Z ]/g, "")) >= (settings.fuzzyNameThreshold ?? 0.9))) { score = scores.name; reasons.push("fuzzy_guardian_name"); }
    else if (normalized && editDistance(normalized, reference(student.admissionNo)) === 1) { score = scores.typo; reasons.push("reference_typo"); }
    if (!score) continue;
    const balance = balances.find(b => b.studentId === student.id);
    const next = await tx.planInstallment.findFirst({ where: { schoolId, status: { in: ["upcoming", "due", "overdue", "partially_paid"] }, planId: { in: (await tx.paymentPlan.findMany({ where: { schoolId, studentId: student.id, status: "active" }, select: { id: true } })).map(p => p.id) } }, orderBy: { dueDate: "asc" } });
    if (balance?.balance.equals(payment.amount) || next?.amount.minus(next.amountPaid).equals(payment.amount)) { score += scores.bonus; reasons.push("amount_matches_due"); }
    if (student.status !== "active") { score -= scores.inactive; reasons.push("inactive_student"); }
    results.push({ studentId: student.id, score, reasons });
  }
  // Strong references win before phone-family rules; inactive students never auto-post.
  const strong = results.filter(c => c.reasons.some(r => ["exact_reference", "normalized_reference"].includes(r)));
  const pool = strong.length ? strong : results;
  const result = choose(pool, settings.autoPostThreshold ?? 85);
  if (result.winner && pool.find(c => c.studentId === result.winner)?.reasons.includes("inactive_student")) result.winner = null;
  const siblingFlow = !strong.length && phoneChildren.length > 1;
  if (siblingFlow) result.winner = null;
  return { ...result, siblingFlow, familyId: phoneChildren[0]?.familyId, children: phoneChildren.map(s => s.id) };
}
export async function postIncoming(tx: Tx, actor: Actor, paymentId: string, splits: { studentId: string; amount: string }[], reason: string) {
  const schoolId = actor.school.id;
  const payment = await tx.incomingPayment.findFirst({ where: { id: paymentId, schoolId } });
  if (!payment) throw new ApiError(404, "Payment not found");
  if (!["received", "unmatched", "suspended", "matched", "refund_rejected"].includes(payment.status)) throw new ApiError(409, "Payment is reserved for another settlement");
  const previous = await tx.paymentStudentAllocation.findMany({ where: { schoolId, paymentId } });
  if (previous.length) {
    if (previous.length === splits.length && previous.every(p => splits.some(s => s.studentId === p.studentId && p.amount.equals(s.amount)))) return previous;
    throw new ApiError(409, "Payment already allocated");
  }
  if (payment.status === "matched") throw new ApiError(409, "Payment has already been settled through another workflow");
  if (!splits.length || new Set(splits.map(s => s.studentId)).size !== splits.length || splits.some(s => !money(s.amount).greaterThan(0))) throw new ApiError(400, "Provide unique students and positive allocation amounts");
  if (!sum(splits.map(s => money(s.amount))).equals(payment.amount)) throw new ApiError(400, "Allocations must equal the payment amount");
  const result = [];
  for (const split of splits) {
    await owned(tx, "student", split.studentId, schoolId);
    const receiptNo = await counter(tx, schoolId, "receipt");
    const posting = await tx.financeRecord.create({ data: {
      schoolId, kind: "payment", studentId: split.studentId, amount: money(split.amount), status: "posted",
      requestedBy: actor.user.id, uniqueKey: `incoming:${payment.id}:${split.studentId}`,
      data: { receiptNo, channel: payment.channel, provider: payment.provider, providerTxnId: `${payment.providerTxnId}:${split.studentId}`, originalProviderTxnId: payment.providerTxnId, incomingPaymentId: payment.id, reason },
    } });
    await ledger(tx, actor, { studentId: split.studentId, type: "payment", credit: money(split.amount), referenceId: posting.id, referenceType: "payment", description: receiptNo });
    await allocate(tx, actor, split.studentId);
    result.push(await tx.paymentStudentAllocation.create({ data: { schoolId, paymentId, studentId: split.studentId, postingId: posting.id, amount: money(split.amount), allocatedBy: actor.user.id } }));
    await outbox(tx, schoolId, "payment.posted", posting.id, { studentId: split.studentId, receiptNo });
  }
  await tx.incomingPayment.update({ where: { id: payment.id }, data: { status: "matched" } });
  await suspenseEntry(tx, actor, payment.id, "student_allocated", payment.amount.toFixed(2));
  if (payment.channel === "mpesa_stk") {
    const checkout = (payment.rawPayload as any)?.Body?.stkCallback?.CheckoutRequestID;
    if (typeof checkout === "string") await tx.stkRequest.updateMany({ where: { schoolId, checkoutRequestId: checkout, studentId: payment.knownStudentId ?? undefined }, data: { status: "paid", resultCode: "0" } });
  }
  const confirmations = await tx.financeRecord.findMany({ where: { schoolId, kind: "stk_confirmation", data: { path: ["incomingPaymentId"], equals: payment.id } } });
  for (const confirmation of confirmations) {
    const requestId = (confirmation.data as any).requestId;
    const split = splits.find(s => s.studentId === confirmation.studentId);
    if (typeof requestId === "string") await tx.stkRequest.updateMany({ where: { schoolId, id: requestId }, data: { status: split && money(split.amount).equals(payment.amount) ? "paid" : "reconciliation_required", resultCode: "0" } });
  }
  await audit(tx, actor, "allocated", "incoming_payment", paymentId, undefined, { allocations: splits, reason });
  return result;
}
export async function processPayment(schoolId: string, id: string) {
  const actor = await systemActor(schoolId);
  return financeTransaction(actor, async tx => {
    // One processor per payment: a concurrent run waits here, then sees it is no longer "received".
    await lock(tx, `incoming-payment:${id}`);
    const payment = await tx.incomingPayment.findFirst({ where: { id, schoolId } });
    if (!payment || payment.status !== "received") return;
    // The same money reported by two providers (say M-Pesa and the bank it settles into) must not credit a learner twice.
    // Two payments through one provider are separate transactions the parent really made, so those still post.
    const twin = payment.duplicateOfId ? await tx.incomingPayment.findFirst({ where: { id: payment.duplicateOfId, schoolId }, select: { provider: true } }) : null;
    const possibleDuplicate = !!twin && twin.provider !== payment.provider;
    if (payment.source === "callback_hold" || possibleDuplicate) {
      // Stored but not provider-verified: the bursar confirms it from the Unmatched list before it posts.
      const match = payment.knownStudentId ? { candidates: [{ studentId: payment.knownStudentId, score: 100, reasons: ["known_student"] }], familyId: null } : await candidates(tx, actor, payment);
      await tx.matchException.create({ data: { schoolId, paymentId: id, reason: possibleDuplicate ? "possible_duplicate" : "verification_required", candidates: json(match.candidates), familyId: match.familyId ?? null, expiresAt: null } });
      await tx.incomingPayment.update({ where: { id }, data: { status: "unmatched" } });
      await audit(tx, actor, possibleDuplicate ? "held_as_possible_duplicate" : "held_for_verification", "incoming_payment", id, undefined, { candidates: match.candidates, ...(possibleDuplicate ? { duplicateOfId: payment.duplicateOfId } : {}) });
      return;
    }
    if (payment.knownStudentId) { await postIncoming(tx, actor, id, [{ studentId: payment.knownStudentId, amount: payment.amount.toFixed(2) }], "known_student"); return; }
    const match = await candidates(tx, actor, payment);
    if (payment.provider === "kcb") {
      // Unknown references must never be allocated on name/phone guesses.
      const exact = match.candidates.filter(c => !c.reasons.includes("inactive_student") && c.reasons.some(r => ["exact_reference", "normalized_reference"].includes(r)));
      match.winner = exact.length === 1 ? exact[0].studentId : null;
      match.siblingFlow = false;
    }
    if (match.winner) { await postIncoming(tx, actor, id, [{ studentId: match.winner, amount: payment.amount.toFixed(2) }], "automatic_match"); return; }
    const settings = actor.school.settings as Record<string, any>;
    if (match.siblingFlow && ["proportional_to_balance", "oldest_arrears_first"].includes(settings.siblingSplitRule)) {
      const splits = await siblingSplits(tx, schoolId, match.children, payment.amount, settings.siblingSplitRule);
      await postIncoming(tx, actor, payment.id, splits, "configured_sibling_split");
      return;
    }
    await tx.matchException.create({ data: {
      schoolId, paymentId: id, reason: match.siblingFlow ? "multiple_siblings" : match.candidates.length ? "low_confidence" : payment.accountReference ? "invalid_reference" : "no_reference",
      candidates: json(match.candidates), familyId: match.familyId,
      expiresAt: match.siblingFlow ? new Date(Date.now() + (settings.siblingReplyHours ?? 24) * 3600000) : null,
    } });
    await tx.incomingPayment.update({ where: { id }, data: { status: "unmatched" } });
    if (match.siblingFlow && fullPhone(payment.payerPhone)) {
      const guardian = await tx.guardian.findUnique({ where: { schoolId_phone: { schoolId, phone: fullPhone(payment.payerPhone)! } } });
      if (guardian) await queueMessage(tx, schoolId, { guardianId: guardian.id, phone: guardian.phone, channel: "whatsapp", template: "unmatched_payment", content: `Payment KES ${payment.amount.toFixed(2)} requires allocation between your children. Please select a child or split by balances.`, idempotencyKey: `unmatched:${payment.id}` });
    }
    await audit(tx, actor, "queued", "incoming_payment", id, undefined, { candidates: match.candidates });
  });
}
export async function resolveException(actor: Actor, id: string, input: ResolutionInput) {
  return financeTransaction(actor, async tx => {
    const exception = await tx.matchException.findFirst({ where: { id, schoolId: actor.school.id } });
    if (!exception) throw new ApiError(404, "Exception not found");
    if (exception.status !== "open") throw new ApiError(409, "Exception already resolved");
    const payment = await tx.incomingPayment.findFirstOrThrow({ where: { id: exception.paymentId, schoolId: actor.school.id } });
    if (input.action === "refund") return requestUnmatchedRefund(tx, actor, id, input.reason);
    if (input.action === "suspense") {
      await tx.incomingPayment.update({ where: { id: payment.id }, data: { status: "suspended" } });
      await tx.matchException.update({ where: { id }, data: { expiresAt: null } });
    } else {
      await postIncoming(tx, actor, payment.id, input.allocations ?? [], input.reason);
      if (input.learnAlias) for (const split of input.allocations ?? []) {
        for (const [type, value] of [["phone", fullPhone(payment.payerPhone)], ["reference", reference(payment.accountReference ?? "")], ["bank_account", payment.bankAccountFrom]]) {
          if (!value) continue;
          await tx.payerAlias.upsert({ where: { schoolId_type_value_studentId: { schoolId: actor.school.id, type: type!, value, studentId: split.studentId } }, create: { schoolId: actor.school.id, type: type!, value, studentId: split.studentId, source: "bursar_assigned", createdBy: actor.user.id }, update: {} });
        }
      }
    }
    await tx.matchException.update({ where: { id }, data: { status: input.action === "suspense" ? "open" : "resolved", resolution: input.action, resolvedBy: actor.user.id, resolvedAt: new Date() } });
    await audit(tx, actor, "resolved", "match_exception", id, undefined, input);
    return { id, status: input.action };
  });
}
export async function siblingSplits(tx: Tx, schoolId: string, studentIds: string[], amount: Prisma.Decimal, rule: string) {
  if (!["proportional_to_balance", "oldest_arrears_first"].includes(rule)) throw new ApiError(400, "Unknown sibling allocation rule");
  const balances = await tx.studentBalance.findMany({ where: { schoolId, studentId: { in: studentIds }, balance: { gt: 0 } }, orderBy: { studentId: "asc" } });
  if (!balances.length) throw new ApiError(409, "No positive balances; bursar must allocate the family payment");
  if (rule === "oldest_arrears_first") {
    const invoices = await tx.financeRecord.findMany({ where: { schoolId, kind: "invoice", studentId: { in: studentIds }, status: { not: "cancelled" } } });
    const allocations = await tx.feeAllocation.findMany({ where: { schoolId, studentId: { in: studentIds } } });
    const oldest = new Map<string, number>();
    for (const invoice of invoices) {
      const paid = sum(allocations.filter(a => a.invoiceId === invoice.id).map(a => a.amount));
      if (!invoice.studentId || !invoice.amount.gt(paid)) continue;
      const dueDate = (invoice.data as Record<string, any>).dueDate;
      const date = dueDate ? new Date(dueDate).getTime() : invoice.createdAt.getTime();
      oldest.set(invoice.studentId, Math.min(oldest.get(invoice.studentId) ?? Infinity, date));
    }
    balances.sort((a, b) => (oldest.get(a.studentId) ?? Infinity) - (oldest.get(b.studentId) ?? Infinity) || a.studentId.localeCompare(b.studentId));
  }
  const total = sum(balances.map(b => b.balance));
  let remainder = amount;
  const splits = balances.map((balance, i) => {
    const take = i === balances.length - 1 ? remainder : rule === "oldest_arrears_first" ? minimum(remainder, balance.balance) : amount.times(balance.balance).div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    remainder = remainder.minus(take);
    return { studentId: balance.studentId, amount: take.toFixed(2) };
  });
  return splits.filter(s => money(s.amount).greaterThan(0));
}