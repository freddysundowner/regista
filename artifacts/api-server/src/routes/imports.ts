import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { allow, writers, send, body, lock, audit } from "../lib/core";
import { importPreview, createStudentRecord } from "../lib/students";
const router = Router();
router.post("/imports/students/preview", async (req, res) => {
  allow(req, writers); const { rows } = body(z.PreviewStudentImportBody, req.body);
  const { preview } = await db.$transaction(tx => importPreview(tx, req.actor, rows), { timeout: 30000 });
  send(res, "PreviewStudentImport", preview);
});
router.post("/imports/students/commit", async (req, res) => {
  allow(req, writers); const { rows } = body(z.CommitStudentImportBody, req.body);
  const result = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const { inputs, preview } = await importPreview(tx, req.actor, rows);
    let createdStudents = 0, linkedGuardians = 0, siblingGroupsCreated = 0;
    for (const input of inputs) {
      if (!input) continue;
      const record = await createStudentRecord(tx, req.actor, input);
      createdStudents++; linkedGuardians += record.linkedGuardians;
      if (record.groupCreated) siblingGroupsCreated++;
    }
    await audit(tx, req.actor, "committed", "student_import", undefined, undefined, { createdStudents, linkedGuardians, siblingGroupsCreated, skippedRows: preview.totalRows - createdStudents });
    return { createdStudents, linkedGuardians, siblingGroupsCreated, skippedRows: preview.totalRows - createdStudents };
  }, { timeout: 180000, maxWait: 20000 });
  send(res, "CommitStudentImport", result);
});
export default router;