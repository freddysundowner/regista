import { db, Prisma } from "@workspace/db";
import type { CurriculumInput, AssessmentInput, ResultInput, AttendanceInput, ReportCardInput, RatingInput } from "@workspace/api-zod";
import { ApiError, audit, owned, type Actor, type Tx } from "../core";
import { financeTransaction, json } from "../finance/posting";
import { money, sum, zero } from "../finance/money";
import { academicAdmins, academicOwned, classAccess, subjectAccess } from "./access";
import { queueMessage } from "../integrations/messages";

function requireFields(input: Record<string, any>, fields: string[]) {
  for (const field of fields) if (input[field] === undefined || input[field] === "") throw new ApiError(400, `${field} is required`);
}
export async function saveCurriculum(actor: Actor, input: CurriculumInput) {
  if (!academicAdmins.includes(actor.user.role)) throw new ApiError(403, "Only administrators configure curriculum");
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id; let result: { id: string };
    if (input.kind === "learning_area") {
      requireFields(input, ["gradeId", "name", "code"]);
      await owned(tx, "grade", input.gradeId!, schoolId);
      result = await tx.learningArea.create({ data: { schoolId, gradeId: input.gradeId!, name: input.name!, code: input.code! } });
    } else if (["strand", "sub_strand"].includes(input.kind)) {
      requireFields(input, ["learningAreaId", "name", "order"]);
      await academicOwned(tx, "learningArea", schoolId, input.learningAreaId!);
      if (input.kind === "sub_strand") {
        requireFields(input, ["parentId"]);
        const parent = await academicOwned(tx, "curriculumStrand", schoolId, input.parentId!);
        if (parent.parentId || parent.learningAreaId !== input.learningAreaId) throw new ApiError(400, "Sub-strand parent must be a top-level strand of this learning area");
      }
      result = await tx.curriculumStrand.create({ data: { schoolId, learningAreaId: input.learningAreaId!, name: input.name!, order: input.order!, parentId: input.kind === "sub_strand" ? input.parentId : null } });
    } else if (input.kind === "scale") {
      requireFields(input, ["name", "levels"]);
      if (![4, 8].includes(input.levels!.length)) throw new ApiError(400, "Provide four or eight performance levels");
      const ordered = [...input.levels!].sort((a, b) => money(a.minPercent).comparedTo(money(b.minPercent)));
      if (!money(ordered[0].minPercent).equals(0) || !money(ordered.at(-1)!.maxPercent).equals(100)) throw new ApiError(400, "Scale bands must cover 0–100");
      for (let i = 0; i < ordered.length; i++) if (!money(ordered[i].maxPercent).gt(money(ordered[i].minPercent)) || (i && !money(ordered[i].minPercent).equals(money(ordered[i - 1].maxPercent)))) throw new ApiError(400, "Scale bands must be contiguous and non-overlapping");
      if (new Set(ordered.map(l => l.code)).size !== ordered.length) throw new ApiError(400, "Duplicate performance code");
      result = await tx.performanceScale.create({ data: { schoolId, name: input.name! } });
      await tx.performanceLevel.createMany({ data: ordered.map(l => ({ ...l, schoolId, scaleId: result.id, points: money(l.points), minPercent: money(l.minPercent), maxPercent: money(l.maxPercent) })) });
    } else if (input.kind === "grade_scale") {
      requireFields(input, ["gradeId", "scaleId"]);
      await owned(tx, "grade", input.gradeId!, schoolId); await academicOwned(tx, "performanceScale", schoolId, input.scaleId!);
      result = await tx.gradeScale.upsert({ where: { gradeId: input.gradeId! }, create: { schoolId, gradeId: input.gradeId!, scaleId: input.scaleId! }, update: { scaleId: input.scaleId! } });
    } else {
      requireFields(input, ["userId", "streamId", "learningAreaId", "termId"]);
      const user = await owned(tx, "user", input.userId!, schoolId), stream = await owned(tx, "stream", input.streamId!, schoolId);
      const area = await academicOwned(tx, "learningArea", schoolId, input.learningAreaId!);
      await owned(tx, "term", input.termId!, schoolId);
      if (!["teacher", "class_teacher"].includes(user.role) || !user.isActive || stream.gradeId !== area.gradeId) throw new ApiError(400, "Assignment requires an active teacher and matching grade");
      const key = { schoolId, userId: input.userId!, streamId: input.streamId!, learningAreaId: input.learningAreaId!, termId: input.termId! };
      result = await tx.subjectAssignment.upsert({ where: { schoolId_userId_streamId_learningAreaId_termId: key }, create: key, update: {} });
    }
    await audit(tx, actor, "created", input.kind, result.id, undefined, input);
    return { id: result.id, status: "saved" };
  });
}
export async function createAssessment(actor: Actor, input: AssessmentInput) {
  return financeTransaction(actor, async tx => {
    await owned(tx, "term", input.termId, actor.school.id);
    const area = await academicOwned(tx, "learningArea", actor.school.id, input.learningAreaId);
    if (area.gradeId !== input.gradeId) throw new ApiError(400, "Learning area grade mismatch");
    await subjectAccess(tx, actor, input.learningAreaId, input.termId, undefined, true);
    if (!money(input.weight).gt(0) || (input.maxMarks !== undefined && !money(input.maxMarks).gt(0))) throw new ApiError(400, "Weight and maximum marks must be positive");
    if (input.type === "summative" && input.maxMarks === undefined) throw new ApiError(400, "Summative assessment requires maximum marks");
    const prior = await tx.assessment.findFirst({ where: { schoolId: actor.school.id, termId: input.termId, learningAreaId: input.learningAreaId }, orderBy: { createdAt: "asc" } });
    const scaleSnapshot = prior?.scaleSnapshot ?? json(await gradeLevels(tx, actor.school.id, input.gradeId));
    const grade = await owned(tx, "grade", input.gradeId, actor.school.id);
    const result = await tx.assessment.create({ data: { ...input, scaleSnapshot, placementSnapshot: { gradeName: grade.name, learningAreaName: area.name }, schoolId: actor.school.id, createdBy: actor.user.id, maxMarks: input.maxMarks ? money(input.maxMarks) : null, weight: money(input.weight) } });
    await audit(tx, actor, "created", "assessment", result.id, undefined, input);
    return result;
  });
}
export async function gradeLevels(tx: Tx, schoolId: string, gradeId: string) {
  const mapping = await tx.gradeScale.findFirst({ where: { schoolId, gradeId } });
  if (!mapping) throw new ApiError(409, "Assign a performance scale to this grade before entering results");
  return tx.performanceLevel.findMany({ where: { schoolId, scaleId: mapping.scaleId }, orderBy: { minPercent: "asc" } });
}
export function levelForPercent<T extends { minPercent: Prisma.Decimal; maxPercent: Prisma.Decimal }>(levels: T[], percent: Prisma.Decimal) {
  const level = levels.find(l => percent.gte(l.minPercent) && (l.maxPercent.equals(100) ? percent.lte(l.maxPercent) : percent.lt(l.maxPercent)));
  if (!level) throw new ApiError(400, "No performance level covers this percentage");
  return level;
}
export function snapshotLevels(snapshot: unknown): { id: string; code: string; minPercent: Prisma.Decimal; maxPercent: Prisma.Decimal }[] {
  if (!Array.isArray(snapshot) || !snapshot.length) throw new ApiError(409, "Historical assessment scale is unavailable; administrator review required");
  return snapshot.map(l => ({ id: l.id, code: l.code, minPercent: money(String(l.minPercent)), maxPercent: money(String(l.maxPercent)) }));
}
export async function saveResult(actor: Actor, assessmentId: string, input: ResultInput) {
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id, assessment = await academicOwned(tx, "assessment", schoolId, assessmentId);
    await subjectAccess(tx, actor, assessment.learningAreaId, assessment.termId, input.studentId, true);
    if (assessment.status === "locked") throw new ApiError(409, "Assessment is locked; administrator unlock with reason required");
    const student = await owned(tx, "student", input.studentId, schoolId);
    if (student.gradeId !== assessment.gradeId) throw new ApiError(400, "Student grade mismatch");
    if (input.subStrandId) {
      const strand = await academicOwned(tx, "curriculumStrand", schoolId, input.subStrandId);
      if (!strand.parentId || strand.learningAreaId !== assessment.learningAreaId) throw new ApiError(400, "Result sub-strand must belong to assessment learning area");
    }
    const levels = snapshotLevels(assessment.scaleSnapshot);
    let selected = input.performanceLevelId ? levels.find(l => l.id === input.performanceLevelId) : undefined;
    if (input.performanceLevelId && !selected) throw new ApiError(400, "Performance level does not belong to grade scale");
    let marks: Prisma.Decimal | null = null;
    let actualOverride = false;
    if (assessment.maxMarks !== null) {
      if (input.marks === undefined) throw new ApiError(400, "Marks required for this assessment");
      marks = money(input.marks);
      if (marks.lt(0) || marks.gt(assessment.maxMarks)) throw new ApiError(400, "Marks exceed assessment range");
      const computed = levelForPercent(levels, marks.times(100).div(assessment.maxMarks));
      actualOverride = !!selected && selected.id !== computed.id;
      if (selected && selected.id !== computed.id && !input.overrideReason?.trim()) throw new ApiError(400, "Performance override requires a reason");
      selected ??= computed;
    } else {
      if (!selected) throw new ApiError(400, "Rubric assessment requires a performance level");
      if (input.marks !== undefined) throw new ApiError(400, "Rubric assessment does not accept marks");
    }
    const key = { assessmentId, studentId: input.studentId, cellKey: input.subStrandId ?? "assessment" };
    const prior = await tx.assessmentResult.findUnique({ where: { assessmentId_studentId_cellKey: key } });
    if ((prior?.revision ?? 0) !== input.expectedRevision) throw new ApiError(409, "Result changed elsewhere; reload before saving");
    const data = { marks, subStrandId: input.subStrandId, performanceLevelId: selected.id, overrideReason: actualOverride ? input.overrideReason : null, comment: input.comment, enteredBy: actor.user.id };
    const result = await tx.assessmentResult.upsert({ where: { assessmentId_studentId_cellKey: key }, create: { ...key, schoolId, ...data }, update: { ...data, revision: { increment: 1 } } });
    await audit(tx, actor, prior ? "updated" : "created", "assessment_result", result.id, prior ? json(prior) : undefined, json(result));
    return result;
  });
}
export async function termResults(tx: Tx, schoolId: string, studentId: string, termId: string) {
  const student = await owned(tx, "student", studentId, schoolId);
  await owned(tx, "term", termId, schoolId);
  const recorded = await tx.assessmentResult.findMany({ where: { schoolId, studentId }, select: { assessmentId: true } });
  const historical = await tx.assessment.findMany({ where: { schoolId, termId, id: { in: recorded.map(r => r.assessmentId) } } });
  const areas = await tx.learningArea.findMany({ where: { schoolId, gradeId: { in: historical.length ? [...new Set(historical.map(a => a.gradeId))] : [student.gradeId ?? "00000000-0000-0000-0000-000000000000"] } } });
  const output = [];
  for (const area of areas) {
    const assessments = historical.filter(a => a.learningAreaId === area.id).sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
    let weighted = zero(), weights = zero();
    let finalLevels: ReturnType<typeof snapshotLevels> = [];
    for (const assessment of assessments) {
      const levels = snapshotLevels(assessment.scaleSnapshot);
      if (finalLevels.length && JSON.stringify(finalLevels.map(l => [l.code, l.minPercent.toString(), l.maxPercent.toString()])) !== JSON.stringify(levels.map(l => [l.code, l.minPercent.toString(), l.maxPercent.toString()]))) throw new ApiError(409, "Mixed performance scales within a term learning area require review");
      finalLevels = levels;
      const results = await tx.assessmentResult.findMany({ where: { schoolId, studentId, assessmentId: assessment.id } });
      if (!results.length) continue;
      const percentages = results.map(result => {
        const level = levels.find(l => l.id === result.performanceLevelId);
        if (!level) throw new ApiError(409, "Historical result scale differs from current grade scale; review the scale assignment");
        // Explicit overrides and rubric levels use the selected band's midpoint.
        return result.marks !== null && assessment.maxMarks && !result.overrideReason ? result.marks.times(100).div(assessment.maxMarks) : level.minPercent.plus(level.maxPercent).div(2);
      });
      const mean = sum(percentages).div(percentages.length);
      weighted = weighted.plus(mean.times(assessment.weight)); weights = weights.plus(assessment.weight);
    }
    if (!weights.gt(0)) { output.push({ learningAreaId: area.id, learningArea: area.name, percent: null, level: null }); continue; }
    const percent = weighted.div(weights), level = levelForPercent(finalLevels, percent);
    output.push({ learningAreaId: area.id, learningArea: String((assessments[0].placementSnapshot as Record<string, unknown>)?.learningAreaName ?? area.name), percent: percent.toFixed(2), level: level.code });
  }
  return output;
}
const competencies = ["communication", "critical_thinking", "creativity", "citizenship", "digital_literacy", "learning_to_learn", "self_efficacy"];
const values = ["love", "responsibility", "respect", "unity", "peace", "patriotism", "social_justice", "integrity"];
export async function saveRating(actor: Actor, input: RatingInput) {
  return financeTransaction(actor, async tx => {
    const student = await owned(tx, "student", input.studentId, actor.school.id);
    await owned(tx, "term", input.termId, actor.school.id);
    if (!student.streamId) throw new ApiError(409, "Student has no stream");
    await classAccess(tx, actor, student.streamId, true);
    if (!(input.category === "competency" ? competencies : values).includes(input.code)) throw new ApiError(400, "Unknown competency/value code");
    const levels = await gradeLevels(tx, actor.school.id, student.gradeId);
    if (!levels.some(l => l.id === input.performanceLevelId)) throw new ApiError(400, "Level does not belong to grade scale");
    const key = { schoolId: actor.school.id, studentId: input.studentId, termId: input.termId, category: input.category, code: input.code };
    const result = await tx.learnerRating.upsert({ where: { schoolId_studentId_termId_category_code: key }, create: { ...key, performanceLevelId: input.performanceLevelId, enteredBy: actor.user.id }, update: { performanceLevelId: input.performanceLevelId, enteredBy: actor.user.id } });
    await audit(tx, actor, "saved", "learner_rating", result.id, undefined, input);
    return { id: result.id, status: "saved" };
  });
}
export async function saveAttendance(actor: Actor, input: AttendanceInput) {
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id;
    await classAccess(tx, actor, input.streamId, true);
    if (new Set(input.entries.map(e => e.studentId)).size !== input.entries.length) throw new ApiError(400, "Duplicate learner in register");
    const rows = [];
    for (const entry of input.entries) {
      const student = await owned(tx, "student", entry.studentId, schoolId);
      if (student.streamId !== input.streamId || student.status !== "active") throw new ApiError(400, "Learner is not active in this stream");
      const prior = await tx.attendanceRecord.findUnique({ where: { studentId_date: { studentId: entry.studentId, date: input.date } } });
      const result = await tx.attendanceRecord.upsert({ where: { studentId_date: { studentId: entry.studentId, date: input.date } }, create: { schoolId, studentId: entry.studentId, streamId: input.streamId, date: input.date, status: entry.status, markedBy: actor.user.id }, update: { status: entry.status, markedBy: actor.user.id } });
      rows.push(result);
      if (entry.status === "absent" && prior?.status !== "absent" && (actor.school.settings as Record<string, any>).absenceAlertsEnabled) {
        const guardian = await tx.studentGuardian.findFirst({ where: { schoolId, studentId: entry.studentId, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
        if (guardian) {
          const time = (actor.school.settings as Record<string, any>).absenceAlertTime ?? "10:00";
          if (!/^\d{2}:\d{2}$/.test(time)) throw new ApiError(400, "Absence alert time must be HH:mm");
          await queueMessage(tx, schoolId, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template: "absence_alert", content: `${student.firstName} was marked absent on ${new Date(input.date).toISOString().slice(0, 10)}`, idempotencyKey: `absence:${result.id}`, scheduledAt: new Date(`${new Date(input.date).toISOString().slice(0, 10)}T${time}:00+03:00`) });
        }
      }
      await audit(tx, actor, prior ? "updated" : "created", "attendance", result.id, prior, result);
    }
    return rows;
  });
}
export async function saveReportCard(actor: Actor, input: ReportCardInput) {
  return financeTransaction(actor, async tx => {
    const schoolId = actor.school.id, student = await owned(tx, "student", input.studentId, schoolId);
    await owned(tx, "term", input.termId, schoolId);
    if (input.headTeacherComment !== undefined && ![...academicAdmins, "principal"].includes(actor.user.role)) throw new ApiError(403, "Only principal/admin may enter head teacher remarks");
    if (input.classTeacherComment !== undefined || (!input.publish && input.headTeacherComment === undefined)) {
      if (!student.streamId) throw new ApiError(409, "Student has no stream");
      await classAccess(tx, actor, student.streamId, true);
    }
    if (input.publish && ![...academicAdmins, "principal"].includes(actor.user.role)) throw new ApiError(403, "Only principal/admin may publish report cards");
    if (input.publish) {
      const results = await termResults(tx, schoolId, student.id, input.termId);
      if (!results.some(r => r.level)) throw new ApiError(409, "No term results to publish");
      const assessments = await tx.assessment.findMany({ where: { schoolId, termId: input.termId, gradeId: student.gradeId!, status: { not: "locked" } } });
      if (assessments.length) throw new ApiError(409, "Lock assessments before publishing report cards");
    }
    const previous = await tx.reportCard.findUnique({ where: { schoolId_studentId_termId: { schoolId, studentId: student.id, termId: input.termId } } });
    const data = { classTeacherComment: input.classTeacherComment, headTeacherComment: input.headTeacherComment, nextTermOpeningDate: input.nextTermOpeningDate, ...(input.publish ? { status: "published", publishedAt: new Date(), resultSnapshot: previous?.resultSnapshot ?? json(await termResults(tx, schoolId, student.id, input.termId)) } : {}) };
    const card = await tx.reportCard.upsert({ where: { schoolId_studentId_termId: { schoolId, studentId: input.studentId, termId: input.termId } }, create: { schoolId, studentId: input.studentId, termId: input.termId, ...data }, update: data });
    if (input.publish) {
      const guardian = await tx.studentGuardian.findFirst({ where: { schoolId, studentId: student.id, isPrimary: true, receivesNotifications: true }, include: { guardian: true } });
      if (guardian) await queueMessage(tx, schoolId, { guardianId: guardian.guardianId, phone: guardian.guardian.phone, channel: "whatsapp", template: "report_card_ready", content: `${student.firstName}'s report card is available. Verify your identity to access results.`, idempotencyKey: `report-card:${card.id}` });
    }
    await audit(tx, actor, input.publish ? "published" : "saved", "report_card", card.id, undefined, input);
    return card;
  });
}
export async function seedScales(actor: Actor) {
  const existing = await db.performanceScale.findMany({ where: { schoolId: actor.school.id } });
  for (const count of [4, 8]) {
    const name = `${count}-level school rubric (editable bands)`;
    if (existing.some(s => s.name === name)) continue;
    const codes = count === 4 ? ["BE", "AE", "ME", "EE"] : ["BE2", "BE1", "AE2", "AE1", "ME2", "ME1", "EE2", "EE1"];
    const boundaries = count === 4 ? ["0", "30", "50", "80", "100"] : ["0", "15", "30", "40", "50", "65", "80", "90", "100"];
    await saveCurriculum(actor, { kind: "scale", name, levels: codes.map((code, i) => ({ code, label: code, order: i + 1, points: String(i + 1), minPercent: boundaries[i], maxPercent: boundaries[i + 1] })) });
  }
  return { status: "seeded", message: "Editable school rubric defaults, not a claim of current official KNEC bands" };
}