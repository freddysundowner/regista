import { Router, type IRouter } from "express";
import { refreshSponsorBatch } from "../lib/payments/settlements";
import { db } from "@workspace/db";
import {
  CreateFinanceRecordBody, DecideFinanceRecordBody, PreviewFinanceInvoicesBody,
  CommitFinanceInvoicesBody, CreateFinanceDocumentBody,
  UpdateFinanceRecordBody,
} from "@workspace/api-zod";
import { allow, readers, writers, admin, body, owned, ApiError, audit } from "../lib/core";
import { financeTransaction, view, record, metadata, json } from "../lib/finance/posting";
import { createRecord, decideRecord, invoiceBatch } from "../lib/finance/service";
import { createDocument } from "../lib/finance/documents";
import { sum } from "../lib/finance/money";
import { storedObject } from "../lib/school-files";
import { z } from "zod";

const router: IRouter = Router();
router.get("/finance/records", async (req, res) => {
  allow(req, readers);
  const schoolId = req.actor.school.id;
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
  if (studentId) await owned(db, "student", studentId, schoolId);
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const query = body(z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).default(50), status: z.string().optional(), search: z.string().optional(), id: z.string().uuid().optional() }), req.query);
  const matches = query.search ? await db.student.findMany({ where: { schoolId, OR: ["firstName", "lastName", "admissionNo"].map(key => ({ [key]: { contains: query.search, mode: "insensitive" } })) }, select: { id: true } }) : [];
  const where = { schoolId, studentId, kind, status: query.status || undefined, id: query.id, ...(query.search ? { OR: [{ studentId: { in: matches.map(s => s.id) } }, { data: { path: ["invoiceNo"], string_contains: query.search } }, { data: { path: ["receiptNo"], string_contains: query.search } }] } : {}) };
  res.set("X-Total-Count", String(await db.financeRecord.count({ where })));
  res.json(view(await db.financeRecord.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) })));
});
router.get("/finance/records/:id", async (req, res) => {
  allow(req, readers);
  res.json(view(await record(db, req.actor.school.id, String(req.params.id))));
});
router.post("/finance/records", async (req, res) => {
  const input = body(CreateFinanceRecordBody, req.body);
  res.json(view(await financeTransaction(req.actor, tx => createRecord(tx, req.actor, input))));
});
router.patch("/finance/records/:id", async (req, res) => {
  allow(req, writers);
  const input = body(UpdateFinanceRecordBody, req.body);
  const result = await financeTransaction(req.actor, async tx => {
    const original = await record(tx, req.actor.school.id, String(req.params.id));
    const allowed: Record<string, string[]> = { fee_item: ["name", "priority"], sponsor: ["name", "contact"], optional_charge: ["endDate"] };
    if (!allowed[original.kind]) throw new ApiError(409, "Financial records cannot be edited; use versioning or a maker-checker reversal");
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "reason") continue;
      if (!allowed[original.kind].includes(key)) throw new ApiError(400, `${key} cannot be changed for ${original.kind}`);
      patch[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
    if (patch.endDate && String(patch.endDate) < metadata(original).startDate) throw new ApiError(400, "End date precedes start date");
    const updated = await tx.financeRecord.update({ where: { id: original.id }, data: { data: json({ ...metadata(original), ...patch }) } });
    await audit(tx, req.actor, "updated", original.kind, original.id, view(original), { ...view(updated), reason: input.reason });
    return updated;
  });
  res.json(view(result));
});
router.post("/finance/records/:id/decision", async (req, res) => {
  const input = body(DecideFinanceRecordBody, req.body);
  res.json(view(await financeTransaction(req.actor, async tx => {
    const result = await decideRecord(tx, req.actor, String(req.params.id), input.decision, input.reason);
    await refreshSponsorBatch(tx, req.actor, String(req.params.id));
    return result;
  })));
});
router.post("/finance/invoices/preview", async (req, res) => {
  allow(req, writers);
  const input = body(PreviewFinanceInvoicesBody, req.body);
  res.json(view(await financeTransaction(req.actor, tx => invoiceBatch(tx, req.actor, input, false))));
});
router.post("/finance/invoices/commit", async (req, res) => {
  allow(req, writers);
  const input = body(CommitFinanceInvoicesBody, req.body);
  res.json(view(await financeTransaction(req.actor, tx => invoiceBatch(tx, req.actor, input, true, typeof req.body.previewToken === "string" ? req.body.previewToken : undefined))));
});
router.get("/finance/overview", async (req, res) => {
  allow(req, readers);
  const schoolId = req.actor.school.id;
  const [entries, balances, pendingApprovals] = await Promise.all([
    db.ledgerEntry.findMany({ where: { schoolId } }), db.studentBalance.findMany({ where: { schoolId } }),
    db.financeRecord.count({ where: { schoolId, status: "pending" } }),
  ]);
  res.json({
    invoiced: sum(entries.filter(e => e.type === "invoice").map(e => e.debit)).toFixed(2),
    collected: sum(entries.filter(e => e.type === "payment").map(e => e.credit)).minus(sum(entries.filter(e => e.type === "refund" || (e.type === "reversal" && entries.some(original => original.id === e.reversesId && original.type === "payment"))).map(e => e.debit))).toFixed(2),
    outstanding: sum(balances.filter(b => b.balance.isPositive()).map(b => b.balance)).toFixed(2),
    credit: sum(balances.filter(b => b.balance.isNegative()).map(b => b.balance.negated())).toFixed(2), pendingApprovals,
  });
});
router.get("/finance/students/:id/history", async (req, res) => {
  allow(req, readers);
  const schoolId = req.actor.school.id, studentId = String(req.params.id);
  await owned(db, "student", studentId, schoolId);
  const [balance, records, ledger, allocations] = await Promise.all([
    db.studentBalance.findFirst({ where: { schoolId, studentId } }),
    db.financeRecord.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: "asc" } }),
    db.ledgerEntry.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: "asc" } }),
    db.feeAllocation.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json(view({ balance: balance?.balance.toFixed(2) ?? "0.00", records, ledger, allocations }));
});
router.post("/finance/documents", async (req, res) => {
  allow(req, readers);
  const input = body(CreateFinanceDocumentBody, req.body);
  res.json(await createDocument(req.actor, input.type, input.referenceId));
});
router.get("/finance/documents/:id/download", async (req, res) => {
  allow(req, readers);
  const file = await db.storedFile.findFirst({ where: { id: String(req.params.id), schoolId: req.actor.school.id, entityType: { startsWith: "finance_" }, status: "ready" } });
  if (!file) throw new ApiError(404, "Document not found");
  res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${file.filename}"` });
  const [bytes] = await storedObject(file.objectKey).download();
  res.send(bytes);
});
router.get("/finance/jobs/failed", async (req, res) => {
  allow(req, admin);
  // Global job diagnostics contain no student payload. Tenant mismatch details
  // remain exclusively in the tenant-scoped audit log.
  const jobs = await db.$queryRaw`
    SELECT id,name,state,retry_count AS "retryCount",completed_on AS "completedAt"
    FROM pgboss.job WHERE name IN ('finance-nightly','finance-receipts') AND state='failed'
    ORDER BY completed_on DESC LIMIT 100`;
  res.json(view(jobs));
});
export default router;