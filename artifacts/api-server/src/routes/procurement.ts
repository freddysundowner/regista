import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { ApiError, audit, body, lock, parse, readers, send } from "../lib/core";
import { need } from "../lib/access";
import { money, sum, zero } from "../lib/finance/money";
import { EXPENSE_CATEGORIES, checkAttachment, insertExpense } from "../lib/finance/books";
import { receiveStock } from "./store";

/**
 * Buying for the school: suppliers, local purchase orders (raised by one person, approved by another),
 * goods received against them, and the supplier's invoices. Paying an invoice records an expense,
 * so the Finance Book's spending always includes what suppliers were paid.
 */
const router = Router();
const day = (d: Date) => d.toISOString().slice(0, 10);
const todayNairobi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const lpoRef = (n: number) => `LPO-${String(n).padStart(4, "0")}`;
const qty = (v: string) => new Prisma.Decimal(v);
const OPEN = ["pending", "approved", "partly_received"];

/** Anyone who works with purchasing may look; finance readers (principal, bursar, admin) always may. */
function reader(req: Parameters<typeof need>[0]) {
  if (!readers.includes(req.actor.user.role)) need(req, "procurement", "approve_lpo", "expenses", "store");
}
async function names(schoolId: string) {
  return new Map((await db.user.findMany({ where: { schoolId }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
}

// ---------- Suppliers ----------
async function supplierViews(schoolId: string, where: Prisma.SupplierWhereInput = {}) {
  const [suppliers, invoices, paid, orders] = await Promise.all([
    db.supplier.findMany({ where: { schoolId, ...where }, orderBy: { name: "asc" } }),
    db.supplierInvoice.groupBy({ by: ["supplierId"], where: { schoolId, status: "active" }, _sum: { amount: true } }),
    db.expense.groupBy({ by: ["supplierId"], where: { schoolId, status: "active", supplierInvoiceId: { not: null } }, _sum: { amount: true } }),
    db.purchaseOrder.groupBy({ by: ["supplierId"], where: { schoolId, status: { in: OPEN } }, _count: true }),
  ]);
  const billed = new Map(invoices.map(i => [i.supplierId, i._sum.amount ?? zero()]));
  const settled = new Map(paid.map(p => [p.supplierId, p._sum.amount ?? zero()]));
  const open = new Map(orders.map(o => [o.supplierId, o._count]));
  return suppliers.map(s => ({ ...s, owed: (billed.get(s.id) ?? zero()).minus(settled.get(s.id) ?? zero()).toFixed(2), openOrders: open.get(s.id) ?? 0 }));
}
const duplicateName = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

router.get("/procurement/suppliers", async (req, res) => {
  reader(req);
  send(res, "ListSuppliers", await supplierViews(req.actor.school.id));
});
router.post("/procurement/suppliers", async (req, res) => {
  need(req, "procurement", "expenses");
  const input = body(z.CreateSupplierBody, req.body);
  const supplier = await db.$transaction(async tx => {
    const s = await tx.supplier.create({ data: { schoolId: req.actor.school.id, name: input.name, contactPerson: input.contactPerson || null, phone: input.phone || null, email: input.email || null, kraPin: input.kraPin?.toUpperCase() || null, address: input.address || null } });
    await audit(tx, req.actor, "created", "supplier", s.id, undefined, s);
    return s;
  }).catch(e => { throw duplicateName(e) ? new ApiError(409, `${input.name} is already a supplier.`) : e; });
  send(res, "CreateSupplier", (await supplierViews(req.actor.school.id, { id: supplier.id }))[0]);
});
router.patch("/procurement/suppliers/:id", async (req, res) => {
  need(req, "procurement", "expenses");
  const { id } = parse(z.UpdateSupplierParams, req.params);
  const input = body(z.UpdateSupplierBody, req.body);
  await db.$transaction(async tx => {
    const before = await tx.supplier.findFirst({ where: { id, schoolId: req.actor.school.id } });
    if (!before) throw new ApiError(404, "Supplier not found");
    const after = await tx.supplier.update({ where: { id }, data: { ...input, ...(input.kraPin ? { kraPin: input.kraPin.toUpperCase() } : {}) } });
    await audit(tx, req.actor, "updated", "supplier", id, before, after);
  }).catch(e => { throw duplicateName(e) ? new ApiError(409, "Another supplier already has that name.") : e; });
  send(res, "UpdateSupplier", (await supplierViews(req.actor.school.id, { id }))[0]);
});

// Only a supplier with no history can go; one with LPOs, invoices or payments is marked inactive instead, so records keep their supplier.
router.delete("/procurement/suppliers/:id", async (req, res) => {
  need(req, "procurement", "expenses");
  const { id } = parse(z.DeleteSupplierParams, req.params);
  const schoolId = req.actor.school.id;
  await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const s = await tx.supplier.findFirst({ where: { id, schoolId } });
    if (!s) throw new ApiError(404, "Supplier not found");
    const [orders, invoices, expenses] = await Promise.all([
      tx.purchaseOrder.count({ where: { supplierId: id } }),
      tx.supplierInvoice.count({ where: { supplierId: id } }),
      tx.expense.count({ where: { supplierId: id } }),
    ]);
    if (orders + invoices + expenses) {
      const used = [orders && `${orders} LPO${orders === 1 ? "" : "s"}`, invoices && `${invoices} invoice${invoices === 1 ? "" : "s"}`, expenses && `${expenses} expense${expenses === 1 ? "" : "s"}`].filter(Boolean).join(", ");
      throw new ApiError(409, `${s.name} appears on ${used}, so it can't be deleted. Mark it inactive instead.`);
    }
    await tx.supplier.delete({ where: { id } });
    await audit(tx, req.actor, "deleted", "supplier", id, s, { deleted: true });
  });
  res.status(204).end();
});

// ---------- Purchase orders (LPOs) ----------
const orderInclude = { supplier: true, lines: { orderBy: { position: "asc" } }, receipts: { orderBy: { createdAt: "asc" } }, invoices: { where: { status: "active" } } } satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

async function orderViews(schoolId: string, orders: OrderRow[]) {
  const [people, items] = await Promise.all([
    names(schoolId),
    db.storeItem.findMany({ where: { schoolId, id: { in: orders.flatMap(o => o.lines.map(l => l.storeItemId).filter((x): x is string => !!x)) } }, select: { id: true, name: true } }),
  ]);
  const itemName = new Map(items.map(i => [i.id, i.name]));
  return orders.map(o => ({
    id: o.id, number: o.number, reference: lpoRef(o.number), supplierId: o.supplierId, supplierName: o.supplier.name,
    date: day(o.date), neededBy: o.neededBy ? day(o.neededBy) : null, notes: o.notes, status: o.status, total: o.total.toFixed(2),
    invoiced: sum(o.invoices.map(i => i.amount)).toFixed(2),
    createdBy: o.createdBy, createdByName: people.get(o.createdBy) ?? null, decidedByName: o.decidedBy ? people.get(o.decidedBy) ?? null : null,
    decidedAt: o.decidedAt, decisionNote: o.decisionNote, createdAt: o.createdAt,
    lines: o.lines.map(l => ({ id: l.id, storeItemId: l.storeItemId, storeItemName: l.storeItemId ? itemName.get(l.storeItemId) ?? null : null, description: l.description, unit: l.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), amount: l.quantity.times(l.unitPrice).toFixed(2), receivedQty: l.receivedQty.toString() })),
    receipts: o.receipts.map(r => ({ id: r.id, date: day(r.date), deliveryNote: r.deliveryNote, note: r.note, receivedByName: people.get(r.receivedBy) ?? null, lines: r.lines as { lineId: string; description: string; quantity: string }[], createdAt: r.createdAt })),
  }));
}
async function oneOrder(schoolId: string, id: string) {
  const o = await db.purchaseOrder.findFirst({ where: { id, schoolId }, include: orderInclude });
  if (!o) throw new ApiError(404, "LPO not found");
  return (await orderViews(schoolId, [o]))[0];
}

router.get("/procurement/orders", async (req, res) => {
  reader(req);
  const q = parse(z.ListPurchaseOrdersQueryParams, req.query);
  const orders = await db.purchaseOrder.findMany({ where: { schoolId: req.actor.school.id, ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) }, include: orderInclude, orderBy: { number: "desc" }, take: 500 });
  send(res, "ListPurchaseOrders", await orderViews(req.actor.school.id, orders));
});
router.get("/procurement/orders/:id", async (req, res) => {
  reader(req);
  const { id } = parse(z.GetPurchaseOrderParams, req.params);
  send(res, "GetPurchaseOrder", await oneOrder(req.actor.school.id, id));
});
router.post("/procurement/orders", async (req, res) => {
  need(req, "procurement");
  const input = body(z.CreatePurchaseOrderBody, req.body);
  const schoolId = req.actor.school.id;
  if (input.neededBy && input.neededBy < input.date) throw new ApiError(400, "The needed-by date is before the LPO date.");
  const id = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, schoolId } });
    if (!supplier) throw new ApiError(404, "Supplier not found");
    if (!supplier.isActive) throw new ApiError(409, `${supplier.name} is marked inactive. Reactivate them first.`);
    const itemIds = input.lines.map(l => l.storeItemId).filter((x): x is string => !!x);
    const items = await tx.storeItem.findMany({ where: { schoolId, id: { in: itemIds } } });
    if (items.length !== new Set(itemIds).size) throw new ApiError(404, "A store item on this LPO was not found");
    const lines = input.lines.map((l, position) => ({ ...l, position, quantity: qty(l.quantity), unitPrice: money(l.unitPrice) }));
    if (lines.some(l => !l.quantity.gt(0))) throw new ApiError(400, "Every line needs a quantity above zero.");
    const total = sum(lines.map(l => l.quantity.times(l.unitPrice).toDecimalPlaces(2)));
    if (!total.gt(0)) throw new ApiError(400, "The LPO total must be above zero.");
    const last = await tx.purchaseOrder.findFirst({ where: { schoolId }, orderBy: { number: "desc" }, select: { number: true } });
    const order = await tx.purchaseOrder.create({ data: {
      schoolId, number: (last?.number ?? 0) + 1, supplierId: supplier.id, date: D(input.date), neededBy: input.neededBy ? D(input.neededBy) : null,
      notes: input.notes || null, total, createdBy: req.actor.user.id,
      lines: { create: lines.map(l => ({ storeItemId: l.storeItemId ?? null, description: l.description, unit: l.unit || items.find(i => i.id === l.storeItemId)?.unit || null, quantity: l.quantity, unitPrice: l.unitPrice, position: l.position })) },
    } });
    await audit(tx, req.actor, "created", "purchase_order", order.id, undefined, { ...order, total: total.toFixed(2), lines: input.lines });
    return order.id;
  });
  send(res, "CreatePurchaseOrder", await oneOrder(schoolId, id));
});
router.post("/procurement/orders/:id/decision", async (req, res) => {
  need(req, "approve_lpo");
  const { id } = parse(z.DecidePurchaseOrderParams, req.params);
  const input = body(z.DecidePurchaseOrderBody, req.body);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const o = await tx.purchaseOrder.findFirst({ where: { id, schoolId: req.actor.school.id } });
    if (!o) throw new ApiError(404, "LPO not found");
    if (o.status !== "pending") throw new ApiError(409, `This LPO is already ${o.status.replace("_", " ")}.`);
    // Someone other than the person who raised it approves, unless that person is a school admin.
    if (o.createdBy === req.actor.user.id && !["school_admin", "super_admin"].includes(req.actor.user.role)) throw new ApiError(403, "Someone else must approve an LPO you raised.");
    if (input.decision === "reject" && !input.note?.trim()) throw new ApiError(400, "Say why the LPO is rejected.");
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: input.decision === "approve" ? "approved" : "rejected", decidedBy: req.actor.user.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
    await audit(tx, req.actor, input.decision === "approve" ? "approved" : "rejected", "purchase_order", id, o, after);
  });
  send(res, "DecidePurchaseOrder", await oneOrder(req.actor.school.id, id));
});
router.post("/procurement/orders/:id/cancel", async (req, res) => {
  need(req, "procurement", "approve_lpo");
  const { id } = parse(z.CancelPurchaseOrderParams, req.params);
  const { reason } = body(z.CancelPurchaseOrderBody, req.body);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const o = await tx.purchaseOrder.findFirst({ where: { id, schoolId: req.actor.school.id }, include: { receipts: { select: { id: true } } } });
    if (!o) throw new ApiError(404, "LPO not found");
    if (!["pending", "approved"].includes(o.status) || o.receipts.length) throw new ApiError(409, "Only an LPO with nothing delivered yet can be cancelled.");
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "cancelled", decisionNote: reason, decidedBy: req.actor.user.id, decidedAt: new Date() } });
    await audit(tx, req.actor, "cancelled", "purchase_order", id, o, after);
  });
  send(res, "CancelPurchaseOrder", await oneOrder(req.actor.school.id, id));
});
router.post("/procurement/orders/:id/receive", async (req, res) => {
  need(req, "procurement", "store");
  const { id } = parse(z.ReceivePurchaseOrderParams, req.params);
  const input = body(z.ReceivePurchaseOrderBody, req.body);
  if (input.date > todayNairobi()) throw new ApiError(400, "A delivery can't be dated in the future.");
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const o = await tx.purchaseOrder.findFirst({ where: { id, schoolId: req.actor.school.id }, include: { lines: true } });
    if (!o) throw new ApiError(404, "LPO not found");
    if (!["approved", "partly_received"].includes(o.status)) throw new ApiError(409, o.status === "pending" ? "This LPO hasn't been approved yet." : `Nothing more can be received on a ${o.status.replace("_", " ")} LPO.`);
    const got = input.lines.map(l => ({ line: o.lines.find(x => x.id === l.lineId), quantity: qty(l.quantity) })).filter(g => g.quantity.gt(0));
    if (!got.length) throw new ApiError(400, "Enter how many of at least one item arrived.");
    if (new Set(input.lines.map(l => l.lineId)).size !== input.lines.length) throw new ApiError(400, "Each line can appear once.");
    for (const g of got) {
      if (!g.line) throw new ApiError(404, "A line on this delivery is not on the LPO");
      const left = g.line.quantity.minus(g.line.receivedQty);
      if (g.quantity.gt(left)) throw new ApiError(400, `Only ${left} more of ${g.line.description} ${left.eq(1) ? "is" : "are"} due on this LPO.`);
    }
    for (const g of got) {
      await tx.purchaseOrderLine.update({ where: { id: g.line!.id }, data: { receivedQty: g.line!.receivedQty.plus(g.quantity) } });
      if (g.line!.storeItemId) await receiveStock(tx, req.actor, { itemId: g.line!.storeItemId, quantity: g.quantity, unitCost: g.line!.unitPrice, date: input.date, reference: input.deliveryNote || lpoRef(o.number), note: `From ${lpoRef(o.number)}`, orderId: o.id });
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: o.id } });
    const done = lines.every(l => l.receivedQty.gte(l.quantity));
    await tx.goodsReceipt.create({ data: { schoolId: req.actor.school.id, orderId: o.id, date: D(input.date), deliveryNote: input.deliveryNote || null, note: input.note || null, receivedBy: req.actor.user.id, lines: got.map(g => ({ lineId: g.line!.id, description: g.line!.description, quantity: g.quantity.toString() })) } });
    const after = await tx.purchaseOrder.update({ where: { id: o.id }, data: { status: done ? "received" : "partly_received" } });
    await audit(tx, req.actor, "received", "purchase_order", o.id, { status: o.status }, { status: after.status, delivery: input });
  });
  send(res, "ReceivePurchaseOrder", await oneOrder(req.actor.school.id, id));
});

// ---------- Supplier invoices ----------
const invoiceInclude = { supplier: true, order: { select: { number: true } } } satisfies Prisma.SupplierInvoiceInclude;
async function invoiceViews(schoolId: string, where: Prisma.SupplierInvoiceWhereInput) {
  const [rows, people] = await Promise.all([db.supplierInvoice.findMany({ where: { schoolId, ...where }, include: invoiceInclude, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1000 }), names(schoolId)]);
  const payments = await db.expense.findMany({ where: { schoolId, supplierInvoiceId: { in: rows.map(r => r.id) } }, orderBy: { date: "asc" } });
  const today = todayNairobi();
  return rows.map(r => {
    const mine = payments.filter(p => p.supplierInvoiceId === r.id);
    const paid = sum(mine.filter(p => p.status === "active").map(p => p.amount));
    const balance = r.amount.minus(paid);
    const state = r.status === "voided" ? "voided" : !balance.gt(0) ? "paid" : r.dueDate && day(r.dueDate) < today ? "overdue" : paid.gt(0) ? "part_paid" : "unpaid";
    return {
      id: r.id, supplierId: r.supplierId, supplierName: r.supplier.name, orderId: r.orderId, orderReference: r.order ? lpoRef(r.order.number) : null,
      invoiceNo: r.invoiceNo, date: day(r.date), dueDate: r.dueDate ? day(r.dueDate) : null, description: r.description, category: r.category,
      amount: r.amount.toFixed(2), paid: paid.toFixed(2), balance: (r.status === "voided" ? zero() : balance).toFixed(2), attachmentUrl: r.attachmentUrl,
      status: r.status, state, voidReason: r.voidReason, createdByName: people.get(r.createdBy) ?? null, createdAt: r.createdAt,
      payments: mine.map(p => ({ expenseId: p.id, date: day(p.date), amount: p.amount.toFixed(2), method: p.method, reference: p.reference, status: p.status })),
    };
  });
}
async function oneInvoice(schoolId: string, id: string) {
  const [v] = await invoiceViews(schoolId, { id });
  if (!v) throw new ApiError(404, "Invoice not found");
  return v;
}

router.get("/procurement/invoices", async (req, res) => {
  reader(req);
  const q = parse(z.ListSupplierInvoicesQueryParams, req.query);
  let rows = await invoiceViews(req.actor.school.id, { ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...(q.state === "voided" ? { status: "voided" } : q.state ? { status: "active" } : {}) });
  if (q.state === "paid") rows = rows.filter(r => r.state === "paid");
  if (q.state === "unpaid") rows = rows.filter(r => r.state !== "paid");
  send(res, "ListSupplierInvoices", rows);
});
router.post("/procurement/invoices", async (req, res) => {
  need(req, "procurement", "expenses");
  const input = body(z.CreateSupplierInvoiceBody, req.body);
  const schoolId = req.actor.school.id;
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) throw new ApiError(400, "Choose what the invoice is for.");
  if (input.date > todayNairobi()) throw new ApiError(400, "An invoice can't be dated in the future.");
  if (input.dueDate && input.dueDate < input.date) throw new ApiError(400, "The due date is before the invoice date.");
  const amount = money(input.amount);
  if (!amount.gt(0)) throw new ApiError(400, "Enter an amount above zero.");
  const id = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, schoolId } });
    if (!supplier) throw new ApiError(404, "Supplier not found");
    if (input.orderId) {
      const o = await tx.purchaseOrder.findFirst({ where: { id: input.orderId, schoolId } });
      if (!o) throw new ApiError(404, "LPO not found");
      if (o.supplierId !== supplier.id) throw new ApiError(400, `${lpoRef(o.number)} was raised to a different supplier.`);
      if (!["approved", "partly_received", "received"].includes(o.status)) throw new ApiError(409, `${lpoRef(o.number)} is ${o.status}; only an approved LPO can be invoiced.`);
    }
    if (await tx.supplierInvoice.findFirst({ where: { schoolId, supplierId: supplier.id, invoiceNo: input.invoiceNo } })) throw new ApiError(409, `Invoice ${input.invoiceNo} from ${supplier.name} is already recorded.`);
    const attachmentUrl = await checkAttachment(tx, schoolId, input.attachmentUrl);
    const inv = await tx.supplierInvoice.create({ data: { schoolId, supplierId: supplier.id, orderId: input.orderId ?? null, invoiceNo: input.invoiceNo, date: D(input.date), dueDate: input.dueDate ? D(input.dueDate) : null, description: input.description, category: input.category, amount, attachmentUrl, createdBy: req.actor.user.id } });
    await audit(tx, req.actor, "created", "supplier_invoice", inv.id, undefined, { ...inv, amount: amount.toFixed(2) });
    return inv.id;
  });
  send(res, "CreateSupplierInvoice", await oneInvoice(schoolId, id));
});
router.post("/procurement/invoices/:id/void", async (req, res) => {
  need(req, "procurement", "expenses");
  const { id } = parse(z.VoidSupplierInvoiceParams, req.params);
  const { reason } = body(z.VoidSupplierInvoiceBody, req.body);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const inv = await tx.supplierInvoice.findFirst({ where: { id, schoolId: req.actor.school.id } });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "voided") return;
    if (await tx.expense.count({ where: { supplierInvoiceId: id, status: "active" } })) throw new ApiError(409, "Payments were made on this invoice. Void those expenses first.");
    const after = await tx.supplierInvoice.update({ where: { id }, data: { status: "voided", voidReason: reason } });
    await audit(tx, req.actor, "voided", "supplier_invoice", id, { ...inv, amount: inv.amount.toFixed(2) }, { ...after, amount: after.amount.toFixed(2) });
  });
  send(res, "VoidSupplierInvoice", await oneInvoice(req.actor.school.id, id));
});
router.post("/procurement/invoices/:id/pay", async (req, res) => {
  need(req, "expenses");
  const { id } = parse(z.PaySupplierInvoiceParams, req.params);
  const input = body(z.PaySupplierInvoiceBody, req.body);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const inv = await tx.supplierInvoice.findFirst({ where: { id, schoolId: req.actor.school.id }, include: { supplier: true } });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status !== "active") throw new ApiError(409, "This invoice was voided.");
    const paid = (await tx.expense.aggregate({ where: { supplierInvoiceId: id, status: "active" }, _sum: { amount: true } }))._sum.amount ?? zero();
    const balance = inv.amount.minus(paid), amount = money(input.amount);
    if (!balance.gt(0)) throw new ApiError(409, "This invoice is already paid in full.");
    if (amount.gt(balance)) throw new ApiError(400, `Only KES ${Number(balance).toLocaleString("en-KE")} is left to pay on this invoice.`);
    await insertExpense(tx, req.actor, { date: input.date, category: inv.category, description: `Invoice ${inv.invoiceNo}: ${inv.description}`.slice(0, 200), amount: input.amount, method: input.method, reference: input.reference, supplierId: inv.supplierId, supplierInvoiceId: inv.id, attachmentUrl: input.attachmentUrl });
  });
  send(res, "PaySupplierInvoice", await oneInvoice(req.actor.school.id, id));
});

export default router;
