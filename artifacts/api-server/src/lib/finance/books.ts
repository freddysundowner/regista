import { db, Prisma } from "@workspace/db";
import { ApiError, audit, owned, type Actor } from "../core";
import { money, sum, zero } from "./money";

/**
 * The owner's money questions, answered on the server so screens only show results:
 * what should come in, what did come in (and where), who owes and what they promised,
 * what was spent, what is left, which classes are behind, and which adjustments deserve a look.
 */

const D = (v: Prisma.Decimal | null | undefined) => v ?? zero();
const day = (d: Date) => d.toISOString().slice(0, 10);
const todayNairobi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const BANK: Record<string, string> = { kcb: "KCB", ncba: "NCBA", equity: "Equity", coop: "Co-op", cooperative: "Co-op" };

/** Where a payment landed, in words a school uses. */
export function channelLabel(channel?: string, provider?: string) {
  const bank = provider ? BANK[provider.toLowerCase()] : undefined;
  if (channel?.startsWith("mpesa")) return bank ? `M-Pesa via ${bank}` : "M-Pesa";
  if (channel === "bank") return bank ? `${bank} bank` : "Bank";
  if (channel === "cash") return "Cash";
  if (channel === "cheque") return "Cheque";
  return "Other";
}

// ---------- Expenses ----------
export const EXPENSE_CATEGORIES = ["salaries", "statutory", "food", "transport", "fuel", "supplies", "stationery", "books", "cleaning", "uniforms", "medical", "exams", "events", "utilities", "repairs", "furniture", "rent", "bank_charges", "other"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  salaries: "Salaries", statutory: "PAYE, NSSF & SHIF", food: "Food", transport: "Transport", fuel: "Fuel", supplies: "Supplies", stationery: "Stationery",
  books: "Books", cleaning: "Cleaning", uniforms: "Uniforms", medical: "Medical", exams: "Exams", events: "Trips & events", utilities: "Utilities",
  repairs: "Repairs", furniture: "Furniture & equipment", rent: "Rent", bank_charges: "Bank charges", other: "Other",
};

type ExpenseRow = { date: Date; amount: Prisma.Decimal; supplierId?: string | null; supplierInvoiceId?: string | null } & Record<string, unknown>;
type Lookups = { users: Map<string, string>; suppliers?: Map<string, string>; invoices?: Map<string, string> };
const expenseView = (e: ExpenseRow, l: Lookups) =>
  ({ ...e, date: day(e.date), amount: e.amount.toFixed(2), recordedByName: l.users.get(String(e.recordedBy)) ?? null,
    supplierName: e.supplierId ? l.suppliers?.get(e.supplierId) ?? null : null, supplierInvoiceNo: e.supplierInvoiceId ? l.invoices?.get(e.supplierInvoiceId) ?? null : null });

async function lookups(schoolId: string): Promise<Lookups> {
  const [users, suppliers, invoices] = await Promise.all([
    db.user.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    db.supplier.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    db.supplierInvoice.findMany({ where: { schoolId }, select: { id: true, invoiceNo: true } }),
  ]);
  return { users: new Map(users.map(u => [u.id, u.name])), suppliers: new Map(suppliers.map(s => [s.id, s.name])), invoices: new Map(invoices.map(i => [i.id, i.invoiceNo])) };
}

export async function listExpenses(schoolId: string, q: { from?: string; to?: string; category?: string; supplierId?: string }) {
  const [rows, names] = await Promise.all([
    db.expense.findMany({ where: { schoolId, ...(q.category ? { category: q.category } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}), date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    lookups(schoolId),
  ]);
  return rows.map(r => expenseView(r, names));
}

export type ExpenseInput = { date: Date | string; category: string; description: string; amount: string; method: string; payee?: string; reference?: string; supplierId?: string; attachmentUrl?: string; supplierInvoiceId?: string };

/** Checks an attachment is a finished receipt/invoice upload of this school. */
export async function checkAttachment(tx: Prisma.TransactionClient, schoolId: string, ref: string | null | undefined) {
  if (!ref) return null;
  const m = /^\/api\/storage\/files\/([0-9a-f-]{36})$/i.exec(ref);
  if (!m || !await tx.storedFile.findFirst({ where: { id: m[1], schoolId, entityType: "finance_document", status: "ready" } })) throw new ApiError(400, "The attached receipt didn't finish uploading. Attach it again.");
  return ref;
}

/** Records one expense inside a transaction; supplier payments use this too so they land in the same totals. */
export async function insertExpense(tx: Prisma.TransactionClient, actor: Actor, input: ExpenseInput) {
  const amount = money(input.amount);
  if (!amount.gt(0)) throw new ApiError(400, "Enter an amount above zero.");
  const date = new Date(typeof input.date === "string" ? input.date : day(input.date));
  if (day(date) > todayNairobi()) throw new ApiError(400, "An expense can't be dated in the future.");
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) throw new ApiError(400, "Choose what the money was spent on.");
  const supplier = input.supplierId ? await tx.supplier.findFirst({ where: { id: input.supplierId, schoolId: actor.school.id } }) : null;
  if (input.supplierId && !supplier) throw new ApiError(404, "Supplier not found");
  const attachmentUrl = await checkAttachment(tx, actor.school.id, input.attachmentUrl);
  const e = await tx.expense.create({ data: { schoolId: actor.school.id, date, category: input.category, description: input.description.trim(), amount, method: input.method, payee: input.payee?.trim() || supplier?.name || null, reference: input.reference?.trim() || null, supplierId: supplier?.id ?? null, supplierInvoiceId: input.supplierInvoiceId ?? null, attachmentUrl, recordedBy: actor.user.id } });
  await audit(tx, actor, "created", "expense", e.id, undefined, { ...e, amount: amount.toFixed(2) });
  return e;
}

export async function createExpense(actor: Actor, input: ExpenseInput) {
  const created = await db.$transaction(tx => insertExpense(tx, actor, { ...input, supplierInvoiceId: undefined }));
  return expenseView(created, await lookups(actor.school.id));
}

export async function voidExpense(actor: Actor, id: string, reason: string) {
  const updated = await db.$transaction(async tx => {
    const e = await tx.expense.findFirst({ where: { id, schoolId: actor.school.id } });
    if (!e) throw new ApiError(404, "Expense not found");
    if (e.status === "voided") return e;
    const v = await tx.expense.update({ where: { id: e.id }, data: { status: "voided", voidReason: reason.trim(), voidedBy: actor.user.id } });
    await audit(tx, actor, "voided", "expense", e.id, { ...e, amount: e.amount.toFixed(2) }, { ...v, amount: v.amount.toFixed(2) });
    return v;
  });
  return expenseView(updated, await lookups(actor.school.id));
}

// ---------- Promises to pay ----------
type PromiseRow = { id: string; studentId: string; amount: Prisma.Decimal; promisedFor: Date; note: string | null; status: string; createdAt: Date };

/** Kept once payments since the promise reach the amount; broken once its date has passed without that. */
export function promiseState(p: PromiseRow, paidSince: Prisma.Decimal) {
  if (p.status === "cancelled") return "cancelled" as const;
  if (paidSince.gte(p.amount)) return "kept" as const;
  return day(p.promisedFor) < todayNairobi() ? "broken" as const : "due" as const;
}
export const promiseView = (p: PromiseRow, state: string) =>
  ({ id: p.id, studentId: p.studentId, amount: p.amount.toFixed(2), promisedFor: day(p.promisedFor), note: p.note, state, createdAt: p.createdAt.toISOString() });

/** Each learner's latest promise with its state, from one read of promises and payments. */
export async function latestPromises(schoolId: string) {
  const [promises, entries] = await Promise.all([
    db.paymentPromise.findMany({ where: { schoolId, status: "open" }, orderBy: { createdAt: "desc" } }),
    db.ledgerEntry.findMany({ where: { schoolId, type: { in: ["payment", "reversal"] } }, select: { id: true, type: true, studentId: true, credit: true, debit: true, reversesId: true, createdAt: true } }),
  ]);
  // A payment that was later reversed doesn't keep a promise.
  const reversed = new Set(entries.filter(e => e.type === "reversal" && e.reversesId).map(e => e.reversesId!));
  const payments = entries.filter(e => e.type === "payment" && !reversed.has(e.id));
  const out = new Map<string, ReturnType<typeof promiseView>>();
  for (const p of promises) {
    if (out.has(p.studentId)) continue;
    const paid = sum(payments.filter(x => x.studentId === p.studentId && x.createdAt >= p.createdAt).map(x => x.credit));
    out.set(p.studentId, promiseView(p, promiseState(p, paid)));
  }
  return out;
}

export async function createPromise(actor: Actor, input: { studentId: string; amount: string; promisedFor: Date | string; note?: string }) {
  await owned(db, "student", input.studentId, actor.school.id);
  const amount = money(input.amount);
  if (!amount.gt(0)) throw new ApiError(400, "Enter the amount the parent promised.");
  const when = typeof input.promisedFor === "string" ? input.promisedFor : day(input.promisedFor);
  if (when < todayNairobi()) throw new ApiError(400, "Choose today or a later date.");
  const p = await db.$transaction(async tx => {
    // A new promise replaces any open one for the same learner.
    await tx.paymentPromise.updateMany({ where: { schoolId: actor.school.id, studentId: input.studentId, status: "open" }, data: { status: "cancelled" } });
    const created = await tx.paymentPromise.create({ data: { schoolId: actor.school.id, studentId: input.studentId, amount, promisedFor: new Date(when), note: input.note?.trim() || null, createdBy: actor.user.id } });
    await audit(tx, actor, "created", "payment_promise", created.id, undefined, { ...created, amount: amount.toFixed(2) });
    return created;
  });
  return promiseView(p, "due");
}

export async function cancelPromise(actor: Actor, id: string) {
  const p = await db.paymentPromise.findFirst({ where: { id, schoolId: actor.school.id } });
  if (!p) throw new ApiError(404, "Promise not found");
  const updated = p.status === "cancelled" ? p : await db.paymentPromise.update({ where: { id: p.id }, data: { status: "cancelled" } });
  if (p.status !== "cancelled") await audit(db, actor, "cancelled", "payment_promise", p.id, { ...p, amount: p.amount.toFixed(2) }, { ...updated, amount: updated.amount.toFixed(2) });
  return promiseView(updated, "cancelled");
}

// ---------- The summary ----------
export async function financeSummary(schoolId: string, termId?: string) {
  const terms = await db.term.findMany({ where: { schoolId }, orderBy: { startDate: "desc" } });
  const term = (termId ? terms.find(t => t.id === termId) : terms.find(t => t.isCurrent)) ?? null;
  if (termId && !term) throw new ApiError(404, "Term not found");
  // Term dates are Kenyan calendar days: a day starts at 00:00 EAT, which is 21:00 UTC the day before.
  const EAT = 3 * 3_600_000;
  const from = term ? new Date(term.startDate.getTime() - EAT) : null, until = term ? new Date(term.endDate.getTime() + 86_400_000 - EAT) : null;
  const inTerm = (d: Date) => !from || !until || (d >= from && d < until);

  const [students, streams, grades, records, allocations, ledgerTotals, expenses, users, promises] = await Promise.all([
    db.student.findMany({ where: { schoolId, status: "active" }, select: { id: true, firstName: true, lastName: true, gradeId: true, streamId: true } }),
    db.stream.findMany({ where: { schoolId } }),
    db.grade.findMany({ where: { schoolId } }),
    db.financeRecord.findMany({ where: { schoolId, kind: { in: ["invoice", "payment", "adjustment", "reversal", "refund"] } } }),
    db.feeAllocation.findMany({ where: { schoolId }, select: { invoiceId: true, sourceId: true, amount: true } }),
    db.ledgerEntry.groupBy({ by: ["studentId"], where: { schoolId }, _sum: { debit: true, credit: true } }),
    db.expense.findMany({ where: { schoolId, ...(term ? { date: { gte: term.startDate, lte: term.endDate } } : {}) } }),
    db.user.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    latestPromises(schoolId),
  ]);
  const userName = new Map(users.map(u => [u.id, u.name]));
  const studentName = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
  // What has been settled on each invoice (anything), and how much of that was actual money rather than a discount.
  const kindOf = new Map(records.map(r => [r.id, r.kind]));
  const paidOn = new Map<string, Prisma.Decimal>(), cashOn = new Map<string, Prisma.Decimal>(), discountOn = new Map<string, Prisma.Decimal>();
  for (const a of allocations) {
    paidOn.set(a.invoiceId, D(paidOn.get(a.invoiceId)).plus(a.amount));
    const target = kindOf.get(a.sourceId) === "adjustment" ? discountOn : cashOn;
    target.set(a.invoiceId, D(target.get(a.invoiceId)).plus(a.amount));
  }
  const balance = new Map(ledgerTotals.map(t => [t.studentId, D(t._sum.debit).minus(D(t._sum.credit))]));
  const data = (r: { data: unknown }) => r.data as Record<string, any>;

  // 1. What should have come in: this term's invoices, and how much of them is paid.
  const termInvoices = records.filter(r => r.kind === "invoice" && r.status !== "cancelled" && term && r.termId === term.id);
  // "Who owes" only lists learners still in school, so a learner who has left or been removed counts
  // for what they settled, not for a balance nobody will chase. Their ledger keeps the full history.
  const enrolled = new Set(students.map(s => s.id));
  const billed = sum(termInvoices.map(r => r.studentId && enrolled.has(r.studentId) ? r.amount : Prisma.Decimal.min(r.amount, D(paidOn.get(r.id)))));
  const discountedTerm = sum(termInvoices.map(r => D(discountOn.get(r.id))));
  const toCollect = billed.minus(discountedTerm);
  const paidToTerm = sum(termInvoices.map(r => D(cashOn.get(r.id))));
  const percentPaid = toCollect.gt(0) ? Math.min(100, Math.round(Number(paidToTerm.div(toCollect).times(100)))) : 0;

  // 2. What did come in, and where: posted payments dated in the term, by channel and bank.
  const byChannel = new Map<string, Prisma.Decimal>();
  for (const p of records.filter(r => r.kind === "payment" && r.status === "posted")) {
    const at = new Date(data(p).transactionTime ?? p.createdAt);
    if (!inTerm(at)) continue;
    const label = channelLabel(data(p).channel, data(p).provider);
    byChannel.set(label, D(byChannel.get(label)).plus(p.amount));
  }
  // A refund leaves the school only once it's paid out, not when it's approved.
  const refundsPaid = records.filter(r => r.kind === "refund" && r.status === "paid" && inTerm(r.createdAt));
  const received = sum([...byChannel.values()]);

  // 3. Who owes: total, from earlier terms, and promises.
  const owingIds = students.filter(s => D(balance.get(s.id)).gt(0)).map(s => s.id);
  const owedTotal = sum(owingIds.map(id => D(balance.get(id))));
  let fromPastTerms = zero();
  for (const inv of records.filter(r => r.kind === "invoice" && r.status !== "cancelled" && r.studentId && owingIds.includes(r.studentId))) {
    if (term && inv.termId === term.id) continue;
    const open = inv.amount.minus(D(paidOn.get(inv.id)));
    if (open.gt(0)) fromPastTerms = fromPastTerms.plus(open);
  }
  const open = [...promises.values()].filter(p => ["due", "broken"].includes(p.state) && owingIds.includes(p.studentId));

  // 4. Spent, by category.
  const byCategory = new Map<string, Prisma.Decimal>();
  const activeExpenses = expenses.filter(e => e.status === "active");
  for (const e of activeExpenses) byCategory.set(e.category, D(byCategory.get(e.category)).plus(e.amount));
  const spent = sum(activeExpenses.map(e => e.amount));

  // 5. Health: what came in, minus what went out (refunds count as money out).
  const out = spent.plus(sum(refundsPaid.map(r => r.amount)));
  const left = received.minus(out);
  const verdict = !activeExpenses.length ? "no_expenses" : left.lt(0) ? "deficit" : received.gt(0) && left.lt(received.times(0.1)) ? "tight" : "healthy";

  // 6. Classes, most owed first.
  // "Grade 4" when the grade is one class; "Grade 4 East" when it has several streams.
  const className = (s: { gradeId: string | null; streamId: string | null }) => {
    const g = grades.find(x => x.id === s.gradeId)?.name, st = streams.find(x => x.id === s.streamId)?.name;
    const several = streams.filter(x => x.gradeId === s.gradeId).length > 1;
    return g ? (st && several ? `${g} ${st}` : g) : "No class";
  };
  const classes = new Map<string, { learners: number; billed: Prisma.Decimal; paid: Prisma.Decimal; owed: Prisma.Decimal; order: number }>();
  for (const s of students) {
    const key = className(s);
    const c = classes.get(key) ?? { learners: 0, billed: zero(), paid: zero(), owed: zero(), order: grades.find(x => x.id === s.gradeId)?.order ?? 999 };
    c.learners++;
    // Per class: what should come in (billed less discounts) and how much money actually did.
    for (const inv of termInvoices.filter(r => r.studentId === s.id)) { c.billed = c.billed.plus(inv.amount).minus(D(discountOn.get(inv.id))); c.paid = c.paid.plus(D(cashOn.get(inv.id))); }
    const b = D(balance.get(s.id)); if (b.gt(0)) c.owed = c.owed.plus(b);
    classes.set(key, c);
  }

  // 7. Adjustments worth a look this term.
  // Recurring discounts are stored as an approved template (no money moves) plus one posted copy per term (money moves):
  // count the copies, not the templates. Reversals made automatically when an invoice is cancelled aren't separate decisions.
  const termAdj = records.filter(r => ["adjustment", "reversal", "refund"].includes(r.kind) && inTerm(r.createdAt) && !["rejected", "cancelled"].includes(r.status)
    && !(r.kind === "adjustment" && data(r).recurring) && !(r.kind === "reversal" && data(r).invoiceReversalId));
  const discounts = termAdj.filter(r => r.kind === "adjustment" && data(r).adjustmentType !== "correction" && ["approved", "posted"].includes(r.status));
  const perRequester = new Map<string, number>();
  for (const d of discounts) perRequester.set(d.requestedBy, (perRequester.get(d.requestedBy) ?? 0) + 1);
  const termBill = (studentId: string | null) => sum(termInvoices.filter(r => r.studentId === studentId).map(r => r.amount));
  const flagged = [] as Record<string, unknown>[];
  for (const r of termAdj) {
    const why: string[] = [];
    if (r.kind === "reversal") why.push("A payment or charge was reversed");
    if (r.kind === "refund") why.push("Money was refunded");
    if (r.kind === "adjustment") {
      const bill = termBill(r.studentId);
      if (data(r).adjustmentType === "correction") why.push("A posted record was corrected");
      else if (bill.gt(0) && r.amount.gte(bill.times(0.25))) why.push(`Large: ${Math.round(Number(r.amount.div(bill).times(100)))}% of this term's fees`);
      else if (r.amount.gte(10_000)) why.push("Large: KES 10,000 or more");
      if ((perRequester.get(r.requestedBy) ?? 0) >= 5) why.push(`${userName.get(r.requestedBy) ?? "One person"} asked for ${perRequester.get(r.requestedBy)} discounts this term`);
    }
    if (!why.length) continue;
    flagged.push({ id: r.id, kind: r.kind === "adjustment" ? data(r).adjustmentType ?? "adjustment" : r.kind, studentId: r.studentId, studentName: r.studentId ? studentName.get(r.studentId) ?? null : null,
      amount: r.amount.toFixed(2), reason: data(r).reason ?? null, why: why.join(" · "), requestedBy: userName.get(r.requestedBy) ?? null,
      approvedBy: r.approvedBy ? userName.get(r.approvedBy) ?? null : null, status: r.status, at: r.createdAt.toISOString() });
  }
  for (const e of expenses.filter(x => x.status === "voided"))
    flagged.push({ id: e.id, kind: "voided_expense", studentId: null, studentName: null, amount: e.amount.toFixed(2), reason: e.voidReason, why: `Expense voided: ${e.description}`,
      requestedBy: e.voidedBy ? userName.get(e.voidedBy) ?? null : null, approvedBy: null, status: "voided", at: e.updatedAt.toISOString() });
  flagged.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const lines = (m: Map<string, Prisma.Decimal>, label = (k: string) => k) => [...m].sort((a, b) => Number(b[1].minus(a[1]))).map(([k, v]) => ({ label: label(k), amount: v.toFixed(2) }));
  return {
    termId: term?.id ?? null, termName: term?.name ?? null, from: term ? day(term.startDate) : null, to: term ? day(term.endDate) : null,
    expected: { billed: billed.toFixed(2), discounts: discountedTerm.toFixed(2), toCollect: toCollect.toFixed(2), paid: paidToTerm.toFixed(2), percentPaid, stillToCollect: Prisma.Decimal.max(zero(), toCollect.minus(paidToTerm)).toFixed(2) },
    received: { total: received.toFixed(2), byChannel: lines(byChannel) },
    owed: { total: owedTotal.toFixed(2), learners: owingIds.length, fromPastTerms: fromPastTerms.toFixed(2),
      promisesDue: open.filter(p => p.state === "due").length, promisesBroken: open.filter(p => p.state === "broken").length, promisedAmount: sum(open.filter(p => p.state === "due").map(p => money(p.amount))).toFixed(2) },
    spent: { total: spent.toFixed(2), byCategory: lines(byCategory, k => CATEGORY_LABEL[k] ?? k) },
    health: { received: received.toFixed(2), spent: out.toFixed(2), left: left.toFixed(2), verdict },
    classes: [...classes].sort((a, b) => Number(b[1].owed.minus(a[1].owed)) || a[1].order - b[1].order).map(([k, c]) => ({
      className: k, learners: c.learners, billed: c.billed.toFixed(2), paid: c.paid.toFixed(2), owed: c.owed.toFixed(2),
      percentPaid: c.billed.gt(0) ? Math.min(100, Math.round(Number(c.paid.div(c.billed).times(100)))) : 0 })),
    adjustments: { discounts: sum(discounts.map(d => d.amount)).toFixed(2), discountsCount: discounts.length, reversals: termAdj.filter(r => r.kind === "reversal").length,
      refunds: sum(termAdj.filter(r => r.kind === "refund").map(r => r.amount)).toFixed(2), flagged: flagged.slice(0, 50) },
  };
}
