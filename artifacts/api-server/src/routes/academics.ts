import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, admin, send, body, parse, audit, lock, owned, ApiError, teacher, streamAccess, type Tx, type Actor } from "../lib/core";
const router = Router();
const yearView = (record: any) => record;
const termView = (record: any) => ({ ...record, academicYearName: record.academicYear.name });
const gradeView = (record: any) => ({ ...record, studentCount: record._count.students });
const streamView = (record: any) => ({ ...record, gradeName: record.grade.name, classTeacherName: record.classTeacher?.name ?? null, studentCount: record._count.students });
const termInclude = { academicYear: true } as const;
const gradeInclude = { _count: { select: { students: true } } } as const;
const streamInclude = { grade: true, classTeacher: true, _count: { select: { students: true } } } as const;
function range(start: Date, end: Date) {
  if (start > end) throw new ApiError(400, "Start date must be on or before end date");
}
async function checkTerm(tx: Tx, data: any, schoolId: string) {
  range(data.startDate, data.endDate);
  const year = await owned(tx, "academicYear", data.academicYearId, schoolId);
  if (data.startDate < year.startDate || data.endDate > year.endDate) throw new ApiError(400, "Term dates must be within its academic year");
}
async function clearCurrent(tx: Tx, actor: Actor, model: "academicYear" | "term") {
  const records = model === "academicYear"
    ? await tx.academicYear.findMany({ where: { schoolId: actor.school.id, isCurrent: true } })
    : await tx.term.findMany({ where: { schoolId: actor.school.id, isCurrent: true } });
  if (model === "academicYear") await tx.academicYear.updateMany({ where: { schoolId: actor.school.id, isCurrent: true }, data: { isCurrent: false } });
  else await tx.term.updateMany({ where: { schoolId: actor.school.id, isCurrent: true }, data: { isCurrent: false } });
  for (const record of records) await audit(tx, actor, "current_cleared", model === "academicYear" ? "academic_year" : "term", record.id, { isCurrent: true }, { isCurrent: false });
}
router.get("/academic-years", async (req, res) => {
  send(res, "ListAcademicYears", await db.academicYear.findMany({ where: { schoolId: req.actor.school.id }, orderBy: { startDate: "desc" }, take: 1000 }));
});
router.post("/academic-years", async (req, res) => {
  allow(req, admin); const data = body(z.CreateAcademicYearBody, req.body);
  range(data.startDate, data.endDate);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    if (data.isCurrent) await clearCurrent(tx, req.actor, "academicYear");
    const record = await tx.academicYear.create({ data: { ...data, schoolId: req.actor.school.id } });
    await audit(tx, req.actor, "created", "academic_year", record.id); return record;
  });
  send(res, "CreateAcademicYear", yearView(record), 201);
});
router.patch("/academic-years/:yearId", async (req, res) => {
  allow(req, admin); const { yearId } = parse(z.UpdateAcademicYearParams, req.params); const data = body(z.UpdateAcademicYearBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const old = await owned(tx, "academicYear", yearId, req.actor.school.id); const effective = { ...old, ...data };
    range(effective.startDate, effective.endDate);
    if (await tx.term.count({ where: { schoolId: req.actor.school.id, academicYearId: yearId, OR: [{ startDate: { lt: effective.startDate } }, { endDate: { gt: effective.endDate } }] } })) throw new ApiError(400, "Existing terms must remain within the year");
    if (data.isCurrent) await clearCurrent(tx, req.actor, "academicYear");
    const record = await tx.academicYear.update({ where: { id: yearId }, data }); await audit(tx, req.actor, "updated", "academic_year", yearId); return record;
  });
  send(res, "UpdateAcademicYear", record);
});
router.get("/terms", async (req, res) => {
  const query = parse(z.ListTermsQueryParams, req.query);
  if (query.academicYearId) await owned(db, "academicYear", query.academicYearId, req.actor.school.id);
  send(res, "ListTerms", (await db.term.findMany({ where: { schoolId: req.actor.school.id, ...query }, include: termInclude, orderBy: { startDate: "desc" }, take: 1000 })).map(termView));
});
router.post("/terms", async (req, res) => {
  allow(req, admin); const data = body(z.CreateTermBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); await checkTerm(tx, data, req.actor.school.id);
    if (data.isCurrent) await clearCurrent(tx, req.actor, "term");
    const record = await tx.term.create({ data: { ...data, schoolId: req.actor.school.id }, include: termInclude });
    await audit(tx, req.actor, "created", "term", record.id); return record;
  });
  send(res, "CreateTerm", termView(record), 201);
});
router.patch("/terms/:termId", async (req, res) => {
  allow(req, admin); const { termId } = parse(z.UpdateTermParams, req.params); const data = body(z.UpdateTermBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); const old = await owned(tx, "term", termId, req.actor.school.id);
    await checkTerm(tx, { ...old, ...data }, req.actor.school.id);
    if (data.isCurrent) await clearCurrent(tx, req.actor, "term");
    const record = await tx.term.update({ where: { id: termId }, data, include: termInclude });
    await audit(tx, req.actor, "updated", "term", termId); return record;
  });
  send(res, "UpdateTerm", termView(record));
});
router.get("/grades", async (req, res) => {
  const scope: Prisma.StudentWhereInput = teacher(req) ? { stream: streamAccess(req.actor.user.id) } : {};
  const where: Prisma.GradeWhereInput = { schoolId: req.actor.school.id, ...(teacher(req) ? { streams: { some: streamAccess(req.actor.user.id) } } : {}) };
  const records = await db.grade.findMany({ where, include: { _count: { select: { students: { where: scope } } } }, orderBy: { order: "asc" }, take: 1000 });
  send(res, "ListGrades", records.map(gradeView));
});
router.post("/grades", async (req, res) => {
  allow(req, admin); const data = body(z.CreateGradeBody, req.body);
  const record = await db.$transaction(async tx => {
    const record = await tx.grade.create({ data: { ...data, schoolId: req.actor.school.id }, include: gradeInclude });
    await audit(tx, req.actor, "created", "grade", record.id); return record;
  });
  send(res, "CreateGrade", gradeView(record), 201);
});
router.patch("/grades/:gradeId", async (req, res) => {
  allow(req, admin); const { gradeId } = parse(z.UpdateGradeParams, req.params); const data = body(z.UpdateGradeBody, req.body);
  const record = await db.$transaction(async tx => {
    await owned(tx, "grade", gradeId, req.actor.school.id);
    const record = await tx.grade.update({ where: { id: gradeId }, data, include: gradeInclude });
    await audit(tx, req.actor, "updated", "grade", gradeId); return record;
  });
  send(res, "UpdateGrade", gradeView(record));
});
router.get("/streams", async (req, res) => {
  const query = parse(z.ListStreamsQueryParams, req.query);
  if (query.gradeId) await owned(db, "grade", query.gradeId, req.actor.school.id);
  send(res, "ListStreams", (await db.stream.findMany({ where: { schoolId: req.actor.school.id, ...query, ...(teacher(req) ? streamAccess(req.actor.user.id) : {}) }, include: streamInclude, orderBy: { name: "asc" }, take: 1000 })).map(streamView));
});
async function checkStream(tx: Tx, data: any, schoolId: string) {
  await owned(tx, "grade", data.gradeId, schoolId);
  if (data.classTeacherUserId) {
    const user = await owned(tx, "user", data.classTeacherUserId, schoolId);
    if (!user.isActive || !["teacher", "class_teacher"].includes(user.role)) throw new ApiError(400, "Class teacher must be an active teacher in this school");
  }
}
router.post("/streams", async (req, res) => {
  allow(req, admin); const data = body(z.CreateStreamBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); await checkStream(tx, data, req.actor.school.id);
    const record = await tx.stream.create({ data: { ...data, schoolId: req.actor.school.id }, include: streamInclude });
    await audit(tx, req.actor, "created", "stream", record.id); return record;
  });
  send(res, "CreateStream", streamView(record), 201);
});
router.patch("/streams/:streamId", async (req, res) => {
  allow(req, admin); const { streamId } = parse(z.UpdateStreamParams, req.params); const data = body(z.UpdateStreamBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); const old = await owned(tx, "stream", streamId, req.actor.school.id); await checkStream(tx, data, req.actor.school.id);
    if (old.gradeId !== data.gradeId && await tx.student.count({ where: { schoolId: req.actor.school.id, streamId } })) throw new ApiError(409, "A stream with students cannot be moved to another grade");
    const record = await tx.stream.update({ where: { id: streamId }, data, include: streamInclude });
    await audit(tx, req.actor, "updated", "stream", streamId); return record;
  });
  send(res, "UpdateStream", streamView(record));
});
export default router;