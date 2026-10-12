import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { admin, auditors, allow, send, body, parse, audit, lock, owned, teacher, ApiError, logInclude, logView } from "../lib/core";

const router = Router();
const include = { user: true, stream: { include: { grade: true } } } as const;
const view = (row: any) => ({ ...row, userName: row.user.name, streamName: row.stream.name, gradeName: row.stream.grade.name });
router.get("/teacher-assignments", async (req, res) => {
  const records = await db.teacherAssignment.findMany({ where: { schoolId: req.actor.school.id, ...(teacher(req) ? { userId: req.actor.user.id } : {}) }, include, orderBy: { createdAt: "desc" } });
  send(res, "ListTeacherAssignments", records.map(view));
});
// Class teachers, stream access and subject teachers as one list, optionally for one person.
async function assignmentRows(schoolId: string, userId?: string) {
  const mine = userId ? { userId } : {};
  const [streams, access, subjects, users, areas, terms] = await Promise.all([
    db.stream.findMany({ where: { schoolId }, include: { grade: true } }),
    db.teacherAssignment.findMany({ where: { schoolId, ...mine } }),
    db.subjectAssignment.findMany({ where: { schoolId, ...mine } }),
    db.user.findMany({ where: { schoolId, ...(userId ? { id: userId } : {}) } }),
    db.learningArea.findMany({ where: { schoolId } }),
    db.term.findMany({ where: { schoolId } }),
  ]);
  const streamOf = new Map(streams.map(s => [s.id, s])), userOf = new Map(users.map(u => [u.id, u]));
  const areaOf = new Map(areas.map(a => [a.id, a.name])), termOf = new Map(terms.map(t => [t.id, t]));
  const row = (kind: string, recordId: string, userId: string, streamId: string, assignedAt: Date, extra: { subject?: string | null; termId?: string } = {}) => {
    const stream = streamOf.get(streamId), user = userOf.get(userId), term = extra.termId ? termOf.get(extra.termId) : undefined;
    if (!stream || !user) return [];
    return [{ id: `${kind}:${recordId}`, kind, recordId, userId, userName: user.name, userRole: user.role, userActive: user.isActive,
      gradeId: stream.gradeId, gradeName: stream.grade.name, streamId, streamName: stream.name,
      subject: extra.subject ?? null, termName: term?.name ?? null, isCurrentTerm: term?.isCurrent ?? true, assignedAt }];
  };
  return [
    ...streams.flatMap(s => s.classTeacherUserId ? row("class_teacher", s.id, s.classTeacherUserId, s.id, s.updatedAt) : []),
    ...access.flatMap(a => row("stream_access", a.id, a.userId, a.streamId, a.createdAt)),
    ...subjects.flatMap(a => row("subject", a.id, a.userId, a.streamId, a.createdAt, { subject: areaOf.get(a.learningAreaId) ?? "Unknown subject", termId: a.termId })),
  ].sort((a, b) => a.userName.localeCompare(b.userName) || a.gradeName.localeCompare(b.gradeName, undefined, { numeric: true }) || a.streamName.localeCompare(b.streamName));
}
router.get("/staff-assignments", async (req, res) => {
  allow(req, auditors);
  send(res, "ListStaffAssignments", await assignmentRows(req.actor.school.id));
});
// Everything about one staff member: account, where they teach, their workload and what they have done.
router.get("/users/:userId/profile", async (req, res) => {
  allow(req, auditors); const { userId } = parse(z.GetStaffProfileParams, req.params); const schoolId = req.actor.school.id;
  const user = await owned(db, "user", userId, schoolId);
  const assignments = await assignmentRows(schoolId, userId);
  const current = assignments.filter(a => a.isCurrentTerm), streamIds = [...new Set(current.map(a => a.streamId))];
  const since = new Date(Date.now() - 30 * 86400000);
  const term = await db.term.findFirst({ where: { schoolId, isCurrent: true } });
  const [learners, marked, registers, assessments, actions, activity] = await Promise.all([
    db.student.count({ where: { schoolId, status: "active", streamId: { in: streamIds } } }),
    db.attendanceRecord.count({ where: { schoolId, markedBy: userId, date: { gte: since } } }),
    db.attendanceRecord.groupBy({ by: ["streamId", "date"], where: { schoolId, markedBy: userId, date: { gte: since } } }),
    db.assessment.count({ where: { schoolId, createdBy: userId, ...(term ? { termId: term.id } : {}) } }),
    db.auditLog.count({ where: { schoolId, userId } }),
    db.auditLog.findMany({ where: { schoolId, userId }, include: logInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 }),
  ]);
  send(res, "GetStaffProfile", {
    user, assignments,
    stats: { classes: streamIds.length, learners, subjects: new Set(current.filter(a => a.kind === "subject").map(a => a.subject)).size,
      attendanceMarked: marked, registersMarked: registers.length, assessments, actions, lastActivityAt: activity[0]?.createdAt ?? user.lastLoginAt ?? null },
    activity: activity.map(logView),
  });
});
// Removing a subject teacher keeps every mark already entered; it only ends their write access.
router.delete("/subject-assignments/:assignmentId", async (req, res) => {
  allow(req, admin); const { assignmentId } = parse(z.DeleteSubjectAssignmentParams, req.params);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const record = await tx.subjectAssignment.findFirst({ where: { id: assignmentId, schoolId: req.actor.school.id } });
    if (!record) throw new ApiError(404, "Assignment not found");
    await tx.subjectAssignment.delete({ where: { id: assignmentId } });
    await audit(tx, req.actor, "deleted", "subject_assignment", record.id, record, { removed: true });
  });
  send(res, "DeleteSubjectAssignment", { message: "Subject teacher removed" });
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