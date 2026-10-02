import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, writers, readers, send, body, parse, audit, lock, owned, ApiError } from "../lib/core";
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
    await lock(tx, req.actor.school.id); await owned(tx, "guardian", guardianId, req.actor.school.id);
    const record = await tx.guardian.update({ where: { id: guardianId }, data, include: guardianInclude });
    await audit(tx, req.actor, "updated", "guardian", guardianId); return record;
  });
  send(res, "UpdateGuardian", guardianView(record));
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