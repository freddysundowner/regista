import { Router } from "express";
import { db } from "@workspace/db";
import { send, teacher, auditors, streamAccess, logInclude, logView } from "../lib/core";
import { scope } from "../lib/students";
import { sum } from "../lib/finance/money";
import { metadata, view } from "../lib/finance/posting";
const router = Router();
router.get("/dashboard/modules", async (req, res) => {
  const schoolId = req.actor.school.id, today = new Date(Date.now() + 10800000).toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00+03:00`), isTeacher = teacher(req);
  const assignments = isTeacher ? await db.subjectAssignment.findMany({ where: { schoolId, userId: req.actor.user.id } }) : [];
  const classes = isTeacher ? await db.stream.findMany({ where: { schoolId, classTeacherUserId: req.actor.user.id } }) : [];
  const students = await db.student.findMany({ where: { schoolId, ...(isTeacher ? { streamId: { in: [...new Set([...assignments.map(a => a.streamId), ...classes.map(c => c.id)])] } } : {}) }, select: { id: true } });
  const ids = students.map(s => s.id), term = await db.term.findFirst({ where: { schoolId, isCurrent: true } });
  const attendance = await db.attendanceRecord.groupBy({ by: ["status"], where: { schoolId, studentId: { in: ids }, date: new Date(today) }, _count: true });
  const assessments = await db.assessment.findMany({ where: { schoolId, ...(term ? { termId: term.id } : {}), ...(isTeacher ? { OR: assignments.map(a => ({ learningAreaId: a.learningAreaId, termId: a.termId })) } : {}) }, select: { id: true, status: true } });
  let finance = null;
  if (!isTeacher) {
    const payments = await db.financeRecord.findMany({ where: { schoolId, kind: "payment", status: "posted", createdAt: { gte: start } } });
    const channels: Record<string, string> = {};
    for (const channel of new Set(payments.map(p => String(metadata(p).channel ?? "unknown")))) channels[channel] = sum(payments.filter(p => String(metadata(p).channel ?? "unknown") === channel).map(p => p.amount)).toFixed(2);
    const entries = term ? await db.ledgerEntry.findMany({ where: { schoolId, createdAt: { gte: term.startDate, lte: new Date(term.endDate.getTime() + 86400000 - 1) } } }) : [];
    finance = {
      todayCollected: sum(payments.map(p => p.amount)).toFixed(2), channels,
      termBilled: sum(entries.filter(e => e.type === "invoice").map(e => e.debit.minus(e.credit))).toFixed(2),
      termCollected: sum(entries.filter(e => ["payment", "refund"].includes(e.type)).map(e => e.credit.minus(e.debit))).toFixed(2),
      unmatchedCount: await db.matchException.count({ where: { schoolId, status: "open" } }),
      defaulterCount: await db.studentBalance.count({ where: { schoolId, balance: { gt: 0 } } }),
      reconciliation: await db.reconciliationRun.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, provider: true, createdAt: true } }),
    };
  }
  res.json(view({ date: today, termId: term?.id ?? null, finance, academics: { assessments: assessments.length, locked: assessments.filter(a => a.status === "locked").length, results: await db.assessmentResult.count({ where: { schoolId, studentId: { in: ids }, assessmentId: { in: assessments.map(a => a.id) } } }), publishedReportCards: await db.reportCard.count({ where: { schoolId, studentId: { in: ids }, status: "published", ...(term ? { termId: term.id } : {}) } }) }, attendance: attendance.map(a => ({ status: a.status, count: a._count })) }));
});
router.get("/dashboard/summary", async (req, res) => {
  const schoolId = req.actor.school.id;
  const isTeacher = teacher(req), studentScope = scope(req);
  const [totalStudents, activeStudents, guardianCount, familyCount, staffCount, gradeCount, streamCount, year, logs] = await Promise.all([
    db.student.count({ where: studentScope }),
    db.student.count({ where: { ...studentScope, status: "active" } }),
    db.guardian.count({ where: { schoolId, ...(isTeacher ? { students: { some: { student: studentScope } } } : {}) } }),
    db.family.count({ where: { schoolId, ...(isTeacher ? { students: { some: studentScope } } : {}) } }),
    db.user.count({ where: { schoolId, ...(isTeacher ? { id: req.actor.user.id } : {}) } }),
    db.grade.count({ where: { schoolId, ...(isTeacher ? { streams: { some: streamAccess(req.actor.user.id) } } : {}) } }),
    db.stream.count({ where: { schoolId, ...(isTeacher ? streamAccess(req.actor.user.id) : {}) } }),
    db.academicYear.findFirst({ where: { schoolId, isCurrent: true } }),
    !auditors.includes(req.actor.user.role) ? Promise.resolve([]) : db.auditLog.findMany({ where: { schoolId }, include: logInclude, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  send(res, "GetDashboardSummary", { schoolName: req.actor.school.name, totalStudents, activeStudents, guardianCount, familyCount, staffCount, gradeCount, streamCount, currentAcademicYear: year?.name ?? null, recentActivity: logs.map(logView) });
});
export default router;