import { ApiError, owned, type Tx } from "../core";
import { termResults } from "./service";

/** Versioned publication artifact. Never reconstruct a published document from live records. */
export async function publicationSnapshot(tx: Tx, schoolId: string, studentId: string, termId: string, comments: { classTeacherComment?: string | null; headTeacherComment?: string | null; nextTermOpeningDate?: Date | string | null }) {
  const student = await owned(tx, "student", studentId, schoolId);
  const term = await owned(tx, "term", termId, schoolId);
  const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
  const grade = student.gradeId ? await owned(tx, "grade", student.gradeId, schoolId) : null;
  const stream = student.streamId ? await owned(tx, "stream", student.streamId, schoolId) : null;
  const ratings = await tx.learnerRating.findMany({ where: { schoolId, studentId, termId } });
  const levels = await tx.performanceLevel.findMany({ where: { schoolId, id: { in: ratings.map(r => r.performanceLevelId) } } });
  const attendance = await tx.attendanceRecord.findMany({ where: { schoolId, studentId, date: { gte: term.startDate, lte: term.endDate } }, select: { date: true, status: true } });
  return {
    version: 1 as const,
    school: { id: school.id, name: school.name, address: school.address, phone: school.phone, email: school.email, logoUrl: school.logoUrl },
    student: { id: student.id, firstName: student.firstName, middleName: student.middleName, lastName: student.lastName, admissionNo: student.admissionNo, gradeName: grade?.name, streamName: stream?.name },
    term: { id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate },
    results: await termResults(tx, schoolId, studentId, termId),
    ratings: ratings.map(r => ({ category: r.category, code: r.code, level: levels.find(l => l.id === r.performanceLevelId)?.code ?? null })),
    attendance, comments,
  };
}
export function requirePublicationSnapshot(value: unknown): ReturnType<typeof JSON.parse> {
  const snapshot = value as any;
  if (!snapshot || snapshot.version !== 1 || !snapshot.school || !snapshot.student || !snapshot.term || !Array.isArray(snapshot.results) || !Array.isArray(snapshot.ratings) || !Array.isArray(snapshot.attendance) || !snapshot.comments) {
    throw new ApiError(409, "Legacy publication has no complete snapshot; administrator review required. Live data will not replace published history.");
  }
  return snapshot;
}