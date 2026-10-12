import { db, Prisma } from "@workspace/db";
import { latestPromises } from "./books";
import { ApiError, audit, type Actor } from "../core";
import { zero } from "./money";
import { messageReadiness, queueMessage } from "../integrations/messages";

const kes = (d: Prisma.Decimal) => `KES ${Number(d.toFixed(2)).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nairobiDay = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(d);

/** Each active learner's balance, unpaid amounts by age (in terms), last payment and reminder, and who to remind. */
export async function arrears(schoolId: string) {
  const [students, terms, ledgerTotals, payments, invoices, allocationTotals, plans, sponsorships, reminders, promises] = await Promise.all([
    db.student.findMany({ where: { schoolId, status: "active" }, include: { grade: true, stream: true, guardians: { include: { guardian: true } } }, orderBy: { admissionNo: "asc" } }),
    db.term.findMany({ where: { schoolId }, orderBy: { startDate: "desc" } }),
    db.ledgerEntry.groupBy({ by: ["studentId"], where: { schoolId }, _sum: { debit: true, credit: true } }),
    db.ledgerEntry.findMany({ where: { schoolId, type: { in: ["payment", "reversal"] } }, orderBy: { createdAt: "desc" }, select: { id: true, type: true, reversesId: true, studentId: true, createdAt: true, credit: true } }),
    db.financeRecord.findMany({ where: { schoolId, kind: "invoice", status: { not: "cancelled" } }, select: { id: true, studentId: true, termId: true, amount: true, uniqueKey: true } }),
    db.feeAllocation.groupBy({ by: ["invoiceId"], where: { schoolId }, _sum: { amount: true } }),
    db.paymentPlan.findMany({ where: { schoolId, status: "active" }, select: { studentId: true } }),
    db.financeRecord.findMany({ where: { schoolId, kind: "adjustment", status: "approved" }, select: { studentId: true, data: true } }),
    db.messageDelivery.findMany({ where: { schoolId, template: "fee_reminder" }, orderBy: { createdAt: "desc" }, select: { guardianId: true, createdAt: true } }),
    latestPromises(schoolId),
  ]);
  const current = terms.find(t => t.isCurrent) ?? null;
  const anchor = current ? terms.indexOf(current) : 0;
  const balance = new Map(ledgerTotals.map(t => [t.studentId, (t._sum.debit ?? zero()).minus(t._sum.credit ?? zero())]));
  const lastPaid = new Map<string, { at: Date; amount: Prisma.Decimal }>();
  // The last payment that still stands; one later reversed doesn't count.
  const undone = new Set(payments.filter(p => p.type === "reversal" && p.reversesId).map(p => p.reversesId!));
  for (const p of payments) if (p.type === "payment" && !undone.has(p.id) && !lastPaid.has(p.studentId)) lastPaid.set(p.studentId, { at: p.createdAt, amount: p.credit });
  const paidOn = new Map(allocationTotals.map(a => [a.invoiceId, a._sum.amount ?? zero()]));
  const onPlan = new Set(plans.map(p => p.studentId));
  const sponsored = new Set(sponsorships.filter(s => ["bursary", "sponsorship"].includes(String((s.data as Record<string, unknown>).adjustmentType))).map(s => s.studentId));
  const lastReminder = new Map<string, Date>();
  for (const r of reminders) if (r.guardianId && !lastReminder.has(r.guardianId)) lastReminder.set(r.guardianId, r.createdAt);
  const billed = new Set(current ? invoices.filter(i => i.termId === current.id && i.uniqueKey.startsWith("term:")).map(i => i.studentId) : []);

  const rows = students.map(s => {
    // Same ageing as the aged-arrears report: 0 = this term (or no term), 1, 2, 3+ terms behind.
    const buckets = [zero(), zero(), zero(), zero()];
    for (const inv of invoices) {
      if (inv.studentId !== s.id) continue;
      const open = inv.amount.minus(paidOn.get(inv.id) ?? zero());
      if (!open.gt(0)) continue;
      const index = inv.termId ? terms.findIndex(t => t.id === inv.termId) : anchor;
      buckets[Math.max(0, Math.min(3, index - anchor))] = buckets[Math.max(0, Math.min(3, index - anchor))].plus(open);
    }
    const primary = s.guardians.find(g => g.isPrimary && g.receivesNotifications && !g.guardian.anonymizedAt) ?? s.guardians.find(g => g.receivesNotifications && !g.guardian.anonymizedAt);
    const paid = lastPaid.get(s.id);
    return {
      studentId: s.id, admissionNo: s.admissionNo, studentName: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "),
      gradeName: s.grade?.name ?? null, streamName: s.stream?.name ?? null,
      balance: (balance.get(s.id) ?? zero()).toFixed(2),
      current: buckets[0].toFixed(2), oneTerm: buckets[1].toFixed(2), twoTerms: buckets[2].toFixed(2), threePlusTerms: buckets[3].toFixed(2),
      lastPaidAt: paid?.at.toISOString() ?? null, lastPaidAmount: paid?.amount.toFixed(2) ?? null,
      onPlan: onPlan.has(s.id), sponsored: sponsored.has(s.id), billedThisTerm: billed.has(s.id),
      guardianName: primary?.guardian.name ?? null, guardianPhone: primary?.guardian.phone ?? null,
      lastReminderAt: primary ? lastReminder.get(primary.guardianId)?.toISOString() ?? null : null,
      promise: promises.get(s.id) ?? null,
    };
  });
  return { termName: current?.name ?? null, rows, notBilled: current ? students.filter(s => !billed.has(s.id)).length : 0 };
}

/**
 * Queues one WhatsApp (or SMS) fee reminder per chosen learner to their primary parent, with the exact balance.
 * The key includes the day and balance, so repeating the request the same day never sends a duplicate.
 */
export async function sendFeeReminders(actor: Actor, studentIds: string[], channel: "whatsapp" | "sms" = "whatsapp") {
  const schoolId = actor.school.id;
  const ids = [...new Set(studentIds)];
  const view = await arrears(schoolId);
  const byId = new Map(view.rows.map(r => [r.studentId, r]));
  const students = await db.student.findMany({ where: { schoolId, id: { in: ids } }, include: { guardians: { include: { guardian: true } } } });
  // The due date quoted is the earliest one still unpaid.
  const invoices = await db.financeRecord.findMany({ where: { schoolId, kind: "invoice", studentId: { in: ids }, status: { in: ["open", "partially_paid"] } }, select: { studentId: true, data: true } });
  const skipped: { studentId: string; reason: string }[] = [];
  let queued = 0;
  const day = nairobiDay();
  for (const id of ids) {
    const row = byId.get(id), student = students.find(s => s.id === id);
    if (!row || !student) { skipped.push({ studentId: id, reason: "Not an active learner" }); continue; }
    const owed = new Prisma.Decimal(row.balance);
    if (!owed.gt(0)) { skipped.push({ studentId: id, reason: "Owes nothing" }); continue; }
    const link = student.guardians.find(g => g.isPrimary && g.receivesNotifications && !g.guardian.anonymizedAt) ?? student.guardians.find(g => g.receivesNotifications && !g.guardian.anonymizedAt);
    if (!link) { skipped.push({ studentId: id, reason: "No parent to message" }); continue; }
    try { await messageReadiness(schoolId, channel, "fee_reminder", link.guardianId); }
    catch (error) { skipped.push({ studentId: id, reason: error instanceof ApiError ? error.message : "Messaging is not ready" }); continue; }
    const due = invoices.filter(i => i.studentId === id).map(i => String((i.data as Record<string, unknown>).dueDate ?? "")).filter(Boolean).sort()[0];
    const content = `Dear ${link.guardian.name}, ${student.firstName}'s fee balance at ${actor.school.name} is ${kes(owed)}${due ? `, due ${new Date(`${due}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}. Pay to the school paybill using account ${student.admissionNo}. Thank you.`;
    await queueMessage(db, schoolId, { guardianId: link.guardianId, phone: link.guardian.phone, channel, template: "fee_reminder", content, idempotencyKey: `fee-reminder:${id}:${day}:${owed.toFixed(2)}` });
    queued++;
  }
  await audit(db, actor, "fee_reminders_sent", "school", schoolId, undefined, { requested: ids.length, queued, skipped: skipped.length, channel });
  return { queued, skipped };
}

