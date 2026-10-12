import pdfmake from "pdfmake";
import type { Content, DynamicContent, TDocumentDefinitions } from "pdfmake/interfaces";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { ApiError, audit, owned, type Actor } from "../core";
import { readUrl, storedObject } from "../school-files";
import { financeTransaction, metadata, record } from "./posting";

pdfmake.addFonts({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(path => ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].includes(path));
/** Any document, for the ones that set their own page size (an ID card is not an A4 sheet). */
export async function renderPdf(definition: TDocumentDefinitions) {
  return pdfmake.createPdf({ ...definition, defaultStyle: { font: "Helvetica", fontSize: 10, ...definition.defaultStyle } }).getBuffer();
}
export async function renderFinancePdf(content: TDocumentDefinitions["content"]) {
  return pdfmake.createPdf({ defaultStyle: { font: "Helvetica", fontSize: 10 }, content }).getBuffer();
}
/** The school's logo as a pdfmake image, so receipts and statements carry the school's branding. PNG and JPEG only. */
export async function schoolLogoBlock(school: { id: string; logoUrl?: string | null }) {
  const logoId = school.logoUrl?.match(/^\/api\/storage\/files\/([a-f0-9-]+)$/i)?.[1];
  if (!logoId) return [];
  const logo = await db.storedFile.findFirst({ where: { id: logoId, schoolId: school.id, entityType: "school_logo", status: "ready" } });
  if (!logo || !["image/png", "image/jpeg"].includes(logo.contentType)) return [];
  const [bytes] = await storedObject(logo.objectKey).download().catch(() => [null] as [null]);
  return bytes ? [{ image: `data:${logo.contentType};base64,${bytes.toString("base64")}`, fit: [80, 60] as [number, number], margin: [0, 0, 0, 8] as [number, number, number, number] }] : [];
}
const INK = "#1f2a2e", MUTED = "#6b7478", BRAND = "#1d4b52", LINE = "#d9dfe0", TINT = "#eef3f3";
const CHANNEL: Record<string, string> = { mpesa_c2b: "M-Pesa", mpesa_stk: "M-Pesa", bank: "Bank", cash: "Cash", cheque: "Cheque", sponsor: "Sponsor" };
/** 12345.5 → "12,345.50". Amounts are shillings with cents, well inside exact float range. */
const kes = (v: { toFixed(n: number): string } | number) => {
  const n = Number(typeof v === "number" ? v : v.toFixed(2)), [i, f] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`;
};
/** Running balances read as accountants write them: credit is "1,450.00 Cr", never a minus sign. */
const owed = (n: number) => n < 0 ? `${kes(-n)} Cr` : kes(n);
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
/** A template line with blanks ("____") is a placeholder the school never filled in. */
const filled = (t?: string | null) => t && t.trim() && !/_{3,}/.test(t) ? t.trim() : null;

/** Letterhead shared by receipts and statements: logo, school name, motto and contacts; document title on the right. */
async function letterhead(school: Actor["school"], title: string, meta: [string, string][]): Promise<Content[]> {
  const tpl = ((school.settings as any)?.feeStructureTemplates ?? [])[0] ?? {};
  const logo = await schoolLogoBlock(school);
  const contacts = [[school.address, school.county].filter(Boolean).join(", "), [school.phone && `Tel ${school.phone}`, school.email].filter(Boolean).join("  ·  ")].filter(Boolean);
  return [
    { columns: [
      ...(logo.length ? [{ ...logo[0], fit: [64, 64], width: 72, margin: [0, 0, 8, 0] }] : []),
      { width: "*", stack: [
        { text: school.name, fontSize: 17, bold: true, color: INK },
        ...(filled(tpl.subtitle) ? [{ text: filled(tpl.subtitle), italics: true, color: MUTED, margin: [0, 1, 0, 0] }] : []),
        ...contacts.map(c => ({ text: c, fontSize: 8.5, color: MUTED, margin: [0, 2, 0, 0] })),
      ] },
      { width: "auto", stack: [
        { text: title.toUpperCase(), fontSize: 15, bold: true, color: BRAND, alignment: "right", characterSpacing: 1 },
        { table: { body: meta.map(([k, v]) => [{ text: k, color: MUTED, fontSize: 8.5, alignment: "right" }, { text: v, fontSize: 8.5, bold: true, alignment: "right" }]) }, layout: "noBorders", margin: [0, 4, 0, 0] },
      ] },
    ], columnGap: 10 },
    { canvas: [{ type: "rect", x: 0, y: 0, w: 515, h: 2.5, color: BRAND }], margin: [0, 12, 0, 14] },
  ] as Content[];
}

/** A titled, tinted box of label/value rows. */
const infoBox = (heading: string, rows: [string, string, boolean?][]): Content => ({
  table: { widths: ["*"], body: [[{ stack: [
    { text: heading.toUpperCase(), fontSize: 7.5, bold: true, color: BRAND, characterSpacing: 0.8, margin: [0, 0, 0, 5] },
    { table: { widths: [72, "*"], body: rows.map(([k, v, strong]) => [{ text: k, color: MUTED, fontSize: 9 }, { text: v, fontSize: strong ? 11 : 9, bold: !!strong }]) }, layout: { defaultBorder: false, paddingLeft: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5 } },
  ], fillColor: TINT, margin: [8, 7, 8, 7] }]] },
  layout: "noBorders",
} as Content);

const footer = (school: Actor["school"], note: string): DynamicContent => (page: number, pages: number) => ({
  margin: [40, 10, 40, 0], columns: [
    { text: `${note}  Generated ${day(new Date())}.`, fontSize: 7.5, color: MUTED, width: "*" },
    { text: `${school.name}  ·  Page ${page} of ${pages}`, fontSize: 7.5, color: MUTED, alignment: "right", width: 170 },
  ],
} as Content);

export async function createDocument(actor: Actor, type: "receipt" | "statement" | "invoice", referenceId: string) {
  const schoolId = actor.school.id, school = actor.school;
  const payment = type === "receipt" ? await record(db, schoolId, referenceId, "payment") : null;
  const invoice = type === "invoice" ? await record(db, schoolId, referenceId, "invoice") : null;
  const studentId = payment ? payment.studentId! : invoice ? invoice.studentId! : referenceId;
  const student = await db.student.findFirst({ where: { id: studentId, schoolId }, include: { grade: true, stream: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } });
  if (!student) throw new ApiError(404, "Record not found");
  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const cls = student.grade ? `${student.grade.name}${student.stream ? ` ${student.stream.name}` : ""}` : "Not placed";
  const parent = student.guardians.find(g => !g.guardian.anonymizedAt)?.guardian;
  const balance = (await db.studentBalance.findFirst({ where: { schoolId, studentId } }))?.balance;
  const bal = balance ? Number(balance.toFixed(2)) : 0;
  const tpl = ((school.settings as any)?.feeStructureTemplates ?? [])[0] ?? {};
  const howToPay = filled(tpl.payment) ?? `Pay to the school's M-Pesa paybill or bank account, using admission number ${student.admissionNo} as the account number.`;
  const learnerBox = infoBox("Learner", [["Name", name, true], ["Admission no.", student.admissionNo], ["Class", cls], ["Boarding", student.boardingStatus === "boarder" ? "Boarder" : "Day scholar"], ...(parent ? [["Parent", `${parent.name}${parent.phone && !parent.phone.startsWith("anonymous:") ? ` · ${parent.phone}` : ""}`] as [string, string]] : [])]);
  let content: Content[], note: string;

  const th = (t: string, right = false) => ({ text: t, bold: true, fontSize: 8, color: "#ffffff", fillColor: BRAND, alignment: right ? "right" : "left", margin: [0, 2, 0, 2] });
  const rowLines = { fillColor: (i: number) => (i > 0 && i % 2 === 0 ? "#f6f8f8" : null), hLineColor: () => LINE, vLineWidth: () => 0, hLineWidth: (i: number) => (i <= 1 ? 0 : 0.4), paddingTop: () => 4, paddingBottom: () => 4 };

  if (invoice) {
    const data = metadata(invoice);
    const lines = await db.invoiceLine.findMany({ where: { schoolId, invoiceId: invoice.id }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
    const items = await db.financeRecord.findMany({ where: { schoolId, kind: "fee_item", id: { in: lines.map(l => l.feeItemId).filter((x): x is string => !!x) } } });
    const itemName = new Map(items.map(i => [i.id, String(metadata(i).name ?? "")]));
    // Paid on this invoice: allocations still standing (neither a reversal nor reversed).
    const allocs = await db.feeAllocation.findMany({ where: { schoolId, invoiceId: invoice.id } });
    const reversed = new Set(allocs.map(a => a.reversesId).filter(Boolean));
    const paidHere = allocs.filter(a => !a.reversesId && !reversed.has(a.id)).reduce((t, a) => t + Number(a.amount.toFixed(2)), 0);
    const total = Number(invoice.amount.toFixed(2)), dueHere = Math.max(0, total - paidHere);
    const termName = invoice.termId ? (await db.term.findFirst({ where: { id: invoice.termId, schoolId } }))?.name : null;
    const cancelled = invoice.status === "cancelled";
    content = [
      ...await letterhead(school, cancelled ? "Invoice (cancelled)" : "Invoice", [["Invoice no.", data.invoiceNo ?? "—"], ["Issued", data.issueDate ? day(new Date(data.issueDate)) : day(invoice.createdAt)], ["Due", data.dueDate ? day(new Date(data.dueDate)) : "—"]]),
      { columns: [infoBox("Bill to", [["Learner", name, true], ["Admission no.", student.admissionNo], ["Class", cls], ...(parent ? [["Parent", `${parent.name}${parent.phone && !parent.phone.startsWith("anonymous:") ? ` · ${parent.phone}` : ""}`] as [string, string]] : [])]),
        infoBox("Invoice summary", [["For", termName ? `${termName} fees` : data.type === "one_off" ? "One-off charge" : "School fees"], ["Invoice total", `KES ${kes(total)}`], ["Paid so far", `KES ${kes(paidHere)}`], ["Amount due", `KES ${kes(cancelled ? 0 : dueHere)}`, true]])], columnGap: 12 },
      { text: "Charges", bold: true, fontSize: 10.5, color: INK, margin: [0, 18, 0, 6] },
      { table: { headerRows: 1, widths: [22, "*", 90], body: [
        [th("#"), th("Item"), th("Amount (KES)", true)],
        ...lines.map((l, i) => [{ text: String(i + 1), color: MUTED, fontSize: 8.5 }, { text: (l.feeItemId && itemName.get(l.feeItemId)) || l.description || "Charge", fontSize: 9 }, { text: kes(l.amount), fontSize: 9, alignment: "right" }]),
      ] }, layout: rowLines },
      { margin: [0, 6, 0, 0], columns: [{ width: "*", text: "" }, { width: 240, table: { widths: ["*", "auto"], body: [
        [{ text: "Invoice total", color: MUTED }, { text: kes(total), alignment: "right" }],
        [{ text: "Paid so far", color: MUTED }, { text: paidHere ? `-${kes(paidHere)}` : kes(0), alignment: "right" }],
        [{ text: "Amount due", bold: true, fontSize: 11 }, { text: `KES ${kes(cancelled ? 0 : dueHere)}`, bold: true, fontSize: 11, alignment: "right", color: dueHere && !cancelled ? "#9a3412" : BRAND }],
      ] }, layout: { hLineColor: () => LINE, vLineWidth: () => 0, hLineWidth: (i: number, node: any) => (i === node.table.body.length - 1 ? 0.9 : 0), paddingTop: () => 3, paddingBottom: () => 3 } }] },
      ...(cancelled ? [{ text: "This invoice has been cancelled and is not payable.", bold: true, color: "#9a3412", margin: [0, 12, 0, 0] }] : []),
      { text: "How to pay", bold: true, fontSize: 9.5, color: BRAND, margin: [0, 18, 0, 3] },
      { text: howToPay, fontSize: 9, color: INK, lineHeight: 1.25 },
      ...(!cancelled && bal > dueHere ? [{ text: `Including other invoices, the learner's total balance due is KES ${kes(bal)}.`, fontSize: 8.5, color: MUTED, margin: [0, 10, 0, 0] }] : []),
    ] as Content[];
    note = "Computer-generated invoice. Quote the admission number with every payment.";
  } else if (payment) {
    const data = metadata(payment);
    content = [
      ...await letterhead(school, "Official receipt", [["Receipt no.", data.receiptNo ?? "—"], ["Date", day(payment.createdAt)]]),
      { columns: [learnerBox, infoBox("Payment", [["Amount", `KES ${kes(payment.amount)}`, true], ["Method", CHANNEL[data.channel] ?? data.channel ?? "—"], ["Reference", data.originalProviderTxnId ?? data.providerTxnId ?? "—"], ["Status", payment.status === "posted" || payment.status === "active" ? "Received" : payment.status]])], columnGap: 12 },
      { margin: [0, 18, 0, 0], table: { widths: ["*", "auto"], body: [
        [{ text: "Received with thanks", bold: true, color: INK, margin: [0, 4, 0, 4] }, { text: `KES ${kes(payment.amount)}`, bold: true, fontSize: 13, alignment: "right", margin: [0, 2, 0, 2] }],
        [{ text: `${bal > 0 ? "Balance still due" : bal < 0 ? "Account in credit" : "Account fully paid"} as at ${day(new Date())}`, color: MUTED }, { text: `KES ${kes(Math.abs(bal))}`, alignment: "right", bold: true, color: bal > 0 ? "#9a3412" : BRAND }],
      ] }, layout: { hLineColor: () => LINE, vLineWidth: () => 0, hLineWidth: (i: number) => (i === 0 ? 0 : 0.7), paddingTop: () => 6, paddingBottom: () => 6 } },
      { text: "Received by: ______________________________          Signature & stamp: ______________________", fontSize: 9, color: MUTED, margin: [0, 34, 0, 0] },
    ] as Content[];
    note = "Computer-generated receipt from the school's fee ledger.";
  } else {
    const entries = await db.ledgerEntry.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const refs = await db.financeRecord.findMany({ where: { schoolId, id: { in: entries.map(e => e.referenceId) } } });
    const terms = await db.term.findMany({ where: { schoolId } });
    const lines = await db.invoiceLine.findMany({ where: { schoolId, invoiceId: { in: refs.filter(r => r.kind === "invoice").map(r => r.id) } } });
    const items = await db.financeRecord.findMany({ where: { schoolId, kind: "fee_item" } });
    const itemName = new Map(items.map(i => [i.id, String(metadata(i).name ?? "")]));
    const refOf = new Map(refs.map(r => [r.id, r]));
    let run = 0, charged = 0, paid = 0;
    const rows = entries.map(e => {
      const r = refOf.get(e.referenceId), d = r ? metadata(r) : {}, debit = Number(e.debit.toFixed(2)), credit = Number(e.credit.toFixed(2));
      run += debit - credit; charged += debit; paid += credit;
      const termName = terms.find(t => t.id === e.termId)?.name;
      const what = e.type === "invoice" ? `${termName ? `${termName} fees` : "Fees"}${lines.some(l => l.invoiceId === e.referenceId) ? `: ${[...new Set(lines.filter(l => l.invoiceId === e.referenceId).map(l => itemName.get(l.feeItemId ?? "") || l.description))].filter(Boolean).join(", ")}` : ""}`
        : e.type === "payment" ? `Payment · ${CHANNEL[d.channel] ?? "received"}`
        : e.type === "adjustment" ? `${d.adjustmentType ? String(d.adjustmentType).replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "Adjustment"}${d.reason ? ` · ${d.reason}` : ""}`
        : e.reversesId ? `Reversal · ${e.description}` : e.description;
      const ref = d.invoiceNo ?? d.receiptNo ?? (e.type === "invoice" || e.type === "payment" ? e.description : "");
      return [day(e.createdAt), what, ref, debit ? kes(debit) : "", credit ? kes(credit) : "", owed(run)];
    });
    const due = bal > 0 ? "Balance due" : bal < 0 ? "In credit" : "Balance";
    content = [
      ...await letterhead(school, "Fee statement", [["Statement date", day(new Date())], ["Account", student.admissionNo]]),
      { columns: [learnerBox, infoBox("Account summary", [["Total billed", `KES ${kes(charged)}`], ["Total paid", `KES ${kes(paid)}`], [due, `KES ${kes(Math.abs(bal))}`, true]])], columnGap: 12 },
      { text: "Transactions", bold: true, fontSize: 10.5, color: INK, margin: [0, 18, 0, 6] },
      rows.length ? { table: { headerRows: 1, widths: [58, "*", 78, 62, 62, 66], body: [
        [th("Date"), th("Description"), th("Reference"), th("Charges", true), th("Payments", true), th("Balance", true)],
        ...rows.map(r => r.map((c, i) => ({ text: c, fontSize: 8.5, alignment: i >= 3 ? "right" : "left", color: i === 0 || i === 2 ? MUTED : INK }))),
        [{ text: "Totals", bold: true, fontSize: 8.5, colSpan: 3 }, {}, {}, { text: kes(charged), bold: true, fontSize: 8.5, alignment: "right" }, { text: kes(paid), bold: true, fontSize: 8.5, alignment: "right" }, { text: owed(bal), bold: true, fontSize: 8.5, alignment: "right" }],
      ] }, layout: {
        fillColor: (i: number) => (i > 0 && i % 2 === 0 ? "#f6f8f8" : null), hLineColor: () => LINE, vLineWidth: () => 0,
        hLineWidth: (i: number, node: any) => (i === 0 || i === 1 ? 0 : i === node.table.body.length - 1 || i === node.table.body.length ? 0.9 : 0.4),
        paddingTop: () => 4, paddingBottom: () => 4,
      } } : { text: "No transactions on this account yet.", color: MUTED, italics: true },
      { margin: [0, 14, 0, 0], table: { widths: ["*", "auto"], body: [[
        { text: bal > 0 ? `${due} as at ${day(new Date())}` : bal < 0 ? "This account is in credit; it will be applied to the next invoice." : "This account is fully paid. Thank you.", bold: bal > 0, color: INK, margin: [0, 2, 0, 2] },
        { text: `KES ${kes(Math.abs(bal))}`, bold: true, fontSize: 13, color: bal > 0 ? "#9a3412" : BRAND, alignment: "right" },
      ]] }, layout: { fillColor: () => TINT, defaultBorder: false, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 7, paddingBottom: () => 7 } },
      { text: "How to pay", bold: true, fontSize: 9.5, color: BRAND, margin: [0, 16, 0, 3] },
      { text: howToPay, fontSize: 9, color: INK, lineHeight: 1.25 },
    ] as Content[];
    note = "Computer-generated statement from the school's fee ledger. Queries: contact the school bursar.";
  }
  const bytes = await pdfmake.createPdf({
    pageSize: "A4", pageMargins: [40, 40, 40, 48], info: { title: `${type === "receipt" ? "Receipt" : type === "invoice" ? "Invoice" : "Fee statement"} · ${name}`, author: school.name },
    defaultStyle: { font: "Helvetica", fontSize: 9.5, color: INK }, content, footer: footer(school, note),
  }).getBuffer();
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
  return { id, ...await readUrl(key, `/api/finance/documents/${id}/download`) };
}