import { Prisma } from "@workspace/db";
import type { Request } from "express";
import * as z from "@workspace/api-zod";
import { ApiError, owned, phone, contacts, body, audit, teacher, streamAccess, validateAsset, type Tx, type Actor } from "./core";

export const studentInclude = {
  grade: true, stream: true, guardians: { include: { guardian: true } },
  family: { include: { students: { select: { id: true, schoolId: true, stream: { select: { classTeacherUserId: true, assignments: { select: { userId: true, schoolId: true } }, subjectAssignments: { select: { userId: true, schoolId: true } } } } } } } },
} as const;
export const fullName = (student: { firstName: string; middleName?: string | null; lastName: string }) =>
  [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
export const scope = (req: Request): Prisma.StudentWhereInput => ({
  schoolId: req.actor.school.id, ...(teacher(req) ? { stream: streamAccess(req.actor.user.id, req.actor.school.id) } : {}),
});
export function studentView(student: any, req?: Request) {
  const siblings = student.family?.students.filter((s: any) => s.schoolId === student.schoolId && (!req || !teacher(req) || s.stream?.classTeacherUserId === req.actor.user.id || [...(s.stream?.assignments ?? []), ...(s.stream?.subjectAssignments ?? [])].some((a: any) => a.userId === req.actor.user.id && a.schoolId === req.actor.school.id))) ?? [];
  return { ...student, fullName: fullName(student), gradeName: student.grade?.name ?? null, streamName: student.stream?.name ?? null,
    guardianNames: student.guardians.map((l: any) => l.guardian.name),
    guardianPhones: student.guardians.map((l: any) => l.guardian.phone), siblingCount: Math.max(0, siblings.length - 1) };
}
export async function checkPlacement(tx: Tx, schoolId: string, gradeId: string | null | undefined, streamId: string | null | undefined) {
  if (gradeId) await owned(tx, "grade", gradeId, schoolId);
  if (streamId) {
    const stream = await owned(tx, "stream", streamId, schoolId);
    if (!gradeId || stream.gradeId !== gradeId) throw new ApiError(400, "Stream must belong to the student's grade");
  }
}
export function guardianData(input: any) {
  const { isPrimary, receivesNotifications, ...data } = contacts(input);
  return { ...data, ...(data.idNumber !== undefined ? { idNumber: data.idNumber || null } : {}), ...(data.altPhone !== undefined ? { altPhone: data.altPhone ? phone(data.altPhone) : null } : {}) };
}
export async function linkGuardian(tx: Tx, actor: Actor, studentId: string, input: any) {
  const data = guardianData(input);
  const beforeGuardian = await tx.guardian.findUnique({ where: { schoolId_phone: { schoolId: actor.school.id, phone: data.phone } } });
  const guardian = await tx.guardian.upsert({
    where: { schoolId_phone: { schoolId: actor.school.id, phone: data.phone } },
    create: { ...data, schoolId: actor.school.id }, update: {},
  });
  if (!beforeGuardian) await audit(tx, actor, "created", "guardian", guardian.id, undefined, guardian);
  const before = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId: guardian.id } } });
  const link = await tx.studentGuardian.upsert({ where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
    create: { schoolId: actor.school.id, studentId, guardianId: guardian.id, relationship: input.relationship, isPrimary: input.isPrimary ?? false, receivesNotifications: input.receivesNotifications ?? true },
    update: { relationship: input.relationship, isPrimary: input.isPrimary ?? false, receivesNotifications: input.receivesNotifications ?? true },
  });
  await audit(tx, actor, "linked", "student_guardian", link.id, before, link);
  return guardian;
}
// Caller must hold the school-level advisory transaction lock.
export async function mergeFamily(tx: Tx, actor: Actor, studentId: string) {
  const schoolId = actor.school.id;
  const guardianIds = (await tx.studentGuardian.findMany({ where: { studentId, student: { schoolId }, guardian: { schoolId } }, select: { guardianId: true } })).map(l => l.guardianId);
  if (!guardianIds.length) return false;
  const connected = await tx.student.findMany({
    where: { schoolId, guardians: { some: { guardianId: { in: guardianIds }, guardian: { schoolId } } } },
    select: { id: true, familyId: true },
  });
  const familyIds = [...new Set(connected.map(s => s.familyId).filter((id): id is string => !!id))].sort();
  if (connected.length < 2 && !familyIds.length) return false;
  const priorMembers = familyIds.length ? await tx.student.count({ where: { schoolId, familyId: { in: familyIds }, id: { not: studentId } } }) : 0;
  const student = await owned(tx, "student", studentId, schoolId);
  let familyId = familyIds[0];
  if (!familyId) {
    const family = await tx.family.create({ data: { schoolId, name: `${student.lastName} family` } });
    familyId = family.id; await audit(tx, actor, "created", "family", familyId);
  }
  const changed = await tx.student.findMany({ where: { schoolId, OR: [{ id: { in: connected.map(s => s.id) } }, { familyId: { in: familyIds } }], NOT: { familyId } }, select: { id: true, familyId: true } });
  // Include ungrouped students explicitly: SQL NOT excludes NULL values.
  const ungrouped = connected.filter(s => s.familyId === null);
  const affected = [...new Map([...changed, ...ungrouped].map(s => [s.id, s])).values()];
  await tx.student.updateMany({ where: { schoolId, id: { in: affected.map(s => s.id) } }, data: { familyId } });
  for (const student of affected) await audit(tx, actor, "family_linked", "student", student.id, { familyId: student.familyId }, { familyId });
  for (const obsolete of familyIds.filter(id => id !== familyId)) {
    const old = await tx.family.findFirst({ where: { id: obsolete, schoolId } });
    await tx.family.deleteMany({ where: { id: obsolete, schoolId } });
    await audit(tx, actor, "merged", "family", obsolete, old, { mergedIntoFamilyId: familyId });
  }
  return connected.length > 1 && priorMembers < 2;
}
export async function createStudentRecord(tx: Tx, actor: Actor, input: any) {
  const { guardians = [], ...data } = input;
  await checkPlacement(tx, actor.school.id, data.gradeId, data.streamId);
  if (guardians.length > 10) throw new ApiError(400, "A student may have at most 10 guardians per request");
  // Validate before any writes, including normalization of all guardian phones.
  for (const g of guardians) guardianData(g);
  const student = await tx.student.create({ data: { ...data, schoolId: actor.school.id } });
  await validateAsset(tx, actor.school.id, student.id, "student_photo", data.photoUrl);
  for (const guardian of guardians) await linkGuardian(tx, actor, student.id, guardian);
  const groupCreated = await mergeFamily(tx, actor, student.id);
  await audit(tx, actor, "created", "student", student.id);
  return { student, linkedGuardians: guardians.length, groupCreated };
}
export async function importPreview(tx: Tx, actor: Actor, rows: any[]) {
  const schoolId = actor.school.id;
  const [grades, streams, students, guardians] = await Promise.all([
    tx.grade.findMany({ where: { schoolId } }),
    tx.stream.findMany({ where: { schoolId } }),
    tx.student.findMany({ where: { schoolId, admissionNo: { in: rows.map(r => r.admissionNo.trim()) } }, select: { admissionNo: true } }),
    tx.guardian.findMany({ where: { schoolId, students: { some: { student: { schoolId } } } }, select: { phone: true } }),
  ]);
  const existing = new Set(students.map(s => s.admissionNo));
  const seen = new Set<string>(), seenPhones = new Set<string>(guardians.map(g => g.phone));
  let siblingMatches = 0;
  const inputs: any[] = [];
  const results = rows.map((row, index) => {
    const errors: string[] = [], warnings: string[] = [];
    const admissionNo = row.admissionNo.trim();
    const duplicate = existing.has(admissionNo) || seen.has(admissionNo);
    seen.add(admissionNo);
    if (duplicate) errors.push(existing.has(admissionNo) ? "Admission number already exists in this school" : "Admission number is repeated in this file");
    let normalizedPhone: string | null = null;
    const grade = row.gradeName ? grades.find(g => g.name.toLowerCase() === row.gradeName.trim().toLowerCase()) : undefined;
    const stream = row.streamName ? streams.find(s => s.gradeId === grade?.id && s.name.toLowerCase() === row.streamName.trim().toLowerCase()) : undefined;
    if (row.gradeName && !grade) errors.push("Grade does not exist in this school");
    if (row.streamName && !stream) errors.push("Stream does not exist in the selected grade");
    if (row.streamName && !row.gradeName) errors.push("Grade is required when a stream is provided");
    const hasGuardian = !!(row.guardianPhone || row.guardianName || row.guardianRelationship);
    if (hasGuardian) {
      if (!row.guardianPhone) errors.push("Guardian phone is required");
      else try { normalizedPhone = phone(row.guardianPhone); } catch (e) { errors.push((e as Error).message); }
      if (!row.guardianName?.trim()) errors.push("Guardian name is required");
    }
    let input: any;
    try {
      input = body(z.CreateStudentBody, {
        admissionNo, firstName: row.firstName, middleName: row.middleName, lastName: row.lastName,
        gender: row.gender || null, dateOfBirth: row.dateOfBirth || null, admissionDate: row.admissionDate || null,
        gradeId: grade?.id ?? null, streamId: stream?.id ?? null, status: "active",
        boardingStatus: row.boardingStatus || "day",
        guardians: hasGuardian ? [{ name: row.guardianName, phone: normalizedPhone ?? row.guardianPhone, relationship: row.guardianRelationship || "Guardian", isPrimary: true, receivesNotifications: true }] : [],
      });
    } catch (e) { errors.push((e as Error).message); }
    const status = duplicate ? "duplicate" : errors.length ? "error" : "valid";
    if (status === "valid" && normalizedPhone) {
      if (seenPhones.has(normalizedPhone)) { warnings.push("Shared guardian phone detected: student will join the sibling family"); siblingMatches++; }
      seenPhones.add(normalizedPhone);
    }
    inputs.push(status === "valid" ? input : null);
    return { rowNumber: index + 1, admissionNo, studentName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "), guardianPhone: normalizedPhone, status, errors, warnings };
  });
  return { inputs, preview: { totalRows: rows.length, validRows: results.filter(r => r.status === "valid").length, errorRows: results.filter(r => r.status === "error").length,
    duplicateRows: results.filter(r => r.status === "duplicate").length, siblingMatches, rows: results } };
}