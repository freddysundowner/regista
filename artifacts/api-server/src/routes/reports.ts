import { Router } from "express";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import { GetSchoolReportBody } from "@workspace/api-zod";
import { ApiError, allow, admin, body, readers } from "../lib/core";
import { schoolReport } from "../lib/reports";
import { savePdf, saveDocument } from "../lib/academics/documents";
import { financeBoss } from "../jobs/finance";
import { view } from "../lib/finance/posting";
import { termResults } from "../lib/academics/service";
import { z } from "zod";

const router = Router();
router.post("/academics/knec/export", async (req, res) => {
  allow(req, ["school_admin", "super_admin", "principal"]);
  const input = body(z.object({ termId: z.string().uuid(), gradeId: z.string().uuid().optional(), format: z.enum(["csv", "xlsx"]) }).strict(), req.body);
  const term = await db.term.findFirst({ where: { id: input.termId, schoolId: req.actor.school.id } });
  if (!term) throw new ApiError(404, "Term not found");
  const keys: string[] = (req.actor.school.settings as any).knecColumns ?? ["admissionNo", "upi", "studentName", "learningArea", "percent", "level", "term"];
  if (!keys.length || new Set(keys).size !== keys.length || keys.some(k => !["admissionNo", "upi", "studentName", "learningArea", "percent", "level", "term"].includes(k))) throw new ApiError(400, "Invalid KNEC column mapping");
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("School export");
  sheet.columns = keys.map(key => ({ header: key, key, width: 24 }));
  for (const student of await db.student.findMany({ where: { schoolId: req.actor.school.id, gradeId: input.gradeId } })) {
    for (const result of await termResults(db, req.actor.school.id, student.id, term.id)) {
      const row: Record<string, string> = { admissionNo: student.admissionNo, upi: student.upi ?? "", studentName: `${student.firstName} ${student.lastName}`, learningArea: result.learningArea, percent: result.percent ?? "", level: result.level ?? "", term: term.name };
      sheet.addRow(Object.fromEntries(keys.map(k => [k, /^[=+@-]/.test(row[k]) ? `'${row[k]}` : row[k]])));
    }
  }
  const bytes = input.format === "xlsx" ? await workbook.xlsx.writeBuffer() : await workbook.csv.writeBuffer();
  res.json(await saveDocument(req.actor, "knec_export", term.id, Buffer.from(bytes), input.format, input.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv"));
});
router.post("/reports/:type", async (req, res) => {
  res.json(await schoolReport(req.actor, String(req.params.type), body(GetSchoolReportBody, req.body)));
});
router.post("/reports/:type/export", async (req, res) => {
  const input = body(GetSchoolReportBody, req.body);
  const report = await schoolReport(req.actor, String(req.params.type), input);
  if (input.format === "pdf") {
    res.json(await savePdf(req.actor, "school_report", input.studentId ?? randomUUID(), [
      { text: req.actor.school.name, fontSize: 18 }, { text: report.title, fontSize: 14, margin: [0, 8, 0, 8] },
      { table: { headerRows: 1, body: report.columns.length ? [report.columns.map(c => c.label), ...report.rows.map(row => report.columns.map(c => String(row[c.key] ?? "")))] : [["No matching records"]] }, fontSize: 8 },
    ])); return;
  }
  if (input.format === "xlsx" || input.format === "csv") {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Report");
    sheet.columns = report.columns.map(c => ({ header: c.label, key: c.key, width: 22 }));
    for (const row of report.rows) sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && /^[=+@-]/.test(value) ? `'${value}` : value])));
    const bytes = input.format === "xlsx" ? await workbook.xlsx.writeBuffer() : await workbook.csv.writeBuffer();
    res.json(await saveDocument(req.actor, "school_report", input.studentId ?? randomUUID(), Buffer.from(bytes), input.format, input.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv")); return;
  }
  throw new ApiError(400, "Export format must be pdf, xlsx or csv");
});
router.get("/approvals/inbox", async (req, res) => {
  allow(req, ["school_admin", "super_admin", "principal", "bursar"]);
  const schoolId = req.actor.school.id;
  const [finance, plans, collectionRefunds] = await Promise.all([
    db.financeRecord.findMany({ where: { schoolId, status: "pending" }, orderBy: { createdAt: "asc" } }),
    db.paymentPlan.findMany({ where: { schoolId, status: "proposed" }, orderBy: { createdAt: "asc" } }),
    db.collectionRefund.findMany({ where: { schoolId, status: "pending" }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json(view([...finance.map(f => ({ id: f.id, type: f.kind, studentId: f.studentId, amount: f.amount, requestedBy: f.requestedBy, createdAt: f.createdAt, canApprove: f.requestedBy !== req.actor.user.id && req.actor.user.role !== "bursar" })), ...plans.map(p => ({ id: p.id, type: "payment_plan", studentId: p.studentId, amount: p.totalAmount, requestedBy: p.requestedBy, createdAt: p.createdAt, canApprove: p.requestedBy !== req.actor.user.id && req.actor.user.role !== "bursar" })), ...collectionRefunds.map(r => ({ id: r.id, type: "collection_refund", studentId: null, amount: r.amount, requestedBy: r.requestedBy, createdAt: r.createdAt, canApprove: r.requestedBy !== req.actor.user.id && req.actor.user.role !== "bursar" }))]));
});
router.get("/jobs/failed", async (req, res) => {
  allow(req, admin);
  // Global scheduler jobs carry no tenant payload. Tenant-specific diagnostics remain scoped.
  const jobs = req.actor.user.role === "super_admin" ? await db.$queryRaw`SELECT id,name,state,retry_count AS "retryCount",completed_on AS "completedAt" FROM pgboss.job WHERE state='failed' ORDER BY completed_on DESC LIMIT 100` : [];
  const messages = await db.messageDelivery.findMany({ where: { schoolId: req.actor.school.id, status: "failed" }, select: { id: true, template: true, status: true, error: true, attempts: true } });
  const integrations = await db.integrationEvent.findMany({ where: { schoolId: req.actor.school.id, status: { in: ["failed", "unavailable"] } }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json(view({ jobs, integrations, messages }));
});
router.post("/jobs/:id/retry", async (req, res) => {
  allow(req, admin);
  const message = await db.messageDelivery.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id, status: "failed" } });
  if (message) {
    if (message.template === "otp") throw new ApiError(409, "Request a fresh OTP rather than retrying an expired code");
    await db.messageDelivery.update({ where: { id: message.id }, data: { status: "queued", attempts: 0, error: null } });
    res.json({ id: message.id, status: "queued" }); return;
  }
  allow(req, ["super_admin"]);
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT name FROM pgboss.job WHERE id=${String(req.params.id)}::uuid AND state='failed'`;
  if (!rows[0]) throw new ApiError(404, "Failed job not found");
  const allowed = ["payment-pipeline", "message-delivery", "school-daily", "payment-followup", "daily-reconciliation", "notification-outbox", "finance-nightly", "finance-receipts"];
  if (!allowed.includes(rows[0].name)) throw new ApiError(403, "Job retry not permitted");
  const boss = financeBoss();
  try { await boss.start(); const id = await boss.send(rows[0].name, {}); res.json({ id, status: "queued" }); }
  finally { await boss.stop(); }
});
export default router;