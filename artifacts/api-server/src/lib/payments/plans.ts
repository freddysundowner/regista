import { db } from "@workspace/db";
import type { PlanInput } from "@workspace/api-zod";
import { ApiError, audit, owned, type Actor, type Tx } from "../core";
import { financeTransaction } from "../finance/posting";
import { money, sum, zero, minimum } from "../finance/money";
import { queueMessage } from "../integrations/messages";
import { netPaymentCredits, planWindowCredits } from "../finance/review-invariants";

export async function planView(tx: Tx, schoolId: string, id: string) {
  const plan = await tx.paymentPlan.findFirst({ where: { id, schoolId } });
  if (!plan) throw new ApiError(404, "Payment plan not found");
  return { ...plan, installments: await tx.planInstallment.findMany({ where: { schoolId, planId: id }, orderBy: { dueDate: "asc" } }) };
}
export async function createPlan(actor: Actor, input: PlanInput, requestedVia = "office") {
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id;
    await owned(tx, "student", input.studentId, schoolId); await owned(tx, "term", input.termId, schoolId);
    if (!input.installments.length || input.installments.length > 24 || input.installments.some(i => !money(i.amount).greaterThan(0))) throw new ApiError(400, "Plan needs 1–24 positive installments");
    if (new Set(input.installments.map(i => new Date(i.dueDate).toISOString())).size !== input.installments.length) throw new ApiError(400, "Installment dates must be unique");
    if (await tx.paymentPlan.findFirst({ where: { schoolId, studentId: input.studentId, status: { in: ["proposed", "active", "defaulted"] } } })) throw new ApiError(409, "Student already has an unresolved plan");
    const totalAmount = sum(input.installments.map(i => money(i.amount)));
    const balance = await tx.studentBalance.findFirst({ where: { schoolId, studentId: input.studentId } });
    if (!balance || totalAmount.greaterThan(balance.balance)) throw new ApiError(400, "Plan exceeds current outstanding balance");
    const baselineCredits = await paymentCredits(tx, schoolId, input.studentId);
    const threshold = (actor.school.settings as Record<string, any>).autoApprovePlanLimit;
    const automatic = typeof threshold === "string" && totalAmount.lte(money(threshold));
    const plan = await tx.paymentPlan.create({ data: { schoolId, studentId: input.studentId, termId: input.termId, totalAmount, baselineCredits, requestedVia, requestedBy: actor.user.id, status: automatic ? "active" : "proposed", approvedAt: automatic ? new Date() : null } });
    await tx.planInstallment.createMany({ data: input.installments.map(i => ({ schoolId, planId: plan.id, dueDate: i.dueDate, amount: money(i.amount) })) });
    await audit(tx, actor, "created", "payment_plan", plan.id, undefined, { totalAmount: totalAmount.toFixed(2), automatic });
    return planView(tx, schoolId, plan.id);
  });
}
export async function decidePlan(actor: Actor, id: string, decision: string, reason: string) {
  return financeTransaction(actor, async tx => {
    const plan = await planView(tx, actor.school.id, id);
    if (plan.requestedBy === actor.user.id) throw new ApiError(403, "Cannot approve own payment plan");
    if (plan.status !== "proposed") throw new ApiError(409, "Plan is already decided");
    await tx.paymentPlan.update({ where: { id }, data: { status: decision === "approved" ? "active" : "rejected", approvedBy: actor.user.id, approvedAt: new Date() } });
    await audit(tx, actor, decision, "payment_plan", id, undefined, { reason });
    return planView(tx, actor.school.id, id);
  });
}
export async function refreshPlans(actor: Actor) {
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id, today = new Date(new Date(Date.now() + 10800000).toISOString().slice(0, 10));
    const settings = actor.school.settings as Record<string, any>;
    const plans = await tx.paymentPlan.findMany({ where: { schoolId, status: { in: ["proposed", "active", "defaulted", "completed"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    for (const [index, plan] of plans.entries()) {
      if (plan.status === "proposed") continue;
      // Each agreement owns an exclusive payment-time window. Historical
      // completed plans are revisited so a later cash reversal reopens arrears.
      const next = plans.slice(index + 1).find(p => p.studentId === plan.studentId);
      const entries = await tx.ledgerEntry.findMany({ where: { schoolId, studentId: plan.studentId } });
      let available = planWindowCredits(entries, plan.createdAt, next?.createdAt);
      if (available.lessThan(0)) available = zero();
      let missed = 0, completed = true;
      for (const installment of await tx.planInstallment.findMany({ where: { schoolId, planId: plan.id }, orderBy: { dueDate: "asc" } })) {
        const amountPaid = minimum(installment.amount, available); available = available.minus(amountPaid);
        const status = amountPaid.equals(installment.amount) ? "paid" : installment.dueDate < today ? "overdue" : amountPaid.gt(0) ? "partially_paid" : installment.dueDate.getTime() === today.getTime() ? "due" : "upcoming";
        if (status !== "paid") completed = false;
        if (status === "overdue") missed++;
        await tx.planInstallment.update({ where: { id: installment.id }, data: { amountPaid, status } });
        const dayOffset = Math.round((today.getTime() - installment.dueDate.getTime()) / 86400000);
        if (status !== "paid" && (settings.reminderDays ?? [-3, 0, 3]).includes(dayOffset)) {
          const guardian = await tx.studentGuardian.findFirst({ where: { schoolId, studentId: plan.studentId, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
          if (guardian) await queueMessage(tx, schoolId, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template: "installment_reminder", content: `Installment balance KES ${installment.amount.minus(amountPaid).toFixed(2)} due ${installment.dueDate.toISOString().slice(0, 10)}`, idempotencyKey: `installment:${installment.id}:${dayOffset}` });
        }
      }
      await tx.paymentPlan.update({ where: { id: plan.id }, data: { status: completed ? "completed" : missed >= (settings.defaultAfterMissedInstallments ?? 2) ? "defaulted" : "active" } });
    }
  });
}
async function paymentCredits(tx: Tx, schoolId: string, studentId: string) {
  const entries = await tx.ledgerEntry.findMany({ where: { schoolId, studentId } });
  return netPaymentCredits(entries);
}