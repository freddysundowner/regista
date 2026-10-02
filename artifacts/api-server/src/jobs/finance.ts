import { PgBoss } from "pg-boss";
import { db } from "@workspace/db";
import { lock } from "../lib/core";
import { logger } from "../lib/logger";
import { createDocument } from "../lib/finance/documents";
import { registerModuleWorkers } from "./modules";

export async function verifyLedger(schoolId: string) {
  return db.$transaction(async tx => {
    await lock(tx, schoolId);
    const mismatches = await tx.$queryRaw<{ studentId: string; ledgerBalance: string; cachedBalance: string }[]>`
      SELECT s.id AS "studentId", COALESCE(SUM(l.debit-l.credit),0)::text AS "ledgerBalance",
      COALESCE(b.balance,0)::text AS "cachedBalance"
      FROM students s LEFT JOIN ledger_entries l ON l."studentId"=s.id AND l."schoolId"=${schoolId}::uuid
      LEFT JOIN student_balances b ON b."studentId"=s.id AND b."schoolId"=${schoolId}::uuid
      WHERE s."schoolId"=${schoolId}::uuid GROUP BY s.id,b.balance
      HAVING COALESCE(SUM(l.debit-l.credit),0) <> COALESCE(b.balance,0)`;
    if (mismatches.length) {
      await tx.auditLog.create({ data: { schoolId, action: "ledger_mismatch", entityType: "finance_verification", after: mismatches } });
    }
    return mismatches;
  });
}
export function financeBoss() {
  return new PgBoss({ connectionString: process.env.DATABASE_URL, migrate: false, createSchema: false });
}
export async function startFinanceWorker() {
  const boss = financeBoss();
  boss.on("error", err => logger.error({ err }, "Finance worker failed"));
  await boss.start(); // schema and queues must be installed explicitly, never startup DDL
  await registerModuleWorkers(boss);
  await boss.work("finance-nightly", async () => {
    let failed = false;
    for (const school of await db.school.findMany({ where: { status: "active" } })) {
      const mismatches = await verifyLedger(school.id);
      if (mismatches.length) failed = true;
    }
    if (failed) throw new Error("Ledger mismatch detected; see school audit alerts");
  });
  await boss.work("finance-receipts", async () => {
    // The outbox is the durable handoff. No guardian notifications are sent in phase 2.
    const pending = await db.$queryRaw<{ schoolId: string; referenceId: string }[]>`
      SELECT p."schoolId",p."referenceId" FROM finance_outbox p
      WHERE p.event='payment.posted' AND NOT EXISTS (
        SELECT 1 FROM finance_outbox r WHERE r."schoolId"=p."schoolId"
        AND r."referenceId"=p."referenceId" AND r.event='receipt.generated'
      ) ORDER BY p."createdAt" ASC LIMIT 100`;
    for (const event of pending) {
      const payment = await db.financeRecord.findFirstOrThrow({ where: { id: event.referenceId, schoolId: event.schoolId } });
      const school = await db.school.findUniqueOrThrow({ where: { id: event.schoolId } });
      const user = await db.user.findUniqueOrThrow({ where: { id: payment.requestedBy } });
      const existing = await db.storedFile.findFirst({ where: { schoolId: school.id, entityType: "finance_receipt", entityId: payment.id, status: "ready" } });
      if (!existing) await createDocument({ school, user }, "receipt", payment.id);
      // Preserve payment.posted for the later notification consumer. Use a separate marker.
      await db.financeOutbox.upsert({
        where: { schoolId_event_referenceId: { schoolId: school.id, event: "receipt.generated", referenceId: payment.id } },
        create: { schoolId: school.id, event: "receipt.generated", referenceId: payment.id, payload: {}, processedAt: new Date() },
        update: {},
      });
    }
  });
  return boss;
}