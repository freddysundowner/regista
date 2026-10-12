import { Prisma } from "@workspace/db";
import { enforceLearnerLimit } from "./billing";
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
  NOT: { admissionNo: { startsWith: REMOVED_PREFIX } },
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
/**
 * The next admission number when none is given: one after the highest number that follows the
 * pattern of the latest admission (e.g. 1235 → 1236, S004 → S005). Callers hold the school lock.
 */
export async function nextAdmissionNo(tx: Tx, schoolId: string) {
  const rows = await tx.student.findMany({ where: { schoolId, NOT: { admissionNo: { startsWith: REMOVED_PREFIX } } }, select: { admissionNo: true }, orderBy: { createdAt: "desc" } });
  const pattern = rows.map(r => /^(.*?)(\d+)$/.exec(r.admissionNo.trim())).find(Boolean);
  const prefix = pattern?.[1] ?? "", width = pattern?.[2].length ?? 1;
  const taken = new Set(rows.map(r => r.admissionNo.trim().toUpperCase()));
  let next = Math.max(0, ...rows.map(r => r.admissionNo.trim()).filter(a => a.startsWith(prefix) && /^\d+$/.test(a.slice(prefix.length))).map(a => Number(a.slice(prefix.length)))) + 1;
  const format = (n: number) => `${prefix}${String(n).padStart(width, "0")}`;
  while (taken.has(format(next).toUpperCase())) next++;
  return format(next);
}

export async function createStudentRecord(tx: Tx, actor: Actor, input: any) {
  const { guardians = [], ...data } = input;
  if (!data.admissionNo?.trim()) data.admissionNo = await nextAdmissionNo(tx, actor.school.id);
  await checkPlacement(tx, actor.school.id, data.gradeId, data.streamId);
  if (guardians.length > 10) throw new ApiError(400, "A student may have at most 10 guardians per request");
  // Validate before any writes, including normalization of all guardian phones.
  for (const g of guardians) guardianData(g);
  if ((data.status ?? "active") === "active") await enforceLearnerLimit(tx, actor.school.id);
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
/** Admission-number prefix of a removed learner's placeholder; hidden from every learner list. */
export const REMOVED_PREFIX = "DELETED-";

/** Replaces a learner's name and admission number wherever they appear inside stored JSON. */
function scrubJson(value: unknown, names: RegExp | null, admissionNo: string, tag: string): unknown {
  if (typeof value === "string") return value === admissionNo ? tag : names ? value.replace(names, "Deleted learner") : value;
  if (Array.isArray(value)) return value.map(v => scrubJson(v, names, admissionNo, tag));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubJson(v, names, admissionNo, tag)]));
  return value;
}

/**
 * Erases a learner permanently. With no fee history the record and everything about them is deleted.
 * Fee history is append-only, so then the record becomes a nameless placeholder that keeps only the
 * amounts (school totals still add up); every personal, academic and contact detail is scrubbed,
 * including payer details, receipts, messages and audit entries. `apply: false` only counts.
 */
export async function removeStudent(tx: Tx, actor: Actor, studentId: string, apply: boolean) {
  const schoolId = actor.school.id, mine = { schoolId, studentId };
  const student = await owned(tx, "student", studentId, schoolId);
  const money = (await Promise.all([
    tx.ledgerEntry.count({ where: mine }), tx.financeRecord.count({ where: mine }), tx.invoiceLine.count({ where: mine }),
    tx.feeAllocation.count({ where: mine }), tx.paymentStudentAllocation.count({ where: mine }), tx.sponsorAllocation.count({ where: mine }),
    tx.stkRequest.count({ where: mine }), tx.paymentPlan.count({ where: mine }), tx.incomingPayment.count({ where: { schoolId, knownStudentId: studentId } }),
  ])).reduce((a, b) => a + b, 0);
  const cards = await tx.reportCard.findMany({ where: mine, select: { id: true } });
  const records = await tx.financeRecord.findMany({ where: mine, select: { id: true } });
  const fileWhere: Prisma.StoredFileWhereInput = { schoolId, OR: [
    { entityType: { in: ["student_photo", "school_report", "finance_statement"] }, entityId: studentId },
    { entityType: "report_card", entityId: { in: cards.map(c => c.id) } },
    { entityType: { in: ["finance_receipt", "finance_statement", "finance_invoice", "invoice"] }, entityId: { in: records.map(r => r.id) } },
  ] };
  const [attendance, marks, ratings, files, links] = await Promise.all([
    tx.attendanceRecord.count({ where: mine }), tx.assessmentResult.count({ where: mine }), tx.learnerRating.count({ where: mine }),
    tx.storedFile.findMany({ where: fileWhere, select: { id: true, objectKey: true } }),
    tx.studentGuardian.findMany({ where: mine, include: { guardian: { include: { _count: { select: { students: true } } } } } }),
  ]);
  const sole = links.filter(l => l.guardian._count.students <= 1).map(l => l.guardian);
  const summary = { mode: money ? "anonymize" : "delete", admissionNo: student.admissionNo, name: fullName(student), attendance, marks, ratings, reportCards: cards.length,
    files: files.length, guardiansRemoved: sole.length, guardiansKept: links.length - sole.length, financeRecords: money } as const;
  if (!apply) return { summary, objectKeys: [] as string[] };

  await tx.attendanceRecord.deleteMany({ where: mine });
  await tx.assessmentResult.deleteMany({ where: mine });
  await tx.learnerRating.deleteMany({ where: mine });
  await tx.reportCard.deleteMany({ where: mine });
  await tx.storedFile.deleteMany({ where: { id: { in: files.map(f => f.id) } } });
  await tx.payerAlias.deleteMany({ where: mine });
  await tx.studentGuardian.deleteMany({ where: mine });
  // A guardian who only belonged to this learner goes too; one with message history is anonymized instead, as the delivery log must stay.
  for (const g of sole) {
    await tx.guardianVerification.deleteMany({ where: { schoolId, guardianId: g.id } });
    if (await tx.messageDelivery.count({ where: { schoolId, guardianId: g.id } })) {
      await tx.messageDelivery.updateMany({ where: { schoolId, guardianId: g.id, status: { in: ["queued", "failed"] } }, data: { status: "cancelled", error: "Learner removed" } });
      await tx.messageDelivery.updateMany({ where: { schoolId, guardianId: g.id }, data: { phone: `removed:${g.id}`, content: "[removed]" } });
      await tx.guardian.update({ where: { id: g.id }, data: { name: "Removed guardian", phone: `anonymous:${g.id}`, altPhone: null, email: null, idNumber: null, relationship: null, anonymizedAt: new Date(), whatsappLastInboundAt: null } });
    } else await tx.guardian.delete({ where: { id: g.id } });
  }
  // A family of one is no family: dissolve it so the remaining sibling stands alone.
  if (student.familyId) {
    const rest = await tx.student.findMany({ where: { schoolId, familyId: student.familyId, id: { not: studentId } }, select: { id: true } });
    if (rest.length <= 1) {
      await tx.student.updateMany({ where: { schoolId, familyId: student.familyId }, data: { familyId: null } });
      await tx.family.delete({ where: { id: student.familyId } });
    }
  }
  // Past audit entries for this learner keep what happened and when, not who it was.
  const redacted = { redacted: "learner removed" };
  const entityIds = [studentId, ...links.map(l => l.id), ...cards.map(c => c.id)];
  await tx.auditLog.updateMany({ where: { schoolId, entityId: { in: entityIds } }, data: { before: redacted, after: redacted } });
  await tx.platformAudit.updateMany({ where: { schoolId, entityId: { in: entityIds } }, data: { before: redacted, after: redacted } });
  // Name fragments short enough to collide with ordinary words are left alone; the admission number is matched exactly.
  const nameParts = [fullName(student), `${student.firstName} ${student.lastName}`].filter((n, i, all) => n.trim().length >= 5 && all.indexOf(n) === i);
  const names = nameParts.length ? new RegExp(nameParts.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi") : null;
  for (const n of nameParts) await tx.messageDelivery.updateMany({ where: { schoolId, content: { contains: n, mode: "insensitive" } }, data: { content: "[removed]" } });
  for (const pattern of [...nameParts.map(n => `%${n}%`), `%"admissionNo": "${student.admissionNo}"%`]) {
    await tx.$executeRaw`UPDATE audit_logs SET before = ${redacted}::jsonb, after = ${redacted}::jsonb WHERE "schoolId" = ${schoolId}::uuid AND (before::text ILIKE ${pattern} OR after::text ILIKE ${pattern})`;
  }
  if (money) {
    const tag = `${REMOVED_PREFIX}${studentId.slice(0, 8).toUpperCase()}`;
    // Payments made only for this learner lose the payer's identity; a payment split with a sibling still belongs to that family.
    const paid = [...new Set([
      ...(await tx.paymentStudentAllocation.findMany({ where: mine, select: { paymentId: true } })).map(a => a.paymentId),
      ...(await tx.incomingPayment.findMany({ where: { schoolId, knownStudentId: studentId }, select: { id: true } })).map(p => p.id),
    ])];
    const shared = new Set((await tx.paymentStudentAllocation.findMany({ where: { schoolId, paymentId: { in: paid }, studentId: { not: studentId } }, select: { paymentId: true } })).map(a => a.paymentId));
    await tx.incomingPayment.updateMany({ where: { schoolId, id: { in: paid.filter(id => !shared.has(id)) } }, data: { payerName: null, payerPhone: null, accountReference: tag, normalizedReference: null, bankAccountFrom: null, rawPayload: redacted } });
    await tx.stkRequest.updateMany({ where: mine, data: { phone: "removed" } });
    // Amounts and links stay; any name or admission number written into a record's details goes.
    for (const r of await tx.financeRecord.findMany({ where: { schoolId, OR: [{ studentId }, { kind: "invoice_preview" }] }, select: { id: true, data: true } })) {
      const cleaned = scrubJson(r.data, names, student.admissionNo, tag);
      if (JSON.stringify(cleaned) !== JSON.stringify(r.data)) await tx.financeRecord.update({ where: { id: r.id }, data: { data: cleaned as Prisma.InputJsonValue } });
    }
    await tx.student.update({ where: { id: studentId }, data: { admissionNo: tag, firstName: "Deleted", middleName: null, lastName: "learner", gender: null, dateOfBirth: null, admissionDate: null, upi: null, photoUrl: null, pathway: null, transportRouteId: null, familyId: null, gradeId: null, streamId: null, status: "left" } });
  } else {
    await tx.studentBalance.deleteMany({ where: mine });
    await tx.student.delete({ where: { id: studentId } });
  }
  await audit(tx, actor, "deleted", "student", studentId, redacted, { mode: summary.mode, attendance, marks, ratings, reportCards: cards.length, files: files.length, guardiansRemoved: sole.length });
  return { summary, objectKeys: files.map(f => f.objectKey) };
}
