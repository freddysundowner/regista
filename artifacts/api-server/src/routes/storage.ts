import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { ApiError, admin, writers, readers, allow, parse } from "../lib/core";
import { storedObject, uploadUrl, usesLocalStorage, validImage } from "../lib/school-files";
import { scope } from "../lib/students";
import { can, need } from "../lib/access";

const router = Router();
function uploader(req: Parameters<typeof allow>[0], purpose: string) {
  if (purpose === "finance_document") need(req, "expenses", "procurement");
  else allow(req, purpose === "school_logo" ? admin : writers);
}
const input = z.object({
  name: z.string().min(1).max(180), size: z.number().int().positive().max(5 * 1024 * 1024),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  purpose: z.enum(["school_logo", "student_photo", "finance_document"]), entityId: z.string().uuid(),
}).strict();
router.post("/storage/uploads", async (req, res) => {
  const data = parse(input, req.body), schoolId = req.actor.school.id;
  // Receipts and supplier invoices are attached before their record exists, so they belong to the school.
  if (data.purpose === "finance_document") { need(req, "expenses", "procurement"); if (data.entityId !== schoolId) throw new ApiError(404, "School not found"); }
  else allow(req, data.purpose === "school_logo" ? admin : writers);
  if (data.contentType === "application/pdf" && data.purpose !== "finance_document") throw new ApiError(400, "Photos must be JPEG, PNG or WebP images");
  if (data.purpose === "school_logo" && data.entityId !== schoolId) throw new ApiError(404, "School not found");
  if (data.purpose === "student_photo" && !await db.student.findFirst({ where: { id: data.entityId, schoolId } })) throw new ApiError(404, "Student not found");
  const id = randomUUID(), objectKey = `${schoolId}/${id}`;
  const signedUrl = await uploadUrl(objectKey, `/api/storage/uploads/${id}/content`);
  await db.storedFile.create({ data: { id, schoolId, ownerId: req.actor.user.id, entityType: data.purpose, entityId: data.entityId, objectKey, filename: data.name, size: data.size, contentType: data.contentType } });
  res.status(201).json({ id, uploadUrl: signedUrl, objectPath: `/api/storage/files/${id}` });
});
// When files stay on this server, the browser sends the bytes here instead of to a bucket URL.
router.put("/storage/uploads/:fileId/content", express.raw({ type: () => true, limit: 5 * 1024 * 1024 }), async (req, res) => {
  if (!usesLocalStorage()) throw new ApiError(404, "Upload not found");
  const id = parse(z.string().uuid(), req.params.fileId);
  const record = await db.storedFile.findFirst({ where: { id, schoolId: req.actor.school.id, ownerId: req.actor.user.id, status: { not: "ready" } } });
  if (!record) throw new ApiError(404, "Upload not found");
  uploader(req, record.entityType);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, "No file was sent");
  await storedObject(record.objectKey).save(req.body);
  res.status(204).end();
});
router.post("/storage/files/:fileId/complete", async (req, res) => {
  const id = parse(z.string().uuid(), req.params.fileId);
  const record = await db.storedFile.findFirst({ where: { id, schoolId: req.actor.school.id, ownerId: req.actor.user.id } });
  if (!record) throw new ApiError(404, "Upload not found");
  uploader(req, record.entityType);
  if (record.status === "ready") { res.json({ id, objectPath: `/api/storage/files/${id}` }); return; }
  const file = storedObject(record.objectKey);
  const [exists] = await file.exists();
  if (!exists) throw new ApiError(400, "Upload the file before completing");
  const [metadata] = await file.getMetadata();
  const [header] = await file.download({ start: 0, end: 15 });
  if (Number(metadata.size) !== record.size || Number(metadata.size) > 5 * 1024 * 1024 || !validImage(header, record.contentType)) {
    await file.delete();
    throw new ApiError(400, record.contentType === "application/pdf" ? "File contents or size do not match the PDF upload" : "File contents or size do not match the image upload");
  }
  // Publish a separate immutable object; the original signed PUT URL can be
  // reused until expiry and must never overwrite a verified, attached image.
  const objectKey = `${record.schoolId}/verified/${randomUUID()}`;
  const verified = storedObject(objectKey);
  await file.copy(verified);
  await verified.setMetadata({ contentType: record.contentType, cacheControl: "private, no-store" });
  await db.storedFile.update({ where: { id }, data: { status: "ready", objectKey } });
  await file.delete().catch(() => undefined);
  res.json({ id, objectPath: `/api/storage/files/${id}` });
});
router.get("/storage/files/:fileId", async (req, res, next) => {
  const id = parse(z.string().uuid(), req.params.fileId);
  const record = await db.storedFile.findFirst({ where: { id, schoolId: req.actor.school.id, status: "ready" } });
  if (!record) throw new ApiError(404, "File not found");
  if (record.entityType === "student_photo") {
    if (!await db.student.findFirst({ where: { ...scope(req), id: record.entityId } })) throw new ApiError(404, "Student not found");
  } else if (record.entityType === "finance_document") {
    if (!readers.includes(req.actor.user.role) && !["expenses", "procurement", "approve_lpo"].some(p => can(req.actor, p as "expenses"))) throw new ApiError(404, "File not found");
  } else if (record.entityType !== "school_logo") allow(req, readers);
  const file = storedObject(record.objectKey);
  if (!(await file.exists())[0]) throw new ApiError(404, "File not found");
  res.setHeader("Content-Type", record.contentType);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, no-store");
  file.createReadStream().on("error", next).pipe(res);
});
export default router;