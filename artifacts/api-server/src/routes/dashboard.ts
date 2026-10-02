import { Router } from "express";
import { db } from "@workspace/db";
import { send, teacher, logInclude, logView } from "../lib/core";
import { scope } from "../lib/students";
const router = Router();
router.get("/dashboard/summary", async (req, res) => {
  const schoolId = req.actor.school.id;
  const isTeacher = teacher(req), studentScope = scope(req);
  const [totalStudents, activeStudents, guardianCount, familyCount, staffCount, gradeCount, streamCount, year, logs] = await Promise.all([
    db.student.count({ where: studentScope }),
    db.student.count({ where: { ...studentScope, status: "active" } }),
    db.guardian.count({ where: { schoolId, ...(isTeacher ? { students: { some: { student: studentScope } } } : {}) } }),
    db.family.count({ where: { schoolId, ...(isTeacher ? { students: { some: studentScope } } : {}) } }),
    db.user.count({ where: { schoolId, ...(isTeacher ? { id: req.actor.user.id } : {}) } }),
    db.grade.count({ where: { schoolId, ...(isTeacher ? { streams: { some: { classTeacherUserId: req.actor.user.id } } } : {}) } }),
    db.stream.count({ where: { schoolId, ...(isTeacher ? { classTeacherUserId: req.actor.user.id } : {}) } }),
    db.academicYear.findFirst({ where: { schoolId, isCurrent: true } }),
    isTeacher ? Promise.resolve([]) : db.auditLog.findMany({ where: { schoolId }, include: logInclude, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  send(res, "GetDashboardSummary", { schoolName: req.actor.school.name, totalStudents, activeStudents, guardianCount, familyCount, staffCount, gradeCount, streamCount, currentAcademicYear: year?.name ?? null, recentActivity: logs.map(logView) });
});
export default router;