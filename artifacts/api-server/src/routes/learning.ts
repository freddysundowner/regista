import { Router } from "express";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { allow, body, audit, ApiError, owned } from "../lib/core";
import { financeTransaction, view } from "../lib/finance/posting";
import { academicAdmins, academicReaders, academicOwned, classAccess, subjectAccess } from "../lib/academics/access";
import { saveCurriculum, createAssessment, saveResult, saveRating, saveAttendance, saveReportCard, seedScales } from "../lib/academics/service";
import { reportCardPdf } from "../lib/academics/documents";
import { seedCurriculum } from "../lib/academics/seeds";
import { z } from "zod";

const router = Router();
router.get("/curriculum", async (req, res) => {
  allow(req, academicReaders);
  const schoolId = req.actor.school.id;
  const [learningAreas, strands, scales, levels, gradeScales, assignments] = await Promise.all([
    db.learningArea.findMany({ where: { schoolId } }), db.curriculumStrand.findMany({ where: { schoolId }, orderBy: { order: "asc" } }),
    db.performanceScale.findMany({ where: { schoolId } }), db.performanceLevel.findMany({ where: { schoolId }, orderBy: { order: "asc" } }),
    db.gradeScale.findMany({ where: { schoolId } }), db.subjectAssignment.findMany({ where: { schoolId, ...(["teacher", "class_teacher"].includes(req.actor.user.role) ? { userId: req.actor.user.id } : {}) } }),
  ]);
  res.json(view({ learningAreas, strands, scales: scales.map(s => ({ ...s, levels: levels.filter(l => l.scaleId === s.id) })), gradeScales, assignments }));
});
router.post("/curriculum", async (req, res) => res.json(await saveCurriculum(req.actor, body(schemas.SaveCurriculumBody, req.body))));
router.post("/curriculum/seed", async (req, res) => { allow(req, academicAdmins); res.json(await seedCurriculum(req.actor)); });
router.patch("/curriculum/:kind/:id", async (req, res) => {
  allow(req, academicAdmins);
  if (req.params.kind === "scale") {
    const input = body(schemas.SaveCurriculumBody, { ...req.body, kind: "scale" });
    const prior = await academicOwned(db, "performanceScale", req.actor.school.id, String(req.params.id));
    const created = await saveCurriculum(req.actor, { ...input, name: `${input.name ?? prior.name} [${crypto.randomUUID().slice(0, 8)}]` });
    await financeTransaction(req.actor, async tx => {
      await tx.gradeScale.updateMany({ where: { schoolId: req.actor.school.id, scaleId: prior.id }, data: { scaleId: created.id } });
      await audit(tx, req.actor, "versioned", "performance_scale", prior.id, undefined, { replacementId: created.id });
    });
    res.json(created); return;
  }
  if (req.params.kind === "assignment") {
    const input = body(z.object({ userId: z.string().uuid(), streamId: z.string().uuid(), learningAreaId: z.string().uuid(), termId: z.string().uuid() }).strict(), req.body);
    const prior = await db.subjectAssignment.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id } });
    if (!prior) throw new ApiError(404, "Assignment not found");
    const replacement = await saveCurriculum(req.actor, { kind: "assignment", ...input });
    if (replacement.id !== prior.id) await db.subjectAssignment.delete({ where: { id: prior.id } });
    res.json(replacement); return;
  }
  const input = body(z.object({ name: z.string().trim().min(1).optional(), code: z.string().trim().min(1).optional(), order: z.number().int().min(0).optional(), isCore: z.boolean().optional(), pathway: z.string().nullable().optional() }).strict(), req.body);
  const model = req.params.kind === "learning-area" ? "learningArea" : req.params.kind === "strand" ? "curriculumStrand" : undefined;
  if (!model) throw new ApiError(400, "Editable kinds: learning-area, strand; create new scales and reassign for future terms");
  res.json(view(await financeTransaction(req.actor, async tx => {
    const prior = await academicOwned(tx, model, req.actor.school.id, String(req.params.id));
    const data = model === "learningArea" ? { name: input.name, code: input.code, isCore: input.isCore, pathway: input.pathway } : { name: input.name, order: input.order };
    const result = await (tx[model] as any).update({ where: { id: prior.id }, data });
    await audit(tx, req.actor, "updated", model, prior.id, prior, result);
    return { id: result.id, status: "saved" };
  })));
});
router.post("/report-cards/batch/pdf", async (req, res) => {
  allow(req, academicReaders);
  const input = body(z.object({ termId: z.string().uuid(), studentIds: z.array(z.string().uuid()).min(1).max(100) }).strict(), req.body);
  const cards = await db.reportCard.findMany({ where: { schoolId: req.actor.school.id, termId: input.termId, studentId: { in: input.studentIds } } });
  if (cards.length !== new Set(input.studentIds).size) throw new ApiError(409, "Every learner must have a report card before batch generation");
  for (const card of cards) {
    const student = await owned(db, "student", card.studentId, req.actor.school.id);
    if (["teacher", "class_teacher"].includes(req.actor.user.role)) await classAccess(db, req.actor, student.streamId!);
  }
  const documents = [];
  for (const card of cards) documents.push({ studentId: card.studentId, ...await reportCardPdf(req.actor, card.id) });
  res.json(documents);
});
router.get("/assessments", async (req, res) => {
  allow(req, academicReaders);
  const schoolId = req.actor.school.id;
  let rows = await db.assessment.findMany({ where: { schoolId, ...(typeof req.query.termId === "string" ? { termId: req.query.termId } : {}), ...(typeof req.query.gradeId === "string" ? { gradeId: req.query.gradeId } : {}) }, orderBy: { date: "desc" } });
  if (["teacher", "class_teacher"].includes(req.actor.user.role)) {
    const assignments = await db.subjectAssignment.findMany({ where: { schoolId, userId: req.actor.user.id } });
    rows = rows.filter(a => assignments.some(s => s.learningAreaId === a.learningAreaId && s.termId === a.termId));
  }
  res.json(view(rows));
});
router.post("/assessments", async (req, res) => res.json(view(await createAssessment(req.actor, body(schemas.CreateAssessmentBody, req.body)))));
router.get("/assessments/:id/results", async (req, res) => {
  const assessment = await academicOwned(db, "assessment", req.actor.school.id, String(req.params.id));
  await subjectAccess(db, req.actor, assessment.learningAreaId, assessment.termId);
  let studentIds: string[] | undefined;
  if (["teacher", "class_teacher"].includes(req.actor.user.role)) {
    const assignments = await db.subjectAssignment.findMany({ where: { schoolId: req.actor.school.id, userId: req.actor.user.id, learningAreaId: assessment.learningAreaId, termId: assessment.termId } });
    studentIds = (await db.student.findMany({ where: { schoolId: req.actor.school.id, streamId: { in: assignments.map(a => a.streamId) } }, select: { id: true } })).map(s => s.id);
  }
  res.json(view(await db.assessmentResult.findMany({ where: { schoolId: req.actor.school.id, assessmentId: assessment.id, ...(studentIds ? { studentId: { in: studentIds } } : {}) } })));
});
router.put("/assessments/:id/results", async (req, res) => res.json(view(await saveResult(req.actor, String(req.params.id), body(schemas.SaveAssessmentResultBody, req.body)))));
router.post("/assessments/:id/lock", async (req, res) => {
  const input = body(schemas.SetAssessmentLockBody, req.body);
  if (!input.reason.trim()) throw new ApiError(400, "A reason is required");
  const result = await financeTransaction(req.actor, async tx => {
    const assessment = await academicOwned(tx, "assessment", req.actor.school.id, String(req.params.id));
    if (!input.locked) allow(req, academicAdmins);
    else if (!academicAdmins.includes(req.actor.user.role)) {
      const stream = await tx.stream.findFirst({ where: { schoolId: req.actor.school.id, gradeId: assessment.gradeId, classTeacherUserId: req.actor.user.id } });
      if (!stream) throw new ApiError(403, "Only class teacher/admin may lock an assessment");
    }
    const updated = await tx.assessment.update({ where: { id: assessment.id }, data: { status: input.locked ? "locked" : "open" } });
    await audit(tx, req.actor, input.locked ? "locked" : "unlocked", "assessment", assessment.id, undefined, { reason: input.reason });
    return updated;
  });
  res.json(view(result));
});
router.post("/academics/ratings", async (req, res) => res.json(await saveRating(req.actor, body(schemas.SaveLearnerRatingBody, req.body))));
router.get("/academics/ratings", async (req, res) => {
  allow(req, academicReaders);
  const { studentId, termId } = body(z.object({ studentId: z.string().uuid(), termId: z.string().uuid() }), req.query);
  const student = await owned(db, "student", studentId, req.actor.school.id);
  if (!student.streamId) throw new ApiError(404, "Student has no class");
  await classAccess(db, req.actor, student.streamId);
  res.json(view(await db.learnerRating.findMany({ where: { schoolId: req.actor.school.id, studentId, termId } })));
});
router.get("/report-cards", async (req, res) => {
  allow(req, academicReaders);
  const schoolId = req.actor.school.id;
  let studentIds: string[] | undefined;
  if (["teacher", "class_teacher"].includes(req.actor.user.role)) {
    const streams = await db.stream.findMany({ where: { schoolId, classTeacherUserId: req.actor.user.id } });
    studentIds = (await db.student.findMany({ where: { schoolId, streamId: { in: streams.map(s => s.id) } }, select: { id: true } })).map(s => s.id);
  }
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
  if (studentId && studentIds && !studentIds.includes(studentId)) throw new ApiError(404, "Student not found");
  res.json(view(await db.reportCard.findMany({ where: { schoolId, ...(studentId ? { studentId } : studentIds ? { studentId: { in: studentIds } } : {}), ...(typeof req.query.termId === "string" ? { termId: req.query.termId } : {}) } })));
});
router.post("/report-cards", async (req, res) => res.json(view(await saveReportCard(req.actor, body(schemas.SaveReportCardBody, req.body)))));
router.post("/report-cards/:id/pdf", async (req, res) => { allow(req, academicReaders); res.json(await reportCardPdf(req.actor, String(req.params.id))); });
router.post("/report-cards/:id/send", async (req, res) => {
  allow(req, academicReaders);
  const card = await academicOwned(db, "reportCard", req.actor.school.id, String(req.params.id));
  if (card.status !== "published") throw new ApiError(409, "Publish report card before sending");
  const student = await owned(db, "student", card.studentId, req.actor.school.id);
  if (["teacher", "class_teacher"].includes(req.actor.user.role)) await classAccess(db, req.actor, student.streamId!);
  const guardian = await db.studentGuardian.findFirst({ where: { schoolId: req.actor.school.id, studentId: student.id, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
  if (!guardian) throw new ApiError(409, "Primary guardian notification recipient unavailable");
  const { queueMessage, messageReadiness } = await import("../lib/integrations/messages");
  await messageReadiness(req.actor.school.id, "whatsapp", "report_card_ready", guardian.guardianId);
  const message = await queueMessage(db, req.actor.school.id, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template: "report_card_ready", content: `${student.firstName}'s report card is available. Verify your identity to access results.`, idempotencyKey: `report-card:${card.id}` });
  if (message.status === "failed") await db.messageDelivery.update({ where: { id: message.id }, data: { status: "queued", attempts: 0, error: null } });
  res.json({ id: message.id, status: message.status === "failed" ? "queued" : message.status, message: "Notification queued/submitted status is not proof of delivery" });
});
router.get("/attendance", async (req, res) => {
  allow(req, academicReaders);
  const schoolId = req.actor.school.id, streamId = typeof req.query.streamId === "string" ? req.query.streamId : undefined, studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
  if (studentId) {
    const student = await owned(db, "student", studentId, schoolId);
    if (!student.streamId) throw new ApiError(404, "Student has no stream");
    await classAccess(db, req.actor, student.streamId);
  } else if (streamId) await classAccess(db, req.actor, streamId);
  else if (!academicAdmins.includes(req.actor.user.role) && req.actor.user.role !== "principal") throw new ApiError(400, "Specify an assigned stream or student");
  const date = typeof req.query.date === "string" ? new Date(req.query.date) : undefined;
  if (date && !Number.isFinite(date.getTime())) throw new ApiError(400, "Invalid date");
  res.json(view(await db.attendanceRecord.findMany({ where: { schoolId, streamId, studentId, date }, orderBy: { date: "desc" }, take: 5000 })));
});
router.put("/attendance", async (req, res) => res.json(view(await saveAttendance(req.actor, body(schemas.SaveAttendanceRegisterBody, req.body)))));
export default router;