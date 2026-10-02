import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, writers, send, body, parse, audit, lock, owned, ApiError, validateAsset } from "../lib/core";
import { studentInclude, studentView, scope, checkPlacement, createStudentRecord, linkGuardian, mergeFamily } from "../lib/students";
const router = Router();
router.get("/students", async (req, res) => {
  const { search, gradeId, streamId, status } = parse(z.ListStudentsQueryParams, req.query);
  if (search && search.length > 180) throw new ApiError(400, "Search is too long");
  if (gradeId) await owned(db, "grade", gradeId, req.actor.school.id);
  if (streamId) await owned(db, "stream", streamId, req.actor.school.id);
  const records = await db.student.findMany({ where: { ...scope(req), gradeId, streamId, status,
    ...(search ? { OR: ["admissionNo", "firstName", "middleName", "lastName"].map(field => ({ [field]: { contains: search, mode: "insensitive" } })) } : {}) },
    include: studentInclude, orderBy: { admissionNo: "asc" }, take: 10000 });
  send(res, "ListStudents", records.map(s => studentView(s, req)));
});
router.get("/students/:studentId", async (req, res) => {
  const { studentId } = parse(z.GetStudentParams, req.params);
  const record = await db.student.findFirst({ where: { id: studentId, ...scope(req) }, include: studentInclude });
  if (!record) throw new ApiError(404, "Student not found");
  send(res, "GetStudent", studentView(record, req));
});
router.post("/students", async (req, res) => {
  allow(req, writers); const input = body(z.CreateStudentBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const { student } = await createStudentRecord(tx, req.actor, input);
    return tx.student.findUniqueOrThrow({ where: { id: student.id }, include: studentInclude });
  }, { timeout: 30000 });
  send(res, "CreateStudent", studentView(record), 201);
});
router.patch("/students/:studentId", async (req, res) => {
  allow(req, writers); const { studentId } = parse(z.UpdateStudentParams, req.params); const data = body(z.UpdateStudentBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const old = await owned(tx, "student", studentId, req.actor.school.id);
    const effective = { ...old, ...data };
    await checkPlacement(tx, req.actor.school.id, effective.gradeId, effective.streamId);
    await validateAsset(tx, req.actor.school.id, studentId, "student_photo", data.photoUrl);
    const record = await tx.student.update({ where: { id: studentId }, data, include: studentInclude });
    await audit(tx, req.actor, "updated", "student", studentId); return record;
  });
  send(res, "UpdateStudent", studentView(record));
});
router.post("/students/:studentId/guardians", async (req, res) => {
  allow(req, writers);
  const { studentId } = parse(z.LinkStudentGuardianParams, req.params);
  const data = body(z.LinkStudentGuardianBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); await owned(tx, "student", studentId, req.actor.school.id);
    await linkGuardian(tx, req.actor, studentId, data); await mergeFamily(tx, req.actor, studentId);
    return tx.student.findUniqueOrThrow({ where: { id: studentId }, include: studentInclude });
  });
  send(res, "LinkStudentGuardian", studentView(record));
});
export default router;