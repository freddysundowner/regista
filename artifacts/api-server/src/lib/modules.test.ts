import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { choose, reference, fullPhone, jaroWinkler, editDistance } from "./payments/matching";
import { verifySignature, encryptCredentials, decryptCredentials } from "./integrations/security";
import { candidates, postIncoming, siblingSplits } from "./payments/pipeline";
import { csvRows, previewStatement } from "./integrations/banks";
import { createRecord, decideRecord } from "./finance/service";
import { requestUnmatchedRefund, decideUnmatchedRefund, payUnmatchedRefund, refreshSponsorBatch } from "./payments/settlements";
import { money, sum } from "./finance/money";
import { saveCurriculum, createAssessment, saveResult, termResults, saveAttendance } from "./academics/service";
import { createPlan, decidePlan } from "./payments/plans";
import { schoolReport, reportTypes } from "./reports";
import type { Actor } from "./core";

test("phase 3 deterministic matching gate: normalization, masked phones, typo scores and ties", () => {
  assert.equal(reference("adm 0123"), "123");
  assert.equal(reference("ADMNO-000123"), "123");
  assert.equal(fullPhone("2547 ***** 126"), null);
  assert.equal(fullPhone("2547abcdef"), null);
  assert.equal(fullPhone("0712345678"), "254712345678");
  assert.equal(editDistance("1234", "1235"), 1);
  assert.ok(jaroWinkler("MARTHA", "MARHTA") > 0.9);
  assert.equal(choose([{ studentId: "a", score: 100, reasons: [] }, { studentId: "b", score: 100, reasons: [] }], 85).winner, null);
  assert.equal(choose([{ studentId: "a", score: 75, reasons: [] }], 85).winner, null);
});
test("phase 4 cryptographic gate: authenticated encryption, tamper and timestamp rejection", () => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const encrypted = encryptCredentials({ key: "test-only-fixture" });
    assert.equal(decryptCredentials(encrypted).key, "test-only-fixture");
    assert.throws(() => decryptCredentials(encrypted.slice(0, -3) + "xxx"));
    const timestamp = String(Date.now()), body = Buffer.from("POST./api/bot/v1/identify.254712345678.{}");
    const signature = createHmac("sha256", "test-secret").update(timestamp).update(".").update(body).digest("hex");
    verifySignature("test-secret", timestamp, body, signature);
    assert.throws(() => verifySignature("test-secret", timestamp, Buffer.from("changed-child"), signature));
    assert.throws(() => verifySignature("test-secret", timestamp, body, signature, Number(timestamp) + 300001));
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => encryptCredentials({ key: "no-fallback" }), /not configured/);
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});
test("phase 5 fallback gate: quoted CSV mapping, exact decimals and invalid rows", async () => {
  assert.deepEqual(csvRows('ref,narrative\nA,"A, B"\n'), [["ref", "narrative"], ["A", "A, B"]]);
  const preview = await previewStatement({ provider: "bank-contract-not-selected", format: "csv", content: "ref,amount,date\nA,0.30,2026-01-01T00:00:00Z\nB,1.001,invalid", mapping: { providerTxnId: "ref", amount: "amount", transactionTime: "date" } });
  assert.equal(preview.rows[0].amount, "0.30"); assert.equal(preview.errors.length, 1);
});
test("phases 3–7 PostgreSQL gate: allocation, tenant/teacher boundaries, weighted levels, locks, plans, registers and 13 reports", async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development-only acceptance test");
  const rollback = new Error("rollback module fixtures"), originalTransaction = db.$transaction.bind(db);
  try {
    await originalTransaction(async tx => {
      // All services use the actual PostgreSQL transaction. Nested application
      // transaction boundaries are redirected solely in this isolated test process.
      (db as any).$transaction = (fn: any) => fn(tx);
      const school = await tx.school.create({ data: { code: `MODULE-${randomUUID()}`, name: "Module acceptance fixture", type: "primary", settings: { autoPostThreshold: 85 } } });
      const other = await tx.school.create({ data: { code: `OTHER-${randomUUID()}`, name: "Other tenant fixture", type: "primary" } });
      const admin = await tx.user.create({ data: { schoolId: school.id, name: "Administrator", email: `${randomUUID()}@example.invalid`, role: "school_admin", passwordHash: "unusable-test-password" } });
      const teacher = await tx.user.create({ data: { schoolId: school.id, name: "Teacher", email: `${randomUUID()}@example.invalid`, role: "class_teacher", passwordHash: "unusable-test-password" } });
      const bursar = await tx.user.create({ data: { schoolId: school.id, name: "Bursar", email: `${randomUUID()}@example.invalid`, role: "bursar", passwordHash: "unusable-test-password" } });
      const principal = await tx.user.create({ data: { schoolId: school.id, name: "Principal", email: `${randomUUID()}@example.invalid`, role: "principal", passwordHash: "unusable-test-password" } });
      const actor: Actor = { school, user: admin }, teaching: Actor = { school, user: teacher }, cashier: Actor = { school, user: bursar };
      const year = await tx.academicYear.create({ data: { schoolId: school.id, name: "Test year", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
      const term = await tx.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Test term", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), isCurrent: true } });
      const grade = await tx.grade.create({ data: { schoolId: school.id, name: "Grade test", levelBand: "lower_primary", order: 1 } });
      const stream = await tx.stream.create({ data: { schoolId: school.id, gradeId: grade.id, name: "East", classTeacherUserId: teacher.id } });
      const family = await tx.family.create({ data: { schoolId: school.id, name: "Test family" } });
      const student = await tx.student.create({ data: { schoolId: school.id, admissionNo: "123", firstName: "Learner", lastName: "Test", gradeId: grade.id, streamId: stream.id, familyId: family.id } });
      const sibling = await tx.student.create({ data: { schoolId: school.id, admissionNo: "124", firstName: "Sibling", lastName: "Test", gradeId: grade.id, streamId: stream.id, familyId: family.id } });
      const guardian = await tx.guardian.create({ data: { schoolId: school.id, name: "Guardian Test", phone: "254711223344" } });
      await tx.studentGuardian.createMany({ data: [student, sibling].map(s => ({ schoolId: school.id, studentId: s.id, guardianId: guardian.id, relationship: "parent", isPrimary: true })) });
      const feeItem = await createRecord(tx, actor, { kind: "fee_item", idempotencyKey: "fee", name: "Tuition", code: "TU", priority: 1, isOptional: false });
      for (const child of [student, sibling]) await createRecord(tx, cashier, { kind: "invoice", idempotencyKey: `invoice:${child.id}`, studentId: child.id, dueDate: new Date("2026-12-01"), lines: [{ feeItemId: feeItem.id, amount: "100.00" }] });
      const candidateInput = { accountReference: "adm 0123", payerPhone: guardian.phone, payerName: null, bankAccountFrom: null, amount: money("50.00") };
      assert.equal((await candidates(tx, actor, candidateInput)).winner, student.id);
      const siblings = await candidates(tx, actor, { ...candidateInput, accountReference: "" });
      assert.equal(siblings.siblingFlow, true); assert.equal(siblings.winner, null);
      const split = await siblingSplits(tx, school.id, [student.id, sibling.id], money("0.03"), "proportional_to_balance");
      assert.equal(sum(split.map(s => money(s.amount))).toFixed(2), "0.03");
      const raw = await tx.incomingPayment.create({ data: { schoolId: school.id, provider: "test-provider", providerTxnId: "TEST-1", channel: "bank", amount: money("20.00"), transactionTime: new Date(), source: "acceptance_fixture", rawPayload: {}, requestedBy: bursar.id } });
      await postIncoming(tx, cashier, raw.id, [{ studentId: student.id, amount: "20.00" }], "acceptance");
      await postIncoming(tx, cashier, raw.id, [{ studentId: student.id, amount: "20.00" }], "idempotent retry");
      assert.equal(await tx.paymentStudentAllocation.count({ where: { schoolId: school.id, paymentId: raw.id } }), 1);
      await assert.rejects(postIncoming(tx, { ...cashier, school: other }, raw.id, [{ studentId: student.id, amount: "20.00" }], "cross tenant"), /not found/);
      const area = await saveCurriculum(actor, { kind: "learning_area", gradeId: grade.id, code: "ENG", name: "English" });
      const scale = await saveCurriculum(actor, { kind: "scale", name: "Test four levels", levels: [
        { code: "BE", label: "BE", points: "1", minPercent: "0", maxPercent: "30", order: 1 },
        { code: "AE", label: "AE", points: "2", minPercent: "30", maxPercent: "50", order: 2 },
        { code: "ME", label: "ME", points: "3", minPercent: "50", maxPercent: "80", order: 3 },
        { code: "EE", label: "EE", points: "4", minPercent: "80", maxPercent: "100", order: 4 },
      ] });
      await saveCurriculum(actor, { kind: "grade_scale", gradeId: grade.id, scaleId: scale.id });
      await saveCurriculum(actor, { kind: "assignment", userId: teacher.id, streamId: stream.id, learningAreaId: area.id, termId: term.id });
      const first = await createAssessment(teaching, { termId: term.id, gradeId: grade.id, learningAreaId: area.id, name: "First", type: "summative", weight: "1", maxMarks: "100", date: new Date("2026-02-01") });
      const second = await createAssessment(teaching, { termId: term.id, gradeId: grade.id, learningAreaId: area.id, name: "Second", type: "summative", weight: "3", maxMarks: "100", date: new Date("2026-03-01") });
      const firstResult = await saveResult(teaching, first.id, { studentId: student.id, marks: "40", expectedRevision: 0 });
      await saveResult(teaching, second.id, { studentId: student.id, marks: "80", expectedRevision: 0 });
      const result = (await termResults(tx, school.id, student.id, term.id))[0];
      assert.equal(result.percent, "70.00"); assert.equal(result.level, "ME");
      await assert.rejects(saveResult(teaching, first.id, { studentId: student.id, marks: "45", expectedRevision: 0 }), /changed elsewhere/);
      await assert.rejects(saveResult({ ...teaching, school: other }, first.id, { studentId: student.id, marks: "45", expectedRevision: 1 }), /not found/);
      await assert.rejects(saveResult(cashier, first.id, { studentId: student.id, marks: "45", expectedRevision: 1 }), /access denied/);
      const ee = await tx.performanceLevel.findFirstOrThrow({ where: { schoolId: school.id, scaleId: scale.id, code: "EE" } });
      await assert.rejects(saveResult(teaching, first.id, { studentId: student.id, marks: "40", performanceLevelId: ee.id, expectedRevision: 1 }), /override requires/);
      await tx.assessment.update({ where: { id: first.id }, data: { status: "locked" } });
      await assert.rejects(saveResult(teaching, first.id, { studentId: student.id, marks: "45", expectedRevision: 1 }), /locked/);
      const register = { streamId: stream.id, date: new Date("2026-02-01"), entries: [{ studentId: student.id, status: "present" as const }, { studentId: sibling.id, status: "absent" as const }] };
      await saveAttendance(teaching, register); await saveAttendance(teaching, register);
      assert.equal(await tx.attendanceRecord.count({ where: { schoolId: school.id } }), 2);
      await assert.rejects(saveAttendance(cashier, register), /class teacher/);
      const plan = await createPlan(cashier, { studentId: student.id, termId: term.id, installments: [{ dueDate: new Date("2026-12-01"), amount: "40.00" }, { dueDate: new Date("2026-12-15"), amount: "40.00" }] });
      await assert.rejects(decidePlan(cashier, plan.id, "approved", "self"), /own payment plan/);
      await decidePlan({ school, user: principal }, plan.id, "approved", "Approved");
      for (const type of reportTypes) {
        const report = await schoolReport(actor, type, { ...(type === "statement" ? { studentId: student.id } : {}), termId: term.id }, tx);
        assert.ok(Array.isArray(report.rows), type); assert.ok(Array.isArray(report.columns), type);
      }
      assert.equal((await schoolReport(actor, "balances", { studentId: student.id }, tx)).rows[0].balance, "80.00");
      const refundPayment = await tx.incomingPayment.create({ data: { schoolId: school.id, provider: "test-fixture", providerTxnId: "REFUND-1", channel: "bank", amount: money("30"), transactionTime: new Date(), source: "acceptance_fixture", rawPayload: {}, requestedBy: bursar.id, status: "unmatched" } });
      const exception = await tx.matchException.create({ data: { schoolId: school.id, paymentId: refundPayment.id, reason: "no_reference", candidates: [] } });
      const refund = await requestUnmatchedRefund(tx, cashier, exception.id, "Verified payer requested return");
      await assert.rejects(payUnmatchedRefund(cashier, refund.id, "EVIDENCE"), /Approved/);
      await assert.rejects(decideUnmatchedRefund(cashier, refund.id, "approved", "self"), /approver/);
      await decideUnmatchedRefund({ school, user: principal }, refund.id, "approved", "Reviewed payer evidence");
      await payUnmatchedRefund(cashier, refund.id, "EVIDENCE"); await payUnmatchedRefund(cashier, refund.id, "EVIDENCE");
      assert.equal(await tx.suspenseEntry.count({ where: { paymentId: refundPayment.id } }), 2);
      assert.equal((await tx.incomingPayment.findUniqueOrThrow({ where: { id: refundPayment.id } })).status, "refunded");
      await assert.rejects(postIncoming(tx, cashier, refundPayment.id, [{ studentId: student.id, amount: "30" }], "double-spend"), /reserved/);
      const sponsor = await createRecord(tx, actor, { kind: "sponsor", idempotencyKey: "sponsor", name: "Test sponsor", sponsorType: "ngo" });
      const sponsorPayment = await tx.incomingPayment.create({ data: { schoolId: school.id, provider: "test-fixture", providerTxnId: "SPONSOR-1", channel: "bank", amount: money("25"), transactionTime: new Date(), source: "acceptance_fixture", rawPayload: {}, requestedBy: bursar.id, status: "sponsor_pending" } });
      const batch = await tx.sponsorBatch.create({ data: { schoolId: school.id, paymentId: sponsorPayment.id, sponsorId: sponsor.id, allocatedAmount: money("20"), heldAmount: money("25"), remainderReason: "Hold five", requestedBy: bursar.id } });
      const credit = await createRecord(tx, cashier, { kind: "adjustment", idempotencyKey: "sponsor-credit", studentId: student.id, sponsorId: sponsor.id, amount: "20", adjustmentType: "bursary", reason: "Approved grant" });
      await tx.sponsorAllocation.create({ data: { schoolId: school.id, batchId: batch.id, studentId: student.id, financeRecordId: credit.id, amount: money("20") } });
      await decideRecord(tx, { school, user: principal }, credit.id, "approved", "Evidence checked");
      await refreshSponsorBatch(tx, { school, user: principal }, credit.id); await refreshSponsorBatch(tx, { school, user: principal }, credit.id);
      assert.equal((await tx.sponsorBatch.findUniqueOrThrow({ where: { id: batch.id } })).heldAmount.toFixed(2), "5.00");
      assert.equal(await tx.ledgerEntry.count({ where: { referenceId: credit.id } }), 1);
      await tx.gradeScale.delete({ where: { gradeId: grade.id } });
      assert.equal((await termResults(tx, school.id, student.id, term.id))[0].percent, "70.00");
      await tx.$executeRawUnsafe("SAVEPOINT invalid_tenant");
      await assert.rejects(tx.subjectAssignment.create({ data: { schoolId: other.id, userId: teacher.id, streamId: stream.id, learningAreaId: area.id, termId: term.id } }));
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_tenant");
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { (db as any).$transaction = originalTransaction; await db.$disconnect(); }
});