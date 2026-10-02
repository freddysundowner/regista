import { db } from "@workspace/db";
import { financeTransaction } from "./src/lib/finance/posting";
import { createRecord, decideRecord, invoiceBatch } from "./src/lib/finance/service";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Demo finance seeding is development-only");
try {
  const school = await db.school.findUniqueOrThrow({ where: { code: "DEMO-FOUNDATION-V2" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "foundation-demo-admin@example.invalid" } });
  if (admin.schoolId !== school.id) throw new Error("Demo administrator tenant mismatch");
  await financeTransaction({ school, user: admin }, async tx => {
    const checker = await tx.user.upsert({
      where: { email: "foundation-demo-checker@example.invalid" },
      create: { schoolId: school.id, name: "Synthetic Demo Checker", email: "foundation-demo-checker@example.invalid", role: "principal", passwordHash: "seed-only-no-valid-password" },
      update: {},
    });
    if (checker.schoolId !== school.id) throw new Error("Demo checker tenant mismatch");
    const year = await tx.academicYear.findUniqueOrThrow({ where: { schoolId_name: { schoolId: school.id, name: "2027" } } });
    const term = await tx.term.findUniqueOrThrow({ where: { academicYearId_name: { academicYearId: year.id, name: "Term 1" } } });
    const actor = { school, user: admin }, approver = { school, user: checker };
    const tuition = await createRecord(tx, actor, { kind: "fee_item", idempotencyKey: "demo-tuition", name: "Tuition", code: "TUITION", priority: 1, isOptional: false });
    const activity = await createRecord(tx, actor, { kind: "fee_item", idempotencyKey: "demo-activity", name: "Activity", code: "ACTIVITY", priority: 2, isOptional: false });
    for (const grade of await tx.grade.findMany({ where: { schoolId: school.id } })) {
      const structure = await createRecord(tx, actor, {
        kind: "fee_structure", idempotencyKey: `demo-structure:${grade.id}:${term.id}`, name: `${grade.name} — Term 1`,
        academicYearId: year.id, termId: term.id, gradeId: grade.id,
        lines: [{ feeItemId: tuition.id, amount: "12500.00" }, { feeItemId: activity.id, amount: "1500.00" }],
      });
      if (structure.status === "pending") await decideRecord(tx, approver, structure.id, "approved", "Synthetic demo fee structure approval");
    }
    const result = await invoiceBatch(tx, actor, { termId: term.id, dueDate: new Date("2027-01-25") }, true);
    console.info(`Demo term invoices available: ${result.invoices.length}. No payments fabricated.`);
  });
} finally { await db.$disconnect(); }