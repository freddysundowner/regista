import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { ApiError, audit, owned, type Actor } from "../core";
import { renderFinancePdf, schoolLogoBlock } from "../finance/documents";
import { readUrl, storedObject } from "../school-files";
import { academicOwned, classAccess } from "./access";
import { publicationSnapshot, requirePublicationSnapshot } from "./snapshot";

export async function signedDocument(actor: Actor, id: string) {
  const record = await db.storedFile.findFirst({ where: { id, schoolId: actor.school.id, status: "ready" } });
  if (!record) throw new ApiError(404, "Document not found");
  return { id, ...await readUrl(record.objectKey, `/api/storage/files/${id}`) };
}
export async function savePdf(actor: Actor, entityType: string, entityId: string, content: TDocumentDefinitions["content"]) {
  const logo = await schoolLogoBlock(actor.school);
  if (logo.length) content = [...logo, ...(Array.isArray(content) ? content : [content])];
  return saveDocument(actor, entityType, entityId, await renderFinancePdf(content), "pdf", "application/pdf");
}
export async function saveDocument(actor: Actor, entityType: string, entityId: string, bytes: Buffer, extension: string, contentType: string) {
  const id = randomUUID(), objectKey = `${actor.school.id}/documents/${id}.${extension}`;
  await storedObject(objectKey).save(bytes, { resumable: false, contentType, metadata: { cacheControl: "private, no-store" } });
  await db.$transaction(async tx => {
    await tx.storedFile.create({ data: { id, schoolId: actor.school.id, ownerId: actor.user.id, entityType, entityId, objectKey, filename: `${entityType}-${id}.${extension}`, contentType, size: bytes.length, status: "ready" } });
    await audit(tx, actor, "generated", entityType, id);
  });
  return signedDocument(actor, id);
}
export async function reportCardPdf(actor: Actor, id: string) {
  const card = await academicOwned(db, "reportCard", actor.school.id, id);
  const student = await owned(db, "student", card.studentId, actor.school.id);
  if (["teacher", "class_teacher"].includes(actor.user.role)) {
    if (!student.streamId) throw new ApiError(404, "Student not found");
    await classAccess(db, actor, student.streamId);
  }
  const snapshot = card.status === "published" ? requirePublicationSnapshot(card.resultSnapshot) :
    await publicationSnapshot(db, actor.school.id, student.id, card.termId, card);
  // Intentionally no finance lookup or fee-dependent publication condition.
  const document = await savePdf({ ...actor, school: { ...actor.school, logoUrl: snapshot.school.logoUrl } }, "report_card", card.id, reportCardContent(snapshot, card.status === "published"));
  await db.reportCard.updateMany({ where: { id: card.id, schoolId: actor.school.id }, data: { fileId: document.id } });
  return document;
}
export function reportCardContent(snapshot: ReturnType<typeof requirePublicationSnapshot>, published: boolean): TDocumentDefinitions["content"] {
  const { term, results, ratings, attendance, comments } = snapshot;
  const learner = snapshot.student;
  const content: TDocumentDefinitions["content"] = [
    { text: snapshot.school.name, fontSize: 20, bold: true }, { text: `${term.name} learner report${published ? "" : " — DRAFT"}`, fontSize: 16 },
    { text: `${learner.firstName} ${learner.middleName ?? ""} ${learner.lastName} — ${learner.admissionNo}`, margin: [0, 12, 0, 12] },
    { text: `${learner.gradeName ?? ""} ${learner.streamName ?? ""}` },
    { table: { headerRows: 1, widths: ["*", "auto", "auto"], body: [["Learning area", "Percent", "Level"], ...results.map((r: any) => [r.learningArea, r.percent ?? "—", r.level ?? "Not assessed"])] } },
    { text: "Competencies and values", bold: true, margin: [0, 12, 0, 8] },
    ...ratings.map((r: any) => ({ text: `${r.category}: ${r.code.replace(/_/g, " ")} — ${r.level ?? "—"}` })),
    { text: `Attendance: ${attendance.filter((a: any) => ["present", "late"].includes(a.status)).length} attended of ${attendance.length} recorded school days`, margin: [0, 12, 0, 8] },
    { text: `Class teacher: ${comments.classTeacherComment ?? ""}` }, { text: `Head teacher: ${comments.headTeacherComment ?? ""}` },
    { text: `Next term opens: ${comments.nextTermOpeningDate ? new Date(comments.nextTermOpeningDate).toISOString().slice(0, 10) : "To be communicated"}`, margin: [0, 12, 0, 0] },
  ];
  return content;
}