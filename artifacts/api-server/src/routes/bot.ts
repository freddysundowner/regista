import { Router, type Request } from "express";
import { createHmac, randomInt } from "node:crypto";
import { db, Prisma } from "@workspace/db";
import { z } from "zod";
import { ApiError, parse, phone } from "../lib/core";
import { digest, encryptCredentials, equalSecret, integration, systemActor, verifySignature } from "../lib/integrations/security";
import { financeTransaction, view } from "../lib/finance/posting";
import { queueMessage } from "../lib/integrations/messages";
import { createDocument } from "../lib/finance/documents";
import { createPlan } from "../lib/payments/plans";
import { resolveException } from "../lib/payments/pipeline";
import { startStk } from "../lib/integrations/daraja";
import * as schemas from "@workspace/api-zod";
import { reportCardPdf, savePdf } from "../lib/academics/documents";
import { termResults } from "../lib/academics/service";
import { metadata } from "../lib/finance/posting";

declare global { namespace Express { interface Request { rawBody?: Buffer; botGuardianId?: string; botPhone?: string; botSecret?: string } } }
const router = Router();
router.use("/bot/v1", async (req, _res, next) => {
  try {
    const key = req.get("X-Api-Key"), timestamp = req.get("X-Timestamp"), signature = req.get("X-Signature");
    if (!key || !timestamp || !signature) throw new ApiError(401, "Bot authentication headers required");
    const config = await db.integrationConfig.findUnique({ where: { apiKeyHash: digest(key) } });
    if (!config?.enabled || config.provider !== "bot") throw new ApiError(401, "Invalid bot API key");
    const { credentials } = await integration(config.schoolId, "bot");
    const guardianPhone = phone(req.get("X-Guardian-Phone") ?? req.body?.phone ?? "");
    // Bind method, target and identity, not merely an interchangeable empty GET body.
    const canonical = Buffer.concat([Buffer.from(`${req.method}.${req.originalUrl}.${guardianPhone}.`), req.rawBody ?? Buffer.alloc(0)]);
    verifySignature(credentials.hmacSecret, timestamp, canonical, signature);
    try { await db.botReplay.create({ data: { schoolId: config.schoolId, signatureHash: digest(signature), expiresAt: new Date(Date.now() + 600000) } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409, "Request replay detected"); throw error; }
    const guardian = await db.guardian.findUnique({ where: { schoolId_phone: { schoolId: config.schoolId, phone: guardianPhone } } });
    if (!guardian || guardian.anonymizedAt) throw new ApiError(404, "unknown_guardian");
    req.actor = await systemActor(config.schoolId); req.botGuardianId = guardian.id; req.botPhone = guardianPhone; req.botSecret = credentials.hmacSecret;
    next();
  } catch (error) { next(error); }
});
async function child(req: Request, studentId: string, sensitive = false) {
  const link = await db.studentGuardian.findFirst({ where: { schoolId: req.actor.school.id, guardianId: req.botGuardianId!, studentId }, include: { student: true } });
  if (!link) throw new ApiError(404, "Child not found");
  if (sensitive) {
    const verification = await db.guardianVerification.findUnique({ where: { schoolId_guardianId: { schoolId: req.actor.school.id, guardianId: req.botGuardianId! } } });
    if (!verification?.verifiedUntil || verification.verifiedUntil < new Date()) throw new ApiError(403, "OTP verification required");
  }
  return link.student;
}
router.post("/bot/v1/identify", async (req, res) => {
  const links = await db.studentGuardian.findMany({ where: { schoolId: req.actor.school.id, guardianId: req.botGuardianId! }, include: { student: { include: { grade: true } } } });
  res.json({ guardianId: req.botGuardianId, children: links.map(l => ({ id: l.studentId, name: `${l.student.firstName} ${l.student.lastName}`, admissionNo: l.student.admissionNo, grade: l.student.grade?.name ?? "" })) });
});
router.post("/bot/v1/otp/request", async (req, res) => {
  await integration(req.actor.school.id, "africastalking");
  await financeTransaction(req.actor, async tx => {
    const prior = await tx.guardianVerification.findUnique({ where: { schoolId_guardianId: { schoolId: req.actor.school.id, guardianId: req.botGuardianId! } } });
    if (prior && prior.updatedAt.getTime() > Date.now() - 60000) throw new ApiError(429, "Wait one minute before requesting another code");
    const code = String(randomInt(100000, 1000000));
    const codeHash = createHmac("sha256", req.botSecret!).update(`${req.botGuardianId}:${code}`).digest("hex");
    const data = { codeHash, attempts: 0, expiresAt: new Date(Date.now() + 600000), verifiedUntil: null };
    const verification = await tx.guardianVerification.upsert({ where: { schoolId_guardianId: { schoolId: req.actor.school.id, guardianId: req.botGuardianId! } }, create: { schoolId: req.actor.school.id, guardianId: req.botGuardianId!, ...data }, update: data });
    await queueMessage(tx, req.actor.school.id, { guardianId: req.botGuardianId, phone: req.botPhone!, channel: "sms", template: "otp", content: encryptCredentials({ content: `Your school verification code is ${code}. Valid for 10 minutes.` }), idempotencyKey: `otp:${verification.id}:${verification.updatedAt.toISOString()}` });
  });
  res.json({ status: "queued", message: "Verification code queued for the guardian phone on record" });
});
router.post("/bot/v1/otp/verify", async (req, res) => {
  const input = parse(schemas.VerifyBotOtpBody, req.body);
  const verified = await financeTransaction(req.actor, async tx => {
    const verification = await tx.guardianVerification.findUnique({ where: { schoolId_guardianId: { schoolId: req.actor.school.id, guardianId: req.botGuardianId! } } });
    if (!verification || verification.expiresAt < new Date() || verification.attempts >= 5) return false;
    const expected = createHmac("sha256", req.botSecret!).update(`${req.botGuardianId}:${input.code}`).digest("hex");
    const success = equalSecret(expected, verification.codeHash);
    await tx.guardianVerification.update({ where: { id: verification.id }, data: { attempts: { increment: 1 }, ...(success ? { verifiedUntil: new Date(Date.now() + 86400000), expiresAt: new Date(0) } : {}) } });
    return success;
  });
  if (!verified) throw new ApiError(403, "Invalid, expired or exhausted verification code");
  res.json({ status: "verified" });
});
router.get("/bot/v1/students/:id/balance", async (req, res) => {
  const student = await child(req, String(req.params.id));
  const balance = await db.studentBalance.findFirst({ where: { schoolId: req.actor.school.id, studentId: student.id } });
  const lastPayment = await db.financeRecord.findFirst({ where: { schoolId: req.actor.school.id, studentId: student.id, kind: "payment" }, orderBy: { createdAt: "desc" }, select: { amount: true, createdAt: true, status: true } });
  res.json(view({ balance: balance?.balance ?? "0.00", lastPayment }));
});
router.get("/bot/v1/students/:id/statement", async (req, res) => {
  await child(req, String(req.params.id), true);
  res.json(await createDocument(req.actor, "statement", String(req.params.id)));
});
router.post("/bot/v1/students/:id/results", async (req, res) => {
  await child(req, String(req.params.id), true);
  const input = parse(z.object({ termId: z.string().uuid() }), req.body);
  const card = await db.reportCard.findUnique({ where: { schoolId_studentId_termId: { schoolId: req.actor.school.id, studentId: String(req.params.id), termId: input.termId } } });
  if (card?.status !== "published") throw new ApiError(404, "Published term results not found");
  res.json(view(card.resultSnapshot ?? await termResults(db, req.actor.school.id, String(req.params.id), input.termId)));
});
router.get("/bot/v1/report-cards/:id", async (req, res) => {
  const card = await db.reportCard.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id, status: "published" } });
  if (!card) throw new ApiError(404, "Published report card not found");
  await child(req, card.studentId, true);
  res.json(await reportCardPdf(req.actor, card.id));
});
router.get("/bot/v1/receipts/:id", async (req, res) => {
  const receipt = await db.financeRecord.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id, kind: "payment", status: "posted" } });
  if (!receipt?.studentId) throw new ApiError(404, "Receipt not found");
  await child(req, receipt.studentId, true);
  res.json(await createDocument(req.actor, "receipt", receipt.id));
});
router.get("/bot/v1/invoices/:id", async (req, res) => {
  const invoice = await db.financeRecord.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id, kind: "invoice", status: { not: "cancelled" } } });
  if (!invoice?.studentId) throw new ApiError(404, "Invoice not found");
  const student = await child(req, invoice.studentId, true);
  const lines = await db.invoiceLine.findMany({ where: { schoolId: req.actor.school.id, invoiceId: invoice.id } });
  res.json(await savePdf(req.actor, "invoice", invoice.id, [
    { text: req.actor.school.name, fontSize: 20 }, { text: `Invoice ${metadata(invoice).invoiceNo}`, fontSize: 16 },
    { text: `${student.firstName} ${student.lastName} — ${student.admissionNo}` },
    { table: { body: [["Item", "Amount (KES)"], ...lines.map(l => [l.description, l.amount.toFixed(2)])] } },
    { text: `Total KES ${invoice.amount.toFixed(2)}` },
  ]));
});
router.get("/bot/v1/students/:id/documents", async (req, res) => {
  await child(req, String(req.params.id), true);
  const where = { schoolId: req.actor.school.id, studentId: String(req.params.id) };
  res.json({
    invoices: await db.financeRecord.findMany({ where: { ...where, kind: "invoice", status: { not: "cancelled" } }, select: { id: true, createdAt: true } }),
    receipts: await db.financeRecord.findMany({ where: { ...where, kind: "payment", status: "posted" }, select: { id: true, createdAt: true } }),
    reportCards: await db.reportCard.findMany({ where: { ...where, status: "published" }, select: { id: true, termId: true } }),
  });
});
router.post("/bot/v1/students/:id/attendance", async (req, res) => {
  await child(req, String(req.params.id), true);
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }), req.body);
  const start = new Date(`${month}-01`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  res.json(view(await db.attendanceRecord.findMany({ where: { schoolId: req.actor.school.id, studentId: String(req.params.id), date: { gte: start, lt: end } }, select: { date: true, status: true } })));
});
router.post("/bot/v1/payments/stk", async (req, res) => {
  const input = parse(schemas.StartStkPaymentBody, req.body);
  await child(req, input.studentId);
  if (phone(input.phone) !== req.botPhone) throw new ApiError(403, "STK phone must be the authenticated guardian");
  res.json(view(await startStk(req.actor, input)));
});
router.get("/bot/v1/payments/:id/status", async (req, res) => {
  const request = await db.stkRequest.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id } });
  if (!request) throw new ApiError(404, "STK request not found");
  await child(req, request.studentId);
  if (request.phone !== req.botPhone) throw new ApiError(404, "STK request not found");
  res.json(view(request));
});
router.get("/bot/v1/unmatched/pending", async (req, res) => {
  const payments = await db.incomingPayment.findMany({ where: { schoolId: req.actor.school.id, payerPhone: req.botPhone, status: "unmatched" }, select: { id: true } });
  res.json(view(await db.matchException.findMany({ where: { schoolId: req.actor.school.id, paymentId: { in: payments.map(p => p.id) }, status: "open" } })));
});
router.post("/bot/v1/unmatched/:id/resolve", async (req, res) => {
  const input = parse(schemas.ResolvePaymentExceptionBody, req.body);
  if (!["assign", "split"].includes(input.action) || !input.allocations?.length) throw new ApiError(400, "Parent may only assign or split");
  const exception = await db.matchException.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id } });
  const payment = exception && await db.incomingPayment.findFirst({ where: { id: exception.paymentId, schoolId: req.actor.school.id, payerPhone: req.botPhone } });
  if (!payment) throw new ApiError(404, "Payment not found");
  for (const allocation of input.allocations) await child(req, allocation.studentId, true);
  res.json(await resolveException(req.actor, exception!.id, { ...input, learnAlias: false }));
});
router.post("/bot/v1/payment-plans/request", async (req, res) => {
  const input = parse(schemas.CreatePaymentPlanBody, req.body);
  await child(req, input.studentId, true);
  res.json(view(await createPlan(req.actor, input, "bot")));
});
router.get("/bot/v1/students/:id/attendance", async (req, res) => {
  await child(req, String(req.params.id), true);
  const month = parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), req.query.month);
  const start = new Date(`${month}-01`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  res.json(view(await db.attendanceRecord.findMany({ where: { schoolId: req.actor.school.id, studentId: String(req.params.id), date: { gte: start, lt: end } }, select: { date: true, status: true } })));
});
router.get("/bot/v1/school/info", async (req, res) => {
  const { name, phone, email, address } = req.actor.school;
  const config = await db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId: req.actor.school.id, provider: "daraja" } }, select: { publicConfig: true } });
  res.json({ name, phone, email, address, paybill: (config?.publicConfig as any)?.shortcode ?? null, terms: await db.term.findMany({ where: { schoolId: req.actor.school.id }, select: { name: true, startDate: true, endDate: true } }) });
});
export default router;