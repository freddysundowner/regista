import { db } from "@workspace/db";
import type { PgBoss } from "pg-boss";
import { processPayment, postIncoming, siblingSplits } from "../lib/payments/pipeline";
import { financeTransaction, metadata } from "../lib/finance/posting";
import { refreshPlans } from "../lib/payments/plans";
import { systemActor } from "../lib/integrations/security";
import { queryStk, pullTransactions } from "../lib/integrations/daraja";
import { queueMessage, sendDelivery } from "../lib/integrations/messages";
import { audit } from "../lib/core";
import { databaseBackup } from "../lib/backups";

export async function registerModuleWorkers(boss: PgBoss) {
  await boss.work("database-backup", async () => { await databaseBackup(); });
  await boss.work("payment-pipeline", async () => {
    for (const payment of await db.incomingPayment.findMany({ where: { status: "received" }, orderBy: { createdAt: "asc" }, take: 100 })) await processPayment(payment.schoolId, payment.id);
  });
  await boss.work("message-delivery", async () => {
    const failures: string[] = [];
    for (const message of await db.messageDelivery.findMany({ where: { status: { in: ["queued", "failed"] }, attempts: { lt: 5 }, scheduledAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 100 })) {
      try { await sendDelivery(message.id, message.schoolId); }
      catch { failures.push(message.id); }
    }
    if (failures.length) throw new Error(`${failures.length} notification submissions failed; see school notification diagnostics`);
  });
  await boss.work("school-daily", async () => {
    for (const school of await db.school.findMany({ where: { status: "active" } })) await refreshPlans(await systemActor(school.id));
  });
  await boss.work("payment-followup", async () => {
    const failures: string[] = [];
    for (const request of await db.stkRequest.findMany({ where: { status: "pending", createdAt: { lt: new Date(Date.now() - 120000) } }, take: 50 })) {
      try { await queryStk(request.schoolId, request.id); } catch { failures.push(request.id); }
    }
    for (const exception of await db.matchException.findMany({ where: { status: "open", expiresAt: { lte: new Date() } }, take: 100 })) {
      const actor = await systemActor(exception.schoolId);
      await financeTransaction(actor, async tx => {
        const current = await tx.matchException.findFirst({ where: { id: exception.id, schoolId: actor.school.id, status: "open", expiresAt: { lte: new Date() } } });
        if (!current) return;
        const payment = await tx.incomingPayment.findFirstOrThrow({ where: { id: current.paymentId, schoolId: actor.school.id } });
        const rule = (actor.school.settings as Record<string, any>).siblingFallbackRule ?? "proportional_to_balance";
        if (rule === "leave_in_queue") {
          await tx.matchException.update({ where: { id: current.id }, data: { expiresAt: null, resolution: "parent_timeout_bursar_required" } }); return;
        }
        const guardian = await tx.guardian.findFirst({ where: { schoolId: actor.school.id, phone: payment.payerPhone ?? "" } });
        const children = guardian ? await tx.studentGuardian.findMany({ where: { schoolId: actor.school.id, guardianId: guardian.id }, include: { student: true } }) : [];
        const splits = await siblingSplits(tx, actor.school.id, children.filter(c => c.student.status === "active").map(c => c.studentId), payment.amount, rule);
        await postIncoming(tx, actor, payment.id, splits, `parent_timeout_${rule}`);
        await tx.matchException.update({ where: { id: current.id }, data: { status: "resolved", resolution: rule, resolvedAt: new Date(), resolvedBy: actor.user.id } });
        await audit(tx, actor, "timeout_resolved", "match_exception", current.id);
      });
    }
    if (failures.length) throw new Error(`${failures.length} STK queries failed`);
  });
  await boss.work("daily-reconciliation", async () => {
    const configs = await db.integrationConfig.findMany({ where: { enabled: true, provider: { in: ["daraja", "bank"] } } });
    for (const config of configs) {
      await db.integrationEvent.create({ data: { schoolId: config.schoolId, provider: config.provider, event: "daily_reconciliation", status: "unavailable", detail: { reason: config.provider === "daraja" ? "Pull query endpoint/transport/pagination unverified; authorized statement upload required" : "Pilot bank API contract not supplied" } } });
    }
    if (configs.length) pullTransactions();
  });
  await boss.work("notification-outbox", async () => {
    const events = await db.$queryRaw<{ id: string; schoolId: string; referenceId: string; event: string }[]>`
      SELECT p.id,p."schoolId",p."referenceId",p.event FROM finance_outbox p
      WHERE p.event IN ('invoice.posted','receipt.generated') AND NOT EXISTS (
        SELECT 1 FROM finance_outbox n WHERE n."schoolId"=p."schoolId" AND n."referenceId"=p."referenceId" AND n.event='notification.queued.'||p.event
      ) ORDER BY p."createdAt" LIMIT 100`;
    for (const event of events) {
      const actor = await systemActor(event.schoolId);
      await financeTransaction(actor, async tx => {
        const record = await tx.financeRecord.findFirstOrThrow({ where: { id: event.referenceId, schoolId: event.schoolId } });
        const guardian = await tx.studentGuardian.findFirst({ where: { schoolId: event.schoolId, studentId: record.studentId!, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
        if (!guardian) throw new Error("Primary guardian notification recipient unavailable");
        const template = event.event === "invoice.posted" ? "invoice_issued" : "payment_receipt";
        await queueMessage(tx, event.schoolId, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template, content: `${template === "invoice_issued" ? "Invoice" : "Receipt"} ${metadata(record).invoiceNo ?? metadata(record).receiptNo}: KES ${record.amount.toFixed(2)}`, idempotencyKey: `outbox:${event.id}` });
        await tx.financeOutbox.create({ data: { schoolId: event.schoolId, event: `notification.queued.${event.event}`, referenceId: event.referenceId, payload: {} } });
      });
    }
  });
}