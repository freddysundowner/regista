import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import * as z from "@workspace/api-zod";
import { ApiError, owned, type Tx, type Actor } from "./core";
import { fullName } from "./students";

export type PromotionInput = ReturnType<typeof z.PreviewPromotionBody.parse>;
export async function promotionRoster(tx: Tx, actor: Actor, input: PromotionInput) {
  const schoolId = actor.school.id;
  const sourceYear = await owned(tx, "academicYear", input.sourceYearId, schoolId);
  const targetYear = await owned(tx, "academicYear", input.targetYearId, schoolId);
  if (sourceYear.id === targetYear.id || targetYear.startDate <= sourceYear.endDate) throw new ApiError(400, "Target academic year must start after the source year ends");
  const sourceStream = await owned(tx, "stream", input.sourceStreamId, schoolId);
  let targetStream: any = null;
  if (input.action === "promote") {
    if (!input.targetStreamId) throw new ApiError(400, "Choose a target stream for promotion");
    targetStream = await owned(tx, "stream", input.targetStreamId, schoolId);
    const [sourceGrade, targetGrade] = await Promise.all([
      owned(tx, "grade", sourceStream.gradeId, schoolId), owned(tx, "grade", targetStream.gradeId, schoolId),
    ]);
    if (targetGrade.order <= sourceGrade.order) throw new ApiError(400, "Promotion must move to a higher grade");
  } else if (input.targetStreamId) throw new ApiError(400, "Graduation cannot specify a target stream");
  const records = await tx.student.findMany({ where: { schoolId, streamId: sourceStream.id, status: "active" }, include: { grade: true }, orderBy: { id: "asc" } });
  if (!records.length) throw new ApiError(409, "No active students to promote");
  if (await tx.auditLog.count({ where: { schoolId, action: { in: ["promoted", "graduated"] }, entityType: "student", entityId: { in: records.map(s => s.id) }, after: { path: ["sourceYearId"], equals: input.sourceYearId } } })) {
    throw new ApiError(409, "This roster includes students already promoted for the source academic year");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    input, sourceYear, targetYear, sourceStream, targetStream,
    records: records.map(s => [s.id, s.updatedAt.toISOString(), s.gradeId, s.streamId, s.status]),
  })).digest("hex");
  return { records, targetStream, fingerprint, students: records.map(s => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, gradeName: s.grade?.name ?? null })) };
}
export function signPromotion(actor: Actor, input: PromotionInput, fingerprint: string) {
  return jwt.sign({ schoolId: actor.school.id, input, fingerprint }, process.env.SESSION_SECRET!, { algorithm: "HS256", expiresIn: "15m", subject: actor.user.id, issuer: "school-api", audience: "promotion-preview" });
}
export function readPromotion(actor: Actor, token: string): { input: PromotionInput; fingerprint: string } {
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET!, { algorithms: ["HS256"], issuer: "school-api", audience: "promotion-preview", subject: actor.user.id });
    if (typeof payload === "string" || payload.schoolId !== actor.school.id || typeof payload.fingerprint !== "string") throw new Error();
    return { input: z.PreviewPromotionBody.parse(payload.input), fingerprint: payload.fingerprint };
  } catch { throw new ApiError(400, "Promotion preview is invalid or expired. Preview again."); }
}