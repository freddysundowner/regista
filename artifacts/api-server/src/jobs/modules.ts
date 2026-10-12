import { db } from "@workspace/db";
import type { PgBoss } from "pg-boss";
import { processPayment, postIncoming, siblingSplits } from "../lib/payments/pipeline";
import { financeTransaction, metadata } from "../lib/finance/posting";
import { refreshPlans } from "../lib/payments/plans";
import { systemActor } from "../lib/integrations/security";
import { queryStk, pullTransactions } from "../lib/integrations/daraja";
import { queueMessage, sendDelivery } from "../lib/integrations/messages";
import { ApiError, audit } from "../lib/core";
import { databaseBackup } from "../lib/backups";
import { logger } from "../lib/logger";
import { queueStatusDigests } from "../lib/digest";

/**
 * Runs every item even when some fail, so one school's bad record never holds up the rest.
 * The job still ends as failed when anything went wrong, which keeps it visible under failed jobs.
 */
async function each<T extends { id: string }>(job: string, items: T[], run: (item: T) => Promise<unknown>) {
  let failures = 0;
  for (const item of items) {
    try { await run(item); }
    catch (err) { failures++; logger.warn({ err: err instanceof Error ? err.message : err, job, id: item.id }, "Job item failed; continuing with the rest"); }
  }
  if (failures) throw new Error(`${failures} of ${items.length} ${job} items failed; see the server log`);
}

export async function registerModuleWorkers(boss: PgBoss) {
  await boss.work("database-backup", async () => { await databaseBackup(); });
  await boss.work("payment-pipeline", async () => {
    await each("payment-pipeline", await db.incomingPayment.findMany({ where: { status: "received" }, orderBy: { createdAt: "asc" }, take: 100 }), payment => processPayment(payment.schoolId, payment.id));
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
    // The status message to school administrators goes out on its own days; a problem with it never stops the daily work.
    await queueStatusDigests().catch(err => logger.warn({ err: err instanceof Error ? err.message : err }, "Status digests failed"));
    await each("school-daily", await db.school.findMany({ where: { status: "active" } }), async school => refreshPlans(await systemActor(school.id)));
  });
  await boss.work("payment-followup", async () => {
    const failures: string[] = [];
    for (const request of await db.stkRequest.findMany({ where: { status: "pending", createdAt: { lt: new Date(Date.now() - 120000) } }, take: 50 })) {
      try { await queryStk(request.schoolId, request.id); } catch { failures.push(request.id); }
    }
    const expired = await db.matchException.findMany({ where: { status: "open", expiresAt: { lte: new Date() } }, take: 100 });
    await each("payment-followup", expired, async exception => {
      const actor = await systemActor(exception.schoolId);
      await financeTransaction(actor, async tx => {
        const current = await tx.matchException.findFirst({ where: { id: exception.id, schoolId: actor.school.id, status: "open", expiresAt: { lte: new Date() } } });
        if (!current) return;
        const payment = await tx.incomingPayment.findFirstOrThrow({ where: { id: current.paymentId, schoolId: actor.school.id } });
        const rule = (actor.school.settings as Record<string, any>).siblingFallbackRule ?? "proportional_to_balance";
        const leaveForBursar = () => tx.matchException.update({ where: { id: current.id }, data: { expiresAt: null, resolution: "parent_timeout_bursar_required" } });
        if (rule === "leave_in_queue") { await leaveForBursar(); return; }
        const guardian = await tx.guardian.findFirst({ where: { schoolId: actor.school.id, phone: payment.payerPhone ?? "" } });
        const children = guardian ? await tx.studentGuardian.findMany({ where: { schoolId: actor.school.id, guardianId: guardian.id }, include: { student: true } }) : [];
        let splits;
        try { splits = await siblingSplits(tx, actor.school.id, children.filter(c => c.student.status === "active").map(c => c.studentId), payment.amount, rule); }
        catch (error) {
          // No child owes anything, so there is nothing to split by: the bursar decides, and it stops retrying.
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          await leaveForBursar(); return;
        }
        await postIncoming(tx, actor, payment.id, splits, `parent_timeout_${rule}`);
        await tx.matchException.update({ where: { id: current.id }, data: { status: "resolved", resolution: rule, resolvedAt: new Date(), resolvedBy: actor.user.id } });
        await audit(tx, actor, "timeout_resolved", "match_exception", current.id);
      });
    });
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
    await each("notification-outbox", events, async event => {
      const actor = await systemActor(event.schoolId);
      await financeTransaction(actor, async tx => {
        const record = await tx.financeRecord.findFirstOrThrow({ where: { id: event.referenceId, schoolId: event.schoolId } });
        const guardian = await tx.studentGuardian.findFirst({ where: { schoolId: event.schoolId, studentId: record.studentId!, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
        // Nobody to tell: mark it handled so it isn't retried every minute. The invoice or receipt itself is unaffected.
        if (!guardian) {
          await tx.financeOutbox.create({ data: { schoolId: event.schoolId, event: `notification.queued.${event.event}`, referenceId: event.referenceId, payload: { skipped: "no_primary_guardian" } } });
          return;
        }
        const template = event.event === "invoice.posted" ? "invoice_issued" : "payment_receipt";
        await queueMessage(tx, event.schoolId, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template, content: `${template === "invoice_issued" ? "Invoice" : "Receipt"} ${metadata(record).invoiceNo ?? metadata(record).receiptNo}: KES ${record.amount.toFixed(2)}`, idempotencyKey: `outbox:${event.id}` });
        await tx.financeOutbox.create({ data: { schoolId: event.schoolId, event: `notification.queued.${event.event}`, referenceId: event.referenceId, payload: {} } });
      });
    });
  });
}