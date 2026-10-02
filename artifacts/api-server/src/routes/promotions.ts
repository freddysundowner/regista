import { Router } from "express";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { admin, allow, body, send, lock, audit, ApiError } from "../lib/core";
import { promotionRoster, signPromotion, readPromotion } from "../lib/promotions";

const router = Router();
router.post("/promotions/preview", async (req, res) => {
  allow(req, admin); const input = body(z.PreviewPromotionBody, req.body);
  const result = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const roster = await promotionRoster(tx, req.actor, input);
    await audit(tx, req.actor, "promotion_previewed", "student_promotion", undefined, undefined, { ...input, studentCount: roster.records.length });
    return { previewToken: signPromotion(req.actor, input, roster.fingerprint), count: roster.records.length, students: roster.students };
  });
  send(res, "PreviewPromotion", result);
});
router.post("/promotions/commit", async (req, res) => {
  allow(req, admin); const confirmation = body(z.CommitPromotionBody, req.body);
  const { input, fingerprint } = readPromotion(req.actor, confirmation.previewToken);
  const result = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const roster = await promotionRoster(tx, req.actor, input);
    if (roster.fingerprint !== fingerprint) throw new ApiError(409, "Students or academic setup changed. Preview again.");
    const change = input.action === "graduate" ? { status: "graduated" } : { gradeId: roster.targetStream.gradeId as string, streamId: roster.targetStream.id as string };
    for (const student of roster.records) {
      const updated = await tx.student.update({ where: { id: student.id }, data: change });
      await audit(tx, req.actor, input.action === "graduate" ? "graduated" : "promoted", "student", student.id, student, { ...updated, sourceYearId: input.sourceYearId, targetYearId: input.targetYearId });
    }
    await audit(tx, req.actor, "promotion_committed", "student_promotion", undefined, undefined, { ...input, updatedStudents: roster.records.length });
    return { updatedStudents: roster.records.length };
  }, { timeout: 180000 });
  send(res, "CommitPromotion", result);
});
export default router;