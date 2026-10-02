import pdfmake from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { ApiError, audit, owned, type Actor } from "../core";
import { storedObject } from "../school-files";
import { financeTransaction, metadata, record } from "./posting";

pdfmake.addFonts({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(path => ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].includes(path));
export async function renderFinancePdf(content: TDocumentDefinitions["content"]) {
  return pdfmake.createPdf({ defaultStyle: { font: "Helvetica", fontSize: 10 }, content }).getBuffer();
}
export async function createDocument(actor: Actor, type: "receipt" | "statement", referenceId: string) {
  const schoolId = actor.school.id;
  let studentId = referenceId;
  let title: string;
  let rows: string[][];
  if (type === "receipt") {
    const payment = await record(db, schoolId, referenceId, "payment");
    studentId = payment.studentId!;
    const data = metadata(payment);
    title = `Receipt ${data.receiptNo}`;
    rows = [["Date", "Channel", "Reference", "Amount (KES)"], [
      payment.createdAt.toISOString().slice(0, 10), data.channel, data.providerTxnId, payment.amount.toFixed(2),
    ], ["Status", payment.status, "", ""]];
  } else {
    title = "Student account statement";
    const entries = await db.ledgerEntry.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    rows = [["Date", "Description", "Debit (KES)", "Credit (KES)"], ...entries.map(e => [e.createdAt.toISOString().slice(0, 10), e.description, e.debit.toFixed(2), e.credit.toFixed(2)])];
  }
  const student = await owned(db, "student", studentId, schoolId);
  const balance = await db.studentBalance.findFirst({ where: { schoolId, studentId } });
  const bytes = await renderFinancePdf([
      { text: actor.school.name, fontSize: 20, bold: true }, { text: title, fontSize: 16, margin: [0, 12, 0, 12] },
      { text: `${student.admissionNo} — ${student.firstName} ${student.lastName}`, margin: [0, 0, 0, 12] },
      { table: { headerRows: 1, widths: ["auto", "*", "auto", "auto"], body: rows } },
      { text: `Current balance: KES ${balance?.balance.toFixed(2) ?? "0.00"}`, bold: true, margin: [0, 18, 0, 0] },
      { text: "Negative balance represents credit. This document is generated from the append-only school ledger.", margin: [0, 10, 0, 0] },
    ]);
  const id = randomUUID(), key = `finance/${schoolId}/${id}.pdf`;
  await storedObject(key).save(bytes, { resumable: false, contentType: "application/pdf", metadata: { cacheControl: "private, no-store" } });
  await financeTransaction(actor, async tx => {
    await tx.storedFile.create({ data: {
      id, schoolId, ownerId: actor.user.id, entityType: `finance_${type}`, entityId: referenceId,
      objectKey: key, filename: `${type}-${id}.pdf`, contentType: "application/pdf", size: bytes.length, status: "ready",
    } });
    await audit(tx, actor, "generated", `finance_${type}`, id);
  });
  // A 24-hour private signed link is minted only after checking the authenticated
  // actor's school. Authenticated download remains available after expiry.
  const file = storedObject(key), expiresAt = new Date(Date.now() + 86400000).toISOString();
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: file.bucket.name, object_name: file.name, method: "GET", expires_at: expiresAt }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new ApiError(503, "PDF saved but signed download link could not be generated; use authenticated download");
  return { id, downloadUrl: (await response.json() as { signed_url: string }).signed_url, expiresAt };
}