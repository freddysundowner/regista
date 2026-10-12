import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, admin, auditors, readers, send, body, parse, audit, lock, owned, ApiError, teacher, streamAccess, type Tx, type Actor } from "../lib/core";
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
  const scope: Prisma.StudentWhereInput = teacher(req) ? { stream: streamAccess(req.actor.user.id, req.actor.school.id) } : {};
  const where: Prisma.GradeWhereInput = { schoolId: req.actor.school.id, ...(teacher(req) ? { streams: { some: streamAccess(req.actor.user.id, req.actor.school.id) } } : {}) };
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
// Only an unused grade can go: its starter curriculum and scale link are removed with it.
router.delete("/grades/:gradeId", async (req, res) => {
  allow(req, admin); const { gradeId } = parse(z.DeleteGradeParams, req.params);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); const schoolId = req.actor.school.id;
    const record = await owned(tx, "grade", gradeId, schoolId);
    if (await tx.stream.count({ where: { schoolId, gradeId } })) throw new ApiError(409, `Delete the classes in ${record.name} first`);
    if (await tx.student.count({ where: { schoolId, gradeId } })) throw new ApiError(409, `${record.name} still has learners. Move them to another grade first`);
    if (await tx.assessment.count({ where: { schoolId, gradeId } })) throw new ApiError(409, `${record.name} has assessment records and cannot be deleted`);
    if (await tx.financeRecord.count({ where: { schoolId, data: { path: ["gradeId"], equals: gradeId } } })) throw new ApiError(409, `${record.name} has fee records and cannot be deleted`);
    const areas = (await tx.learningArea.findMany({ where: { schoolId, gradeId }, select: { id: true } })).map(a => a.id);
    if (areas.length && await tx.subjectAssignment.count({ where: { schoolId, learningAreaId: { in: areas } } })) throw new ApiError(409, `${record.name} has subject teachers assigned. Remove them first`);
    // Strands nest, so remove leaves first until none remain.
    for (;;) {
      const strands = await tx.curriculumStrand.findMany({ where: { schoolId, learningAreaId: { in: areas } }, select: { id: true, parentId: true } });
      if (!strands.length) break;
      const parents = new Set(strands.map(s => s.parentId));
      await tx.curriculumStrand.deleteMany({ where: { id: { in: strands.filter(s => !parents.has(s.id)).map(s => s.id) } } });
    }
    await tx.learningArea.deleteMany({ where: { schoolId, gradeId } });
    await tx.gradeScale.deleteMany({ where: { schoolId, gradeId } });
    await tx.grade.delete({ where: { id: gradeId } });
    await audit(tx, req.actor, "deleted", "grade", gradeId, record, { removed: true });
  });
  send(res, "DeleteGrade", { message: "Grade removed" });
});
router.get("/streams", async (req, res) => {
  const query = parse(z.ListStreamsQueryParams, req.query);
  if (query.gradeId) await owned(db, "grade", query.gradeId, req.actor.school.id);
  send(res, "ListStreams", (await db.stream.findMany({ where: { schoolId: req.actor.school.id, ...query, ...(teacher(req) ? streamAccess(req.actor.user.id, req.actor.school.id) : {}) }, include: streamInclude, orderBy: { name: "asc" }, take: 1000 })).map(streamView));
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
// One class, or a grade that has no classes, with what a head teacher wants to see at a glance.
router.get("/class-summary", async (req, res) => {
  allow(req, auditors); const { streamId, gradeId } = parse(z.GetClassSummaryQueryParams, req.query);
  if (!streamId === !gradeId) throw new ApiError(400, "Choose one class or one grade");
  const schoolId = req.actor.school.id;
  const stream = streamId ? await db.stream.findFirst({ where: { id: streamId, schoolId }, include: { grade: true, classTeacher: true } }) : null;
  const grade = stream?.grade ?? (gradeId ? await owned(db, "grade", gradeId, schoolId) : null);
  if (!grade) throw new ApiError(404, "Record not found");
  const where = stream ? { schoolId, streamId: stream.id } : { schoolId, gradeId: grade.id };
  const all = await db.student.findMany({ where, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] });
  const students = all.filter(s => s.status === "active"), ids = students.map(s => s.id);
  const since = new Date(Date.now() - 30 * 86400000); since.setUTCHours(0, 0, 0, 0);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [attendance, balances, current, assignments] = await Promise.all([
    db.attendanceRecord.findMany({ where: { schoolId, studentId: { in: ids }, date: { gte: since } }, select: { studentId: true, date: true, status: true } }),
    db.studentBalance.findMany({ where: { schoolId, studentId: { in: ids } } }),
    db.term.findFirst({ where: { schoolId, isCurrent: true } }),
    stream ? db.teacherAssignment.findMany({ where: { schoolId, streamId: stream.id }, include: { user: true } }) : [],
  ]);
  const subjects = stream && current ? await db.subjectAssignment.findMany({ where: { schoolId, streamId: stream.id, termId: current.id } }) : [];
  const [areas, subjectUsers] = await Promise.all([
    db.learningArea.findMany({ where: { schoolId, id: { in: subjects.map(s => s.learningAreaId) } } }),
    db.user.findMany({ where: { schoolId, id: { in: subjects.map(s => s.userId) } } }),
  ]);
  const teachers = new Map<string, { id: string; name: string; subjects: string[] }>();
  for (const a of assignments) teachers.set(a.userId, { id: a.userId, name: a.user.name, subjects: [] });
  for (const s of subjects) {
    const user = subjectUsers.find(u => u.id === s.userId); if (!user) continue;
    const entry = teachers.get(user.id) ?? { id: user.id, name: user.name, subjects: [] };
    const area = areas.find(a => a.id === s.learningAreaId)?.name;
    if (area && !entry.subjects.includes(area)) entry.subjects.push(area);
    teachers.set(user.id, entry);
  }
  const attended = (rows: { status: string }[]) => rows.filter(a => ["present", "late"].includes(a.status)).length;
  const percent = (rows: { status: string }[]) => rows.length ? new Prisma.Decimal(attended(rows)).times(100).div(rows.length).toFixed(1) : null;
  const todays = attendance.filter(a => a.date.getTime() === today.getTime());
  const balanceOf = new Map(balances.map(b => [b.studentId, b.balance]));
  const seesFees = readers.includes(req.actor.user.role);
  const owing = balances.filter(b => b.balance.gt(0)), credit = balances.filter(b => b.balance.lt(0));
  const total = (rows: typeof balances) => rows.reduce((t, b) => t.plus(b.balance), new Prisma.Decimal(0));
  send(res, "GetClassSummary", {
    kind: stream ? "stream" : "grade", id: stream?.id ?? grade.id, name: stream ? `${grade.name} ${stream.name}` : grade.name,
    gradeId: grade.id, gradeName: grade.name, levelBand: grade.levelBand, streamName: stream?.name ?? null,
    classTeacher: stream?.classTeacher ? { id: stream.classTeacher.id, name: stream.classTeacher.name } : null,
    teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    learners: { total: students.length, male: students.filter(s => s.gender === "male").length, female: students.filter(s => s.gender === "female").length,
      other: students.filter(s => s.gender && !["male", "female"].includes(s.gender)).length,
      boarders: students.filter(s => s.boardingStatus === "boarder").length, day: students.filter(s => s.boardingStatus !== "boarder").length, former: all.length - students.length },
    attendance: { days: new Set(attendance.map(a => a.date.getTime())).size, records: attendance.length, percent: percent(attendance),
      todayMarked: todays.length, todayPresent: attended(todays), todayAbsent: todays.filter(a => a.status === "absent").length },
    fees: seesFees ? { outstanding: total(owing).toFixed(2), credit: total(credit).abs().toFixed(2), owing: owing.length } : null,
    students: students.map(s => ({ id: s.id, admissionNo: s.admissionNo, fullName: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), gender: s.gender, boardingStatus: s.boardingStatus,
      balance: seesFees ? (balanceOf.get(s.id) ?? new Prisma.Decimal(0)).toFixed(2) : null, attendancePercent: percent(attendance.filter(a => a.studentId === s.id)) })),
  });
});
// Only an unused class can go: its teacher access links are removed with it.
router.delete("/streams/:streamId", async (req, res) => {
  allow(req, admin); const { streamId } = parse(z.DeleteStreamParams, req.params);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); const schoolId = req.actor.school.id;
    const record = await owned(tx, "stream", streamId, schoolId);
    if (await tx.student.count({ where: { schoolId, streamId } })) throw new ApiError(409, "This class still has learners. Move them to another class first");
    if (await tx.attendanceRecord.count({ where: { schoolId, streamId } })) throw new ApiError(409, "This class has attendance records and cannot be deleted");
    if (await tx.subjectAssignment.count({ where: { schoolId, streamId } })) throw new ApiError(409, "This class has subject teachers assigned. Remove them first");
    await tx.teacherAssignment.deleteMany({ where: { schoolId, streamId } });
    await tx.stream.delete({ where: { id: streamId } });
    await audit(tx, req.actor, "deleted", "stream", streamId, record, { removed: true });
  });
  send(res, "DeleteStream", { message: "Class removed" });
});
export default router;