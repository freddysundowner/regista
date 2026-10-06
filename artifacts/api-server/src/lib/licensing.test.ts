import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { coverage, DAY_MS } from "./licensing";
import { hashPassword } from "./password";

test("licence coverage handles exact expiry, contiguous renewals, future gaps and revocation", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const row = (start: number, end: number, revoked = false) => ({ startsAt: new Date(+now + start), expiresAt: new Date(+now + end), revokedAt: revoked ? now : null });
  assert.equal(coverage(false, [], now).accessAllowed, true);
  assert.equal(coverage(true, [], now).accessAllowed, false);
  assert.equal(coverage(true, [row(-DAY_MS, 0)], now).accessAllowed, false);
  const continuous = coverage(true, [row(0, DAY_MS), row(DAY_MS, 2 * DAY_MS)], now);
  assert.equal(+continuous.currentEndsAt!, +now + 2 * DAY_MS);
  assert.equal(coverage(true, [row(1, DAY_MS)], now).status, "scheduled");
  assert.equal(+coverage(true, [row(-1, 100), row(101, 200)], now).currentEndsAt!, +now + 100);
  assert.equal(coverage(true, [row(-1, DAY_MS, true)], now).accessAllowed, false);
});

test("licensing HTTP: scoped immutable purchases, settlement, renewal, correction, expiry, admin grants and retry safety", { skip: process.env.LICENSING_HTTP_TEST !== "1" }, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Only synthetic development fixtures permitted");
  const app = (await import("../app")).default;
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const marker = `SYNTH-LICENCE-${randomUUID()}`;
  const password = `Synthetic!${randomUUID()}`;
  const schoolIds: string[] = [], userIds: string[] = [], planIds: string[] = [];
  async function call(path: string, cookie = "", method = "GET", data?: unknown) {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const value = await response.json();
    return { status: response.status, value, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie };
  }
  try {
    const passwordHash = await hashPassword(password);
    for (const name of ["A", "B"]) schoolIds.push((await db.school.create({ data: { name: `${marker}-${name}`, code: `${marker}-${name}`, type: "primary" } })).id);
    async function login(role: string, schoolId?: string) {
      const user = await db.user.create({ data: { role, schoolId, name: marker, email: `${randomUUID()}@example.invalid`, passwordHash } });
      userIds.push(user.id);
      const result = await call("/auth/login", "", "POST", { identifier: user.email, password });
      assert.equal(result.status, 200);
      return result.cookie;
    }
    const owner = await login("super_admin"), admin = await login("school_admin", schoolIds[0]);
    const other = await login("school_admin", schoolIds[1]), teacher = await login("teacher", schoolIds[0]);
    const platform = `/platform/schools/${schoolIds[0]}`;
    assert.equal((await call("/school/subscription")).status, 401);
    assert.equal((await call("/platform/licence-plans", admin)).status, 403);
    assert.equal((await call("/school/subscription", admin)).value.status, "unmanaged");
    const input = { name: marker, durationDays: 2, price: "900.00", subscriptionPrice: "100.10", isActive: true };
    for (const invalid of [{ ...input, price: "0" }, { ...input, subscriptionPrice: "0" }, { ...input, subscriptionPrice: "-1" }, { ...input, durationDays: 0 }, { ...input, price: "1.005" }])
      assert.equal((await call("/platform/licence-plans", owner, "POST", invalid)).status, 400);
    const plan = await call("/platform/licence-plans", owner, "POST", input);
    assert.equal(plan.status, 201, JSON.stringify(plan.value));
    planIds.push(plan.value.id);
    const renewal = { requestId: randomUUID(), planId: plan.value.id };
    assert.equal((await call("/school/subscription/orders", teacher, "POST", renewal)).status, 403);
    assert.equal((await call("/school/subscription/orders", admin, "POST", { ...renewal, schoolId: schoolIds[1] })).status, 400);
    const order = await call("/school/subscription/orders", admin, "POST", renewal);
    assert.equal(order.status, 201, JSON.stringify(order.value));
    assert.equal((await call("/school/subscription/orders", admin, "POST", renewal)).value.id, order.value.id);
    assert.equal((await call("/school/subscription/orders", admin, "POST", { ...renewal, requestId: randomUUID() })).status, 409);
    assert.equal((await call(`/school/subscription/orders/${order.value.id}/cancel`, other, "POST")).status, 404);
    assert.equal((await call("/school/subscription", teacher)).value.orders.length, 0);
    await call(`/platform/licence-plans/${plan.value.id}`, owner, "PATCH", { ...input, durationDays: 3, price: "900.00", subscriptionPrice: "250.20", isActive: false });
    assert.equal((await call("/school/subscription", admin)).value.plans.some((p: { id: string }) => p.id === plan.value.id), false);
    const bill = `${platform}/billing/invoices/${order.value.invoiceId}`;
    const p1 = { requestId: randomUUID(), amount: "40.05", paidOn: "2020-01-01", method: "bank", reference: randomUUID() };
    assert.equal((await call(`${bill}/payments`, owner, "POST", p1)).status, 201);
    assert.equal((await call("/school/subscription", admin)).value.licences.length, 0);
    assert.equal((await call(`/school/subscription/orders/${order.value.id}/cancel`, admin, "POST")).status, 409);
    const p2 = { ...p1, requestId: randomUUID(), amount: "60.05", reference: randomUUID() };
    const settled = await call(`${bill}/payments`, owner, "POST", p2);
    assert.equal(settled.status, 201, JSON.stringify(settled.value));
    assert.equal((await call(`${bill}/payments`, owner, "POST", p2)).status, 201);
    let summary = (await call("/school/subscription", admin)).value;
    assert.equal(summary.accessAllowed, true);
    assert.equal(summary.managed, true);
    assert.equal(summary.licences.length, 1);
    const original = summary.licences[0];
    assert.equal(original.price, "100.10");
    assert.equal(original.durationDays, 2);
    assert.equal(Date.parse(original.expiresAt) - Date.parse(original.startsAt), 2 * DAY_MS);
    assert.equal((await call(`${bill}/payments/${p2.requestId}/reverse`, owner, "POST", { reason: "Synthetic reversal check" })).status, 200);
    assert.equal((await call("/school/subscription", admin)).value.accessAllowed, false);
    assert.equal((await call("/dashboard", admin)).status, 402);
    assert.equal((await call("/auth/me", admin)).status, 200);
    assert.equal((await call(`${bill}/payments`, owner, "POST", { ...p2, requestId: randomUUID(), reference: randomUUID() })).status, 201);
    summary = (await call("/school/subscription", admin)).value;
    assert.equal(summary.licences.length, 1);
    assert.equal(summary.licences[0].startsAt, original.startsAt);
    assert.equal(summary.licences[0].expiresAt, original.expiresAt);
    assert.equal(summary.accessAllowed, true);
    await call(`/platform/licence-plans/${plan.value.id}`, owner, "PATCH", { ...input, durationDays: 3, price: "900.00", subscriptionPrice: "250.20", isActive: true });
    const futureOrder = await call("/school/subscription/orders", admin, "POST", { ...renewal, requestId: randomUUID() });
    assert.equal(futureOrder.status, 201);
    assert.equal((await call(`${platform}/billing/invoices/${futureOrder.value.invoiceId}/payments`, owner, "POST", { ...p1, requestId: randomUUID(), amount: "250.20", reference: randomUUID() })).status, 201);
    const renewed = (await call("/school/subscription", admin)).value;
    const extension = renewed.licences.find((l: { id: string }) => l.id !== original.id);
    assert.equal(extension.startsAt, original.expiresAt);
    assert.equal(Date.parse(extension.expiresAt) - Date.parse(extension.startsAt), 3 * DAY_MS);
    assert.equal(renewed.currentEndsAt, extension.expiresAt);
    const cancel = await call("/school/subscription/orders", admin, "POST", { ...renewal, requestId: randomUUID() });
    assert.equal((await call(`/school/subscription/orders/${cancel.value.id}/cancel`, admin, "POST")).value.status, "cancelled");
    const beforeCount = await db.schoolLicence.count({ where: { schoolId: schoolIds[0] } });
    const grant = { requestId: randomUUID(), planId: plan.value.id };
    assert.equal((await call(`${platform}/licences`, admin, "POST", grant)).status, 403);
    const issued = await call(`${platform}/licences`, owner, "POST", grant);
    assert.equal(issued.status, 201, JSON.stringify(issued.value));
    assert.equal(issued.value.price, "900.00", "Admin-issued licence uses licence price, not subscription price");
    assert.equal(issued.value.startsAt, extension.expiresAt);
    assert.equal((await call(`${platform}/licences`, owner, "POST", grant)).value.id, issued.value.id);
    assert.equal(await db.schoolLicence.count({ where: { schoolId: schoolIds[0] } }), beforeCount + 1);
    assert.equal((await call(`/platform/schools/${schoolIds[1]}/licences/${issued.value.id}/revoke`, owner, "POST")).status, 404);
    for (const licence of (await call("/school/subscription", admin)).value.licences)
      assert.equal((await call(`${platform}/licences/${licence.id}/revoke`, owner, "POST")).status, 200);
    assert.equal((await call("/school/subscription", admin)).value.accessAllowed, false);
    assert.equal((await call("/dashboard", admin)).status, 402);
    assert.equal((await call("/dashboard", teacher)).status, 402);
    const expiredRenewal = await call("/school/subscription/orders", admin, "POST", { ...renewal, requestId: randomUUID() });
    assert.equal(expiredRenewal.status, 201);
    const fresh = await call(`${platform}/licences`, owner, "POST", { ...grant, requestId: randomUUID() });
    assert.equal(fresh.status, 201);
    assert.ok(Math.abs(Date.parse(fresh.value.startsAt) - Date.now()) < 10000);
    assert.equal((await call("/school/subscription", admin)).value.accessAllowed, true);
    await db.school.update({ where: { id: schoolIds[0] }, data: { status: "suspended" } });
    assert.equal((await call(`${platform}/licences`, owner, "POST", { ...grant, requestId: randomUUID() })).status, 409);
    assert.equal((await call("/school/subscription", admin)).status, 403);
  } finally {
    if (planIds.length) await db.licencePlan.updateMany({ where: { id: { in: planIds } }, data: { isActive: false } });
    if (userIds.length) await db.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    if (schoolIds.length) await db.school.updateMany({ where: { id: { in: schoolIds } }, data: { status: "suspended" } });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await db.$disconnect();
  }
});
