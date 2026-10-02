import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { admin, allow, send, body, parse, audit, lock, owned, teacher, ApiError } from "../lib/core";

const router = Router();
const include = { user: true, stream: { include: { grade: true } } } as const;
const view = (row: any) => ({ ...row, userName: row.user.name, streamName: row.stream.name, gradeName: row.stream.grade.name });
router.get("/teacher-assignments", async (req, res) => {
  const records = await db.teacherAssignment.findMany({ where: { schoolId: req.actor.school.id, ...(teacher(req) ? { userId: req.actor.user.id } : {}) }, include, orderBy: { createdAt: "desc" } });
  send(res, "ListTeacherAssignments", records.map(view));
});
router.post("/teacher-assignments", async (req, res) => {
  allow(req, admin); const data = body(z.CreateTeacherAssignmentBody, req.body);
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    await owned(tx, "stream", data.streamId, req.actor.school.id);
    const user = await owned(tx, "user", data.userId, req.actor.school.id);
    if (!user.isActive || !["teacher", "class_teacher"].includes(user.role)) throw new ApiError(400, "Choose an active teacher in this school");
    const record = await tx.teacherAssignment.create({ data: { ...data, schoolId: req.actor.school.id }, include });
    await audit(tx, req.actor, "created", "teacher_assignment", record.id);
    return record;
  });
  send(res, "CreateTeacherAssignment", view(record), 201);
});
router.delete("/teacher-assignments/:assignmentId", async (req, res) => {
  allow(req, admin); const { assignmentId } = parse(z.DeleteTeacherAssignmentParams, req.params);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const record = await tx.teacherAssignment.findFirst({ where: { id: assignmentId, schoolId: req.actor.school.id } });
    if (!record) throw new ApiError(404, "Assignment not found");
    await tx.teacherAssignment.delete({ where: { id: assignmentId } });
    await audit(tx, req.actor, "deleted", "teacher_assignment", record.id, record, { removed: true });
  });
  send(res, "DeleteTeacherAssignment", { message: "Teacher assignment removed" });
});
export default router;