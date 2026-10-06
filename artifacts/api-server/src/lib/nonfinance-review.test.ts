import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { type Actor, streamAccess } from "./core";
import { studentInclude, studentView, scope } from "./students";
import { saveReportCard } from "./academics/service";
import { requirePublicationSnapshot } from "./academics/snapshot";
import { reportCardContent } from "./academics/documents";
import { queueMessage, recordDeliveryEvent, sendDelivery } from "./integrations/messages";
import { encryptCredentials } from "./integrations/security";
import guardians from "../routes/guardians";
import callbacks from "../routes/message-delivery-callbacks";
import reports from "../routes/reports";
import bot from "../routes/bot";

function handler(router: any, path: string, method: string) {
  return router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
}
const response = () => {
  const res: any = { status: () => res, json: (value: unknown) => value, sendStatus: (code: number) => code };
  return res;
};
function replace(t: { after: (fn: () => void) => void }, target: any, method: string, fn: any) {
  const original = target[method];
  target[method] = fn;
  t.after(() => { target[method] = original; });
}

test("publication validator refuses legacy/live substitution", () => {
  for (const value of [null, [], [{ level: "EE" }], { version: 1 }]) assert.throws(() => requirePublicationSnapshot(value), /complete snapshot/);
});

test("concurrent SMS claims send once; ambiguous transport never retries; accepted is not delivered", async t => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const row: any = { id: randomUUID(), schoolId: randomUUID(), guardianId: null, status: "queued", attempts: 0, channel: "sms", phone: "254700000001", content: "Synthetic only", template: "general" };
    const delegate = {
      findFirst: async ({ where }: any) => where.schoolId === row.schoolId && where.status.in.includes(row.status) ? { ...row } : null,
      updateMany: async ({ where, data }: any) => {
        if (where.schoolId !== row.schoolId || where.status !== row.status) return { count: 0 };
        Object.assign(row, data, { attempts: data.attempts ? row.attempts + data.attempts.increment : row.attempts });
        return { count: 1 };
      },
    };
    replace(t, db, "$transaction", async (fn: any) => fn({ $executeRaw: async () => 0, messageDelivery: delegate }));
    replace(t, db.messageDelivery, "updateMany", delegate.updateMany);
    replace(t, db.messagingAccount, "findUnique", async () => null);
    replace(t, db.integrationConfig, "findUnique", async () => ({ provider: "africastalking", enabled: true, environment: "sandbox", publicConfig: {}, encryptedCredentials: encryptCredentials({ apiKey: "synthetic", username: "sandbox" }) }));
    let calls = 0;
    let accepted = false;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (!accepted) throw new Error("connection lost after acceptance");
      return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101, messageId: "synthetic-accepted-id" }] } }), { status: 200 });
    });
    await Promise.allSettled([sendDelivery(row.id, row.schoolId), sendDelivery(row.id, row.schoolId)]);
    assert.equal(calls, 1);
    assert.equal(row.status, "uncertain");
    assert.equal(row.attempts, 1);
    await sendDelivery(row.id, row.schoolId);
    assert.equal(calls, 1);
    Object.assign(row, { id: randomUUID(), status: "queued", attempts: 0 });
    accepted = true;
    await sendDelivery(row.id, row.schoolId);
    assert.equal(row.status, "submitted"); assert.equal(row.providerMessageId, "synthetic-accepted-id");
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});

test("delivery gateway rejects missing authentication and modified payloads", async t => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const secret = randomBytes(32).toString("hex");
    replace(t, db.integrationConfig, "findUnique", async () => ({ enabled: true, provider: "leadsintel", encryptedCredentials: encryptCredentials({ deliveryGatewaySecret: secret }) }));
    const callback = handler(callbacks, "/integrations/message-delivery/events/:token", "post");
    const timestamp = String(Date.now()), rawBody = Buffer.from('{"status":"delivered"}');
    const signature = createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex");
    await assert.rejects(callback({ params: { token: "synthetic" }, get: () => undefined, rawBody }, response()), /timestamp/);
    await assert.rejects(callback({ params: { token: "synthetic" }, get: (key: string) => key === "X-Delivery-Timestamp" ? timestamp : signature, rawBody: Buffer.from('{"status":"rejected"}') }, response()), /signature/);
    let updates = 0;
    replace(t, db, "$transaction", async (fn: any) => fn({
      $executeRaw: async () => 0,
      messageDelivery: {
        findMany: async () => [{ id: "synthetic", status: "submitted" }],
        updateMany: async () => { updates++; return { count: 1 }; },
      },
    }));
    const body = { providerMessageId: "synthetic", status: "delivered" }, bytes = Buffer.from(JSON.stringify(body));
    const valid = createHmac("sha256", secret).update(timestamp).update(".").update(bytes).digest("hex");
    assert.equal(await callback({ params: { token: "synthetic" }, get: (key: string) => key === "X-Delivery-Timestamp" ? timestamp : valid, rawBody: bytes, body }, response()), undefined);
    assert.equal(updates, 2);
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});

test("manual notification retry refuses legacy uncertainty and concurrent state changes", async t => {
  const retry = handler(reports, "/jobs/:id/retry", "post");
  const message: any = { id: randomUUID(), status: "failed", template: "general", attempts: 1, error: "Provider transport error" };
  const req = { actor: { school: { id: randomUUID() }, user: { role: "school_admin" } }, params: { id: message.id } };
  replace(t, db.messageDelivery, "findFirst", async () => message);
  let updates = 0;
  replace(t, db.messageDelivery, "updateMany", async () => { updates++; return { count: 0 }; });
  await assert.rejects(retry(req, response()), /not proven safe/);
  assert.equal(updates, 0);
  message.error = "[not submitted] Integration not configured";
  await assert.rejects(retry(req, response()), /state changed/);
  assert.equal(updates, 1);
});

test("bot STK status checks ledger posting rather than trusting provider paid status", async t => {
  const request = { id: randomUUID(), schoolId: randomUUID(), studentId: randomUUID(), phone: "254700000001", checkoutRequestId: null, status: "paid" };
  replace(t, db.stkRequest, "findFirst", async () => request);
  replace(t, db.guardian, "findFirst", async () => ({ id: randomUUID() }));
  replace(t, db.studentGuardian, "findFirst", async () => ({ student: { id: request.studentId } }));
  replace(t, db.financeRecord, "findUnique", async () => null);
  const status = handler(bot, "/bot/v1/payments/:id/status", "get");
  let result: any;
  await status({ actor: { school: { id: request.schoolId } }, params: { id: request.id }, botPhone: request.phone, botGuardianId: randomUUID() }, { json: (value: unknown) => { result = value; } });
  assert.equal(result.status, "processing");
});

test("isolated PostgreSQL: guardian revocation, subject-only rosters, immutable publication, deduplicated fallback", async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development-only rollback fixtures");
  const original = db.$transaction.bind(db), rollback = new Error("rollback nonfinance synthetic fixtures");
  try {
    await original(async tx => {
      (db as any).$transaction = (fn: any) => fn(tx);
      const school = await tx.school.create({ data: { code: `NONFIN-${randomUUID()}`, name: "Snapshot school", type: "primary" } });
      const other = await tx.school.create({ data: { code: `NONFIN-${randomUUID()}`, name: "Other isolated school", type: "primary" } });
      const user = await tx.user.create({ data: { schoolId: school.id, name: "Synthetic admin", email: `${randomUUID()}@example.invalid`, passwordHash: "unusable", role: "school_admin" } });
      const teacher = await tx.user.create({ data: { schoolId: school.id, name: "Subject-only teacher", email: `${randomUUID()}@example.invalid`, passwordHash: "unusable", role: "teacher" } });
      const actor: Actor = { school, user }, teaching = { actor: { school, user: teacher } } as any;
      const year = await tx.academicYear.create({ data: { schoolId: school.id, name: "Synthetic year", startDate: new Date("2030-01-01"), endDate: new Date("2030-12-31") } });
      const term = await tx.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Snapshot term", startDate: new Date("2030-01-01"), endDate: new Date("2030-04-01") } });
      const grade = await tx.grade.create({ data: { schoolId: school.id, name: "Snapshot grade", order: 1, levelBand: "lower_primary" } });
      const stream = await tx.stream.create({ data: { schoolId: school.id, gradeId: grade.id, name: "Subject stream" } });
      const family = await tx.family.create({ data: { schoolId: school.id, name: "Synthetic family" } });
      const student = await tx.student.create({ data: { schoolId: school.id, admissionNo: "SYN-1", firstName: "Snapshot", lastName: "Learner", gradeId: grade.id, streamId: stream.id, familyId: family.id } });
      await tx.student.create({ data: { schoolId: school.id, admissionNo: "SYN-2", firstName: "Sibling", lastName: "Learner", gradeId: grade.id, streamId: stream.id, familyId: family.id } });
      const area = await tx.learningArea.create({ data: { schoolId: school.id, gradeId: grade.id, name: "Snapshot English", code: "ENG" } });
      await tx.subjectAssignment.create({ data: { schoolId: school.id, streamId: stream.id, userId: teacher.id, learningAreaId: area.id, termId: term.id } });
      assert.equal(await tx.student.count({ where: scope(teaching) }), 2);
      assert.equal(await tx.stream.count({ where: streamAccess(teacher.id, school.id) }), 1);
      assert.equal(await tx.stream.count({ where: streamAccess(teacher.id, other.id) }), 0);
      assert.equal(await tx.grade.count({ where: { schoolId: school.id, streams: { some: streamAccess(teacher.id, school.id) } } }), 1);
      assert.equal(studentView(await tx.student.findUniqueOrThrow({ where: { id: student.id }, include: studentInclude }), teaching).siblingCount, 1);
      const guardian = await tx.guardian.create({ data: { schoolId: school.id, name: "Synthetic guardian", phone: "254700000001", whatsappLastInboundAt: new Date() } });
      await tx.studentGuardian.create({ data: { schoolId: school.id, studentId: student.id, guardianId: guardian.id, relationship: "Guardian", receivesNotifications: true } });
      await tx.guardianVerification.create({ data: { schoolId: school.id, guardianId: guardian.id, codeHash: "synthetic", expiresAt: new Date(Date.now() + 60000), verifiedUntil: new Date(Date.now() + 60000) } });
      await queueMessage(tx, school.id, { guardianId: guardian.id, phone: guardian.phone, channel: "sms", template: "otp", content: "synthetic", idempotencyKey: "pending-otp" });
      const patch = handler(guardians, "/guardians/:guardianId", "patch");
      await patch({ actor, params: { guardianId: guardian.id }, body: { name: guardian.name, phone: "0700000001" } }, response());
      assert.equal(await tx.guardianVerification.count({ where: { schoolId: school.id, guardianId: guardian.id } }), 1, "equivalent normalization retains grant");
      await patch({ actor, params: { guardianId: guardian.id }, body: { name: guardian.name, phone: "0700000002" } }, response());
      assert.equal(await tx.guardianVerification.count({ where: { schoolId: school.id, guardianId: guardian.id } }), 0);
      assert.equal((await tx.guardian.findUniqueOrThrow({ where: { id: guardian.id } })).whatsappLastInboundAt, null);
      assert.equal((await tx.messageDelivery.findFirstOrThrow({ where: { schoolId: school.id } })).status, "cancelled");
      const scale = await tx.performanceScale.create({ data: { schoolId: school.id, name: "Synthetic scale" } });
      const level = await tx.performanceLevel.create({ data: { schoolId: school.id, scaleId: scale.id, code: "ME", label: "Meeting", points: 3, minPercent: 0, maxPercent: 100, order: 1 } });
      const assessment = await tx.assessment.create({ data: { schoolId: school.id, termId: term.id, gradeId: grade.id, learningAreaId: area.id, name: "Synthetic assessment", type: "summative", maxMarks: 100, weight: 1, date: new Date("2030-02-01"), status: "locked", createdBy: user.id, scaleSnapshot: [{ id: level.id, code: "ME", minPercent: "0", maxPercent: "100" }] } });
      await tx.assessmentResult.create({ data: { schoolId: school.id, assessmentId: assessment.id, studentId: student.id, cellKey: "assessment", marks: 80, performanceLevelId: level.id, enteredBy: user.id } });
      await tx.learnerRating.create({ data: { schoolId: school.id, studentId: student.id, termId: term.id, category: "competency", code: "communication", performanceLevelId: level.id, enteredBy: user.id } });
      await tx.attendanceRecord.create({ data: { schoolId: school.id, studentId: student.id, streamId: stream.id, date: new Date("2030-02-01"), status: "present", markedBy: user.id } });
      const card = await saveReportCard(actor, { studentId: student.id, termId: term.id, classTeacherComment: "Frozen comment", headTeacherComment: "Frozen head", publish: true });
      const frozen = requirePublicationSnapshot(card.resultSnapshot);
      assert.equal(frozen.ratings[0].level, "ME"); assert.equal(frozen.attendance[0].status, "present");
      await tx.school.update({ where: { id: school.id }, data: { name: "Changed school" } });
      await tx.student.update({ where: { id: student.id }, data: { firstName: "Changed learner" } });
      await tx.attendanceRecord.updateMany({ where: { schoolId: school.id }, data: { status: "absent" } });
      await tx.performanceLevel.update({ where: { id: level.id }, data: { code: "CHANGED" } });
      await assert.rejects(saveReportCard(actor, { studentId: student.id, termId: term.id, classTeacherComment: "Attempt mutation" }), /immutable/);
      await assert.rejects(saveReportCard(actor, { studentId: student.id, termId: term.id, publish: true }), /immutable/);
      await assert.rejects(saveReportCard({ ...actor, school: other }, { studentId: student.id, termId: term.id }), /not found/);
      const rendered = JSON.stringify(reportCardContent(requirePublicationSnapshot((await tx.reportCard.findUniqueOrThrow({ where: { id: card.id } })).resultSnapshot), true));
      assert.match(rendered, /Snapshot school/); assert.match(rendered, /Frozen comment/); assert.match(rendered, /1 attended of 1/);
      assert.doesNotMatch(rendered, /Changed school|Changed learner|CHANGED/);
      const message = await queueMessage(tx, school.id, { guardianId: guardian.id, phone: "254700000002", channel: "whatsapp", template: "general", content: "Synthetic fallback notice", idempotencyKey: "wa-reject" });
      await tx.messageDelivery.update({ where: { id: message.id }, data: { status: "submitted", providerMessageId: "synthetic-provider-id" } });
      await recordDeliveryEvent(tx, school.id, "leadsintel", "synthetic-provider-id", "rejected");
      await recordDeliveryEvent(tx, school.id, "leadsintel", "synthetic-provider-id", "rejected");
      assert.equal(await tx.messageDelivery.count({ where: { schoolId: school.id, idempotencyKey: `sms-fallback:${message.id}` } }), 1);
      await assert.rejects(recordDeliveryEvent(tx, other.id, "leadsintel", "synthetic-provider-id", "delivered"), /identity missing/);
      await recordDeliveryEvent(tx, school.id, "leadsintel", "synthetic-provider-id", "delivered");
      assert.equal((await tx.messageDelivery.findFirstOrThrow({ where: { schoolId: school.id, idempotencyKey: `sms-fallback:${message.id}` } })).status, "cancelled");
      await recordDeliveryEvent(tx, school.id, "leadsintel", "synthetic-provider-id", "rejected");
      assert.equal((await tx.messageDelivery.findUniqueOrThrow({ where: { id: message.id } })).status, "delivered");
      const legacy = await tx.messageDelivery.create({ data: { schoolId: school.id, guardianId: guardian.id, phone: "254700000002", channel: "sms", template: "general", content: "Synthetic legacy uncertainty", idempotencyKey: "legacy-failed", status: "failed", attempts: 1, error: "Provider transport error" } });
      const retained = await queueMessage(tx, school.id, { guardianId: guardian.id, phone: legacy.phone, channel: legacy.channel, template: legacy.template, content: legacy.content, idempotencyKey: legacy.idempotencyKey });
      assert.equal(retained.status, "uncertain");
      await tx.guardianVerification.create({ data: { schoolId: school.id, guardianId: guardian.id, codeHash: "synthetic-again", expiresAt: new Date(Date.now() + 60000), verifiedUntil: new Date(Date.now() + 60000) } });
      const anonymize = handler(guardians, "/guardians/:guardianId/anonymize", "post");
      await anonymize({ actor, params: { guardianId: guardian.id }, body: { confirmation: "ANONYMIZE" } }, response());
      assert.equal(await tx.guardianVerification.count({ where: { schoolId: school.id, guardianId: guardian.id } }), 0);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { (db as any).$transaction = original; await db.$disconnect(); }
});