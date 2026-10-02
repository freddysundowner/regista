import { ApiError, type Actor, type Tx, owned } from "../core";
export const academicAdmins = ["school_admin", "super_admin"];
export const academicReaders = [...academicAdmins, "principal", "teacher", "class_teacher"];
export async function academicOwned(tx: Tx, model: "learningArea" | "curriculumStrand" | "performanceScale" | "performanceLevel" | "assessment" | "assessmentResult" | "reportCard", schoolId: string, id: string) {
  const value = await (tx[model] as any).findFirst({ where: { schoolId, id } });
  if (!value) throw new ApiError(404, "Academic record not found");
  return value;
}
export async function subjectAccess(tx: Tx, actor: Actor, learningAreaId: string, termId: string, studentId?: string, write = false) {
  const area = await academicOwned(tx, "learningArea", actor.school.id, learningAreaId);
  const student = studentId ? await owned(tx, "student", studentId, actor.school.id) : undefined;
  if (student && student.gradeId !== area.gradeId) throw new ApiError(400, "Student is not in this assessment grade");
  if (academicAdmins.includes(actor.user.role) || (!write && actor.user.role === "principal")) return;
  if (!["teacher", "class_teacher"].includes(actor.user.role)) throw new ApiError(403, "Academic access denied");
  const assignment = await tx.subjectAssignment.findFirst({ where: { schoolId: actor.school.id, userId: actor.user.id, learningAreaId, termId, ...(student ? { streamId: student.streamId ?? "00000000-0000-0000-0000-000000000000" } : {}) } });
  if (!assignment) throw new ApiError(403, "Teacher is not assigned to this subject, term and learner's stream");
}
export async function classAccess(tx: Tx, actor: Actor, streamId: string, write = false) {
  const stream = await owned(tx, "stream", streamId, actor.school.id);
  if (academicAdmins.includes(actor.user.role) || (!write && actor.user.role === "principal")) return;
  if (!["teacher", "class_teacher"].includes(actor.user.role) || stream.classTeacherUserId !== actor.user.id) throw new ApiError(403, "Only the assigned class teacher can access this class register");
}