import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { ApiError, audit, body, lock, parse, readers, send, type Actor, type Tx } from "../lib/core";
import { need } from "../lib/access";
import { money } from "../lib/finance/money";

/**
 * The school store: what is held, and every receipt, issue, return and stock count.
 * Each item keeps its running quantity; every change is a movement with the balance after it,
 * so an item's stock card can always be read back.
 */
const router = Router();
const day = (d: Date) => d.toISOString().slice(0, 10);
const todayNairobi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const qty = (v: string) => new Prisma.Decimal(v);

function reader(req: Parameters<typeof need>[0]) {
  if (!readers.includes(req.actor.user.role)) need(req, "store", "procurement");
}

type MovementInput = { itemId: string; type: "receive" | "issue" | "return" | "adjust"; quantity: Prisma.Decimal; date: string; unitCost?: Prisma.Decimal | null; issuedTo?: string | null; reference?: string | null; note?: string | null; orderId?: string | null };

/** The single place stock changes. For "adjust", quantity is what was counted. */
async function move(tx: Tx, actor: Actor, m: MovementInput) {
  const item = await tx.storeItem.findFirst({ where: { id: m.itemId, schoolId: actor.school.id } });
  if (!item) throw new ApiError(404, "Store item not found");
  const change = m.type === "adjust" ? m.quantity.minus(item.quantity) : m.type === "issue" ? m.quantity.negated() : m.quantity;
  if (change.isZero()) throw new ApiError(400, m.type === "adjust" ? `The count matches what's recorded (${item.quantity} ${item.unit}); nothing to adjust.` : "Enter a quantity above zero.");
  const balance = item.quantity.plus(change);
  if (balance.isNegative()) throw new ApiError(409, `Only ${item.quantity} ${item.unit} of ${item.name} ${item.quantity.eq(1) ? "is" : "are"} in the store.`);
  await tx.storeItem.update({ where: { id: item.id }, data: { quantity: balance, ...(m.type === "receive" && m.unitCost ? { unitCost: m.unitCost } : {}) } });
  const row = await tx.stockMovement.create({ data: { schoolId: actor.school.id, itemId: item.id, type: m.type, quantity: change, balanceAfter: balance, unitCost: m.unitCost ?? null, date: D(m.date), issuedTo: m.issuedTo || null, reference: m.reference || null, note: m.note || null, orderId: m.orderId ?? null, createdBy: actor.user.id } });
  await audit(tx, actor, m.type === "adjust" ? "stock_counted" : `stock_${m.type}`, "store_item", item.id, { quantity: item.quantity.toString() }, { quantity: balance.toString(), movement: row.id });
  return row;
}

/** Used by LPO deliveries: goods received on an order go straight onto the shelf. */
export const receiveStock = (tx: Tx, actor: Actor, m: Omit<MovementInput, "type">) => move(tx, actor, { ...m, type: "receive" });

async function itemViews(schoolId: string, where: Prisma.StoreItemWhereInput = {}) {
  const [items, last] = await Promise.all([
    db.storeItem.findMany({ where: { schoolId, ...where }, orderBy: { name: "asc" } }),
    db.stockMovement.groupBy({ by: ["itemId"], where: { schoolId }, _max: { createdAt: true } }),
  ]);
  const lastAt = new Map(last.map(l => [l.itemId, l._max.createdAt]));
  return items.map(i => ({
    ...i, quantity: i.quantity.toString(), reorderLevel: i.reorderLevel.toString(), unitCost: i.unitCost?.toFixed(2) ?? null,
    value: i.unitCost ? i.quantity.times(i.unitCost).toFixed(2) : null, low: i.isActive && i.quantity.lte(i.reorderLevel), lastMovementAt: lastAt.get(i.id) ?? null,
  }));
}
async function movementViews(schoolId: string, rows: Prisma.StockMovementGetPayload<{ include: { item: true } }>[]) {
  const people = new Map((await db.user.findMany({ where: { schoolId }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  return rows.map(m => ({
    id: m.id, itemId: m.itemId, itemName: m.item.name, unit: m.item.unit, type: m.type, quantity: m.quantity.toString(), balanceAfter: m.balanceAfter.toString(),
    unitCost: m.unitCost?.toFixed(2) ?? null, date: day(m.date), issuedTo: m.issuedTo, reference: m.reference, note: m.note, orderId: m.orderId,
    createdByName: people.get(m.createdBy) ?? null, createdAt: m.createdAt,
  }));
}
const duplicate = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

router.get("/store/items", async (req, res) => {
  reader(req);
  send(res, "ListStoreItems", await itemViews(req.actor.school.id));
});
router.post("/store/items", async (req, res) => {
  need(req, "store");
  const input = body(z.CreateStoreItemBody, req.body);
  const schoolId = req.actor.school.id;
  const id = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const item = await tx.storeItem.create({ data: { schoolId, name: input.name, sku: input.sku || null, category: input.category, unit: input.unit, reorderLevel: qty(input.reorderLevel ?? "0"), unitCost: input.unitCost ? money(input.unitCost) : null, location: input.location || null } });
    await audit(tx, req.actor, "created", "store_item", item.id, undefined, item);
    // Stock already on the shelf comes in as an opening count, so the stock card starts from it.
    if (input.openingQuantity && qty(input.openingQuantity).gt(0)) await move(tx, req.actor, { itemId: item.id, type: "adjust", quantity: qty(input.openingQuantity), date: todayNairobi(), note: "Opening stock", unitCost: item.unitCost });
    return item.id;
  }).catch(e => { throw duplicate(e) ? new ApiError(409, `${input.name} is already in the store.`) : e; });
  send(res, "CreateStoreItem", (await itemViews(schoolId, { id }))[0]);
});
router.patch("/store/items/:id", async (req, res) => {
  need(req, "store");
  const { id } = parse(z.UpdateStoreItemParams, req.params);
  const input = body(z.UpdateStoreItemBody, req.body);
  await db.$transaction(async tx => {
    const before = await tx.storeItem.findFirst({ where: { id, schoolId: req.actor.school.id } });
    if (!before) throw new ApiError(404, "Store item not found");
    const after = await tx.storeItem.update({ where: { id }, data: { ...input, ...(input.reorderLevel !== undefined ? { reorderLevel: qty(input.reorderLevel) } : {}), ...(input.unitCost !== undefined ? { unitCost: input.unitCost ? money(input.unitCost) : null } : {}) } });
    await audit(tx, req.actor, "updated", "store_item", id, before, after);
  }).catch(e => { throw duplicate(e) ? new ApiError(409, "Another item already has that name.") : e; });
  send(res, "UpdateStoreItem", (await itemViews(req.actor.school.id, { id }))[0]);
});
router.get("/store/movements", async (req, res) => {
  reader(req);
  const q = parse(z.ListStockMovementsQueryParams, req.query);
  const rows = await db.stockMovement.findMany({
    where: { schoolId: req.actor.school.id, ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.type ? { type: q.type } : {}), date: { ...(q.from ? { gte: D(q.from) } : {}), ...(q.to ? { lte: D(q.to) } : {}) } },
    include: { item: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 2000,
  });
  send(res, "ListStockMovements", await movementViews(req.actor.school.id, rows));
});
router.post("/store/movements", async (req, res) => {
  need(req, "store");
  const input = body(z.CreateStockMovementBody, req.body);
  if (input.date > todayNairobi()) throw new ApiError(400, "Stock can't be moved on a future date.");
  if (input.type === "issue" && !input.issuedTo?.trim()) throw new ApiError(400, "Say who the stock is issued to, e.g. Kitchen or Grade 4 class teacher.");
  const row = await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    const m = await move(tx, req.actor, { ...input, quantity: qty(input.quantity), unitCost: input.unitCost ? money(input.unitCost) : null });
    return tx.stockMovement.findUniqueOrThrow({ where: { id: m.id }, include: { item: true } });
  });
  send(res, "CreateStockMovement", (await movementViews(req.actor.school.id, [row]))[0]);
});

export default router;
