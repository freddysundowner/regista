import { db as database, Prisma } from "@workspace/db";
import type { ReportFilterInput } from "@workspace/api-zod";
import { ApiError, owned, type Actor, type Tx } from "./core";
import { metadata } from "./finance/posting";
import { money, sum, zero } from "./finance/money";
import { termResults } from "./academics/service";
import { academicReaders, classAccess } from "./academics/access";

export const reportTypes = ["collections", "fee-items", "balances", "defaulters", "aged-arrears", "unmatched", "reconciliation", "adjustments", "sponsors", "plans", "statement", "performance", "attendance"] as const;
type Row = Record<string, string | number | boolean | null>;
export async function schoolReport(actor: Actor, type: string, input: ReportFilterInput, db: Tx = database) {
  if (!reportTypes.includes(type as any)) throw new ApiError(404, "Unknown report");
  const academic = ["performance", "attendance"].includes(type);
  if (!(academic ? academicReaders : ["school_admin", "super_admin", "principal", "bursar"]).includes(actor.user.role)) throw new ApiError(403, "Report access denied");
  const schoolId = actor.school.id;
  if (input.studentId) await owned(db, "student", input.studentId, schoolId);
  if (input.gradeId) await owned(db, "grade", input.gradeId, schoolId);
  if (input.termId) await owned(db, "term", input.termId, schoolId);
  let from = input.from ? new Date(input.from) : undefined, to = input.to ? new Date(new Date(input.to).getTime() + 86400000 - 1) : undefined;
  if (from && to && from > to) throw new ApiError(400, "Report from-date exceeds to-date");
  if (input.termId && !from && !to) {
    const term = await owned(db, "term", input.termId, schoolId);
    from = term.startDate; to = new Date(term.endDate.getTime() + 86400000 - 1);
  }
  const inRange = (date: Date) => (!from || date >= from) && (!to || date <= to);
  let students = await db.student.findMany({ where: { schoolId, ...(input.gradeId ? { gradeId: input.gradeId } : {}), ...(input.studentId ? { id: input.studentId } : {}) }, include: { grade: true, stream: true } });
  if (["teacher", "class_teacher"].includes(actor.user.role)) {
    const classStreams = await db.stream.findMany({ where: { schoolId, classTeacherUserId: actor.user.id } });
    const assignments = await db.subjectAssignment.findMany({ where: { schoolId, userId: actor.user.id } });
    const ids = new Set([...classStreams.map(s => s.id), ...assignments.map(a => a.streamId)]);
    students = students.filter(s => s.streamId && ids.has(s.streamId));
    if (input.studentId && !students.length) throw new ApiError(404, "Student not found");
  }
  const studentIds = new Set(students.map(s => s.id)), rows: Row[] = [];
  const name = (id: string) => { const s = students.find(s => s.id === id); return s ? `${s.firstName} ${s.lastName}` : ""; };
  const base = (id: string) => { const s = students.find(s => s.id === id); return { studentId: id, admissionNo: s?.admissionNo ?? "", studentName: name(id), grade: s?.grade?.name ?? "", stream: s?.stream?.name ?? "" }; };
  if (type === "performance") {
    const terms = await db.term.findMany({ where: { schoolId, ...(input.termId ? { id: input.termId } : {}) }, orderBy: { startDate: "asc" } });
    const grouped = new Map<string, Row>();
    for (const student of students) for (const term of terms) {
      const results = await termResults(db, schoolId, student.id, term.id);
      for (const result of results) {
        if (!result.level) continue;
        if (["teacher", "class_teacher"].includes(actor.user.role) && student.stream?.classTeacherUserId !== actor.user.id) {
          if (!await db.subjectAssignment.findFirst({ where: { schoolId, userId: actor.user.id, streamId: student.streamId!, learningAreaId: result.learningAreaId, termId: term.id } })) continue;
        }
        if (input.studentId) rows.push({ ...base(student.id), term: term.name, learningArea: result.learningArea, percent: result.percent, level: result.level });
        else {
          const key = `${student.gradeId}:${student.streamId}:${term.id}:${result.learningAreaId}:${result.level}`;
          const prior = grouped.get(key);
          if (prior) prior.learners = Number(prior.learners) + 1;
          else grouped.set(key, { grade: student.grade?.name ?? "", stream: student.stream?.name ?? "", term: term.name, learningArea: result.learningArea, level: result.level, learners: 1 });
        }
      }
    }
    if (!input.studentId) rows.push(...grouped.values());
  } else if (type === "attendance") {
    for (const student of students) {
      const attendance = await db.attendanceRecord.findMany({ where: { schoolId, studentId: student.id } });
      const selected = attendance.filter(a => inRange(a.date)), absent = selected.filter(a => a.status === "absent").length, attended = selected.filter(a => ["present", "late"].includes(a.status)).length;
      const percent = selected.length ? new Prisma.Decimal(attended).times(100).div(selected.length).toFixed(2) : "0.00";
      rows.push({ ...base(student.id), recordedDays: selected.length, attended, absent, attendancePercent: percent, chronicAbsentee: selected.length > 0 && new Prisma.Decimal(absent).times(100).div(selected.length).gte((actor.school.settings as Record<string, any>).chronicAbsencePercent ?? 20) });
    }
  } else {
    const records = await db.financeRecord.findMany({ where: { schoolId } }), allLedger = await db.ledgerEntry.findMany({ where: { schoolId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const selectedLedger = allLedger.filter(e => studentIds.has(e.studentId) && inRange(e.createdAt));
    const allocations = await db.feeAllocation.findMany({ where: { schoolId } });
    if (type === "collections") {
      const grouped = new Map<string, Prisma.Decimal>();
      for (const entry of selectedLedger) {
        const original = entry.reversesId ? allLedger.find(e => e.id === entry.reversesId) : undefined;
        if (entry.type !== "payment" && entry.type !== "refund" && !(entry.type === "reversal" && original?.type === "payment")) continue;
        const record = records.find(r => r.id === (original?.referenceId ?? entry.referenceId));
        const source = record?.kind === "refund" ? records.find(r => r.id === record.parentId) : record;
        const channel = source ? metadata(source).channel ?? "refund" : "unknown";
        const key = `${entry.createdAt.toISOString().slice(0, 10)}|${channel}`;
        grouped.set(key, (grouped.get(key) ?? zero()).plus(entry.credit.minus(entry.debit)));
      }
      for (const [key, amount] of grouped) { const [date, channel] = key.split("|"); rows.push({ date, channel, amount: amount.toFixed(2) }); }
    } else if (type === "fee-items") {
      const lines = await db.invoiceLine.findMany({ where: { schoolId } }), grouped = new Map<string, Prisma.Decimal>();
      for (const allocation of allocations) {
        if (!studentIds.has(allocation.studentId) || !inRange(allocation.createdAt) || records.find(r => r.id === allocation.sourceId)?.kind !== "payment") continue;
        const itemId = lines.find(l => l.id === allocation.invoiceLineId)?.feeItemId;
        if (itemId) grouped.set(itemId, (grouped.get(itemId) ?? zero()).plus(allocation.amount));
      }
      for (const [id, amount] of grouped) rows.push({ feeItem: metadata(records.find(r => r.id === id)!).name, amount: amount.toFixed(2) });
    } else if (["balances", "defaulters"].includes(type)) {
      const plans = await db.paymentPlan.findMany({ where: { schoolId, status: "active" } });
      for (const student of students) {
        const entries = allLedger.filter(e => e.studentId === student.id), broughtForward = sum(entries.filter(e => from && e.createdAt < from).map(e => e.debit.minus(e.credit)));
        const balance = sum(entries.filter(e => !to || e.createdAt <= to).map(e => e.debit.minus(e.credit)));
        const activePlan = plans.some(p => p.studentId === student.id);
        if (type === "defaulters" && (!balance.gt(input.minimumBalance ? money(input.minimumBalance) : zero()) || (input.activePlan !== undefined && input.activePlan !== activePlan))) continue;
        rows.push({ ...base(student.id), broughtForward: broughtForward.toFixed(2), balance: balance.toFixed(2), activePlan });
      }
    } else if (type === "aged-arrears") {
      const terms = await db.term.findMany({ where: { schoolId }, orderBy: { startDate: "desc" } });
      const anchor = terms.findIndex(t => t.id === input.termId || (!input.termId && t.isCurrent));
      for (const student of students) {
        const buckets = [zero(), zero(), zero(), zero()];
        for (const invoice of records.filter(r => r.kind === "invoice" && r.studentId === student.id && r.status !== "cancelled")) {
          const paid = sum(allocations.filter(a => a.invoiceId === invoice.id).map(a => a.amount)), balance = invoice.amount.minus(paid);
          if (!balance.gt(0)) continue;
          const index = invoice.termId ? terms.findIndex(t => t.id === invoice.termId) : 0;
          const age = Math.max(0, Math.min(3, index - Math.max(0, anchor)));
          buckets[age] = buckets[age].plus(balance);
        }
        rows.push({ ...base(student.id), current: buckets[0].toFixed(2), oneTerm: buckets[1].toFixed(2), twoTerms: buckets[2].toFixed(2), threePlusTerms: buckets[3].toFixed(2) });
      }
    } else if (type === "unmatched") {
      for (const payment of await db.incomingPayment.findMany({ where: { schoolId, status: { in: ["unmatched", "suspended"] } } })) if (inRange(payment.transactionTime)) rows.push({ id: payment.id, provider: payment.provider, providerTxnId: payment.providerTxnId, amount: payment.amount.toFixed(2), status: payment.status, ageDays: Math.floor((Date.now() - payment.createdAt.getTime()) / 86400000) });
    } else if (type === "reconciliation") {
      for (const run of await db.reconciliationRun.findMany({ where: { schoolId } })) if (inRange(run.createdAt)) rows.push({ id: run.id, provider: run.provider, status: run.status, statementCount: run.statementCount, systemCount: run.systemCount, statementTotal: run.statementTotal.toFixed(2), systemTotal: run.systemTotal.toFixed(2), discrepancyCount: Array.isArray(run.discrepancies) ? run.discrepancies.length : 0 });
    } else if (type === "adjustments" || type === "sponsors") {
      const users = await db.user.findMany({ where: { schoolId }, select: { id: true, name: true } });
      for (const adjustment of records.filter(r => r.kind === "adjustment" && r.studentId && studentIds.has(r.studentId) && inRange(r.createdAt))) {
        const data = metadata(adjustment);
        if (type === "sponsors" && !["bursary", "sponsorship"].includes(data.adjustmentType)) continue;
        rows.push({ ...base(adjustment.studentId!), type: data.adjustmentType, amount: adjustment.amount.toFixed(2), status: adjustment.status, recurring: !!data.recurring, reference: data.reference ?? "", reason: data.reason ?? "", sponsor: data.sponsorId ? metadata(records.find(r => r.id === data.sponsorId)!).name : "", requestedBy: users.find(u => u.id === adjustment.requestedBy)?.name ?? "", approvedBy: users.find(u => u.id === adjustment.approvedBy)?.name ?? "" });
      }
    } else if (type === "plans") {
      for (const plan of await db.paymentPlan.findMany({ where: { schoolId, studentId: { in: [...studentIds] }, ...(input.termId ? { termId: input.termId } : {}) } })) {
        const installments = await db.planInstallment.findMany({ where: { schoolId, planId: plan.id } });
        rows.push({ ...base(plan.studentId), status: plan.status, totalAmount: plan.totalAmount.toFixed(2), amountPaid: sum(installments.map(i => i.amountPaid)).toFixed(2), overdueInstallments: installments.filter(i => i.status === "overdue").length });
      }
    } else if (type === "statement") {
      if (!input.studentId) throw new ApiError(400, "Student statement requires studentId");
      let balance = sum(allLedger.filter(e => e.studentId === input.studentId && from && e.createdAt < from).map(e => e.debit.minus(e.credit)));
      rows.push({ date: from?.toISOString().slice(0, 10) ?? "", description: "Balance brought forward", debit: "0.00", credit: "0.00", balance: balance.toFixed(2) });
      for (const entry of selectedLedger) { balance = balance.plus(entry.debit).minus(entry.credit); rows.push({ date: entry.createdAt.toISOString().slice(0, 10), description: entry.description, debit: entry.debit.toFixed(2), credit: entry.credit.toFixed(2), balance: balance.toFixed(2) }); }
    }
  }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return { title: type.replace(/-/g, " "), columns: keys.map(key => ({ key, label: key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()) })), rows, generatedAt: new Date().toISOString() };
}