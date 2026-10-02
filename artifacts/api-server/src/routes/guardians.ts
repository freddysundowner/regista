import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, writers, readers, admin, send, body, parse, audit, lock, owned, ApiError } from "../lib/core";
import { guardianData, fullName } from "../lib/students";
const router = Router();
const guardianInclude = { students: { include: { student: true } } } as const;
const guardianView = (g: any) => ({ ...g, studentCount: g.students.length, studentNames: g.students.map((l: any) => fullName(l.student)) });
router.get("/guardians", async (req, res) => {
  allow(req, readers); const { search } = parse(z.ListGuardiansQueryParams, req.query);
  if (search && search.length > 180) throw new ApiError(400, "Search is too long");
  send(res, "ListGuardians", (await db.guardian.findMany({ where: { schoolId: req.actor.school.id,
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] } : {}) },
    include: guardianInclude, orderBy: { name: "asc" }, take: 10000 })).map(guardianView));
});
router.post("/guardians", async (req, res) => {
  allow(req, writers); const data = guardianData(body(z.CreateGuardianBody, req.body));
  const record = await db.$transaction(async tx => {
    const record = await tx.guardian.create({ data: { ...data, schoolId: req.actor.school.id }, include: guardianInclude });
    await audit(tx, req.actor, "created", "guardian", record.id); return record;
  });
  send(res, "CreateGuardian", guardianView(record), 201);
});
router.patch("/guardians/:guardianId", async (req, res) => {
  allow(req, writers); const { guardianId } = parse(z.UpdateGuardianParams, req.params); const data = guardianData(body(z.UpdateGuardianBody, req.body));
  const record = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id); const old = await owned(tx, "guardian", guardianId, req.actor.school.id);
    if (old.anonymizedAt) throw new ApiError(409, "An anonymized guardian cannot be edited");
    if (data.phone !== undefined && data.phone !== old.phone) {
      await tx.guardianVerification.deleteMany({ where: { schoolId: req.actor.school.id, guardianId } });
      await tx.messageDelivery.updateMany({ where: { schoolId: req.actor.school.id, guardianId, status: { in: ["queued", "failed"] } }, data: { status: "cancelled", error: "Guardian phone changed; recipient authorization revoked" } });
      data.whatsappLastInboundAt = null;
      await audit(tx, req.actor, "verification_revoked", "guardian", guardianId);
    }
    const record = await tx.guardian.update({ where: { id: guardianId }, data, include: guardianInclude });
    await audit(tx, req.actor, "updated", "guardian", guardianId); return record;
  });
  send(res, "UpdateGuardian", guardianView(record));
});
router.get("/guardians/:guardianId/export", async (req, res) => {
  allow(req, admin); const { guardianId } = parse(z.ExportGuardianParams, req.params);
  const result = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    await owned(tx, "guardian", guardianId, req.actor.school.id);
    const guardian = await tx.guardian.findFirstOrThrow({ where: { id: guardianId, schoolId: req.actor.school.id }, include: guardianInclude });
    await audit(tx, req.actor, "privacy_exported", "guardian", guardianId, undefined, { guardianId });
    return { guardian: guardianView(guardian), links: guardian.students, exportedAt: new Date() };
  });
  res.set("Cache-Control", "no-store"); send(res, "ExportGuardian", result);
});
router.post("/guardians/:guardianId/anonymize", async (req, res) => {
  allow(req, admin); const { guardianId } = parse(z.AnonymizeGuardianParams, req.params);
  body(z.AnonymizeGuardianBody, req.body);
  const guardian = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const old = await owned(tx, "guardian", guardianId, req.actor.school.id);
    if (old.anonymizedAt) throw new ApiError(409, "Guardian is already anonymized");
    await tx.guardianVerification.deleteMany({ where: { schoolId: req.actor.school.id, guardianId } });
    await tx.messageDelivery.updateMany({ where: { schoolId: req.actor.school.id, guardianId, status: { in: ["queued", "failed"] } }, data: { status: "cancelled", error: "Guardian anonymized" } });
    // Retain stable IDs and links. No student, invoice, payment or ledger deletion.
    const links = await tx.studentGuardian.findMany({ where: { guardianId, schoolId: req.actor.school.id } });
    await tx.studentGuardian.updateMany({ where: { guardianId, schoolId: req.actor.school.id }, data: { receivesNotifications: false, relationship: "Guardian" } });
    for (const link of links) await audit(tx, req.actor, "privacy_updated", "student_guardian", link.id, { receivesNotifications: link.receivesNotifications }, { receivesNotifications: false, relationship: "Guardian" });
    const updated = await tx.guardian.update({ where: { id: guardianId }, data: {
      name: "Anonymized guardian", phone: `anonymous:${guardianId}`, altPhone: null, email: null, idNumber: null, relationship: null, anonymizedAt: new Date(), whatsappLastInboundAt: null,
    }, include: guardianInclude });
    await audit(tx, req.actor, "anonymized", "guardian", guardianId, old, updated);
    return updated;
  });
  send(res, "AnonymizeGuardian", guardianView(guardian));
});
router.get("/families", async (req, res) => {
  allow(req, readers);
  const families = await db.family.findMany({ where: { schoolId: req.actor.school.id }, include: { students: { include: { grade: true, guardians: { include: { guardian: true } } } } }, take: 10000, orderBy: { name: "asc" } });
  send(res, "ListFamilies", families.map(f => ({ id: f.id, name: f.name,
    guardianNames: [...new Set(f.students.flatMap(s => s.guardians.map(l => l.guardian.name)))],
    students: f.students.map(s => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, gradeName: s.grade?.name ?? null })),
  })));
});
export default router;