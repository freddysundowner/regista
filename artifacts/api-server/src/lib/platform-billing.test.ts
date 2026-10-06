import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { body } from "./core";
import { hashPassword } from "./password";

test("platform billing validates precise money and real dates", () => {
  const input = { requestId: randomUUID(), description: "Subscription", amount: "500.25", issuedOn: "2026-10-01", dueOn: "2026-10-31" };
  assert.equal(body(schemas.CreatePlatformInvoiceBody.strict(), input).amount, "500.25");
  for (const amount of ["1.001", "-5", "NaN", "1e3", "10000000000"]) {
    assert.throws(() => body(schemas.CreatePlatformInvoiceBody.strict(), { ...input, amount }));
  }
  for (const issuedOn of ["2026-02-30", "yesterday", "2026-01-01T00:00:00Z", 0]) {
    assert.throws(() => body(schemas.CreatePlatformInvoiceBody.strict(), { ...input, issuedOn }));
  }
});

test("isolated platform billing HTTP: durable exact ledger, authorization, retry and correction safety", { skip: process.env.BILLING_HTTP_TEST !== "1" }, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development-only synthetic fixtures");
  const marker = `SYNTH-BILLING-${randomUUID()}`;
  const password = `Synthetic!${randomUUID()}`;
  const schools: string[] = [], users: string[] = [];
  const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:80/api";
  async function request(path: string, cookie = "", method = "GET", data?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: res.status, value: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
  }
  try {
    for (const suffix of ["A", "B"]) schools.push((await db.school.create({ data: { name: `${marker}-${suffix}`, code: `${marker}-${suffix}`, type: "primary" } })).id);
    const passwordHash = await hashPassword(password);
    const owner = await db.user.create({ data: { name: marker, email: `${marker.toLowerCase()}-owner@example.invalid`, role: "super_admin", passwordHash } });
    const staff = await db.user.create({ data: { schoolId: schools[0], name: marker, email: `${marker.toLowerCase()}-staff@example.invalid`, role: "school_admin", passwordHash } });
    users.push(owner.id, staff.id);
    const ownerLogin = await request("/auth/login", "", "POST", { identifier: owner.email, password });
    const staffLogin = await request("/auth/login", "", "POST", { identifier: staff.email, password });
    assert.equal(ownerLogin.status, 200); assert.equal(staffLogin.status, 200);
    const path = `/platform/schools/${schools[0]}/billing`;
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, staffLogin.cookie)).status, 403);
    assert.equal((await request(path, ownerLogin.cookie)).value.outstanding, "0.00");
    const input = { requestId: randomUUID(), description: "Synthetic annual subscription", amount: "100.10", issuedOn: "2020-01-01", dueOn: "2020-01-31" };
    assert.equal((await request(`${path}/invoices`, staffLogin.cookie, "POST", input)).status, 403);
    assert.equal((await request(`${path}/invoices`, ownerLogin.cookie, "POST", { ...input, amount: "0" })).status, 400);
    assert.equal((await request(`${path}/invoices`, ownerLogin.cookie, "POST", { ...input, dueOn: "2019-12-31" })).status, 400);
    const created = await request(`${path}/invoices`, ownerLogin.cookie, "POST", input);
    assert.equal(created.status, 201); assert.equal(created.value.status, "overdue");
    assert.equal(created.value.issuedOn, "2020-01-01");
    assert.equal((await request(`${path}/invoices`, ownerLogin.cookie, "POST", input)).value.id, created.value.id);
    assert.equal((await request(`${path}/invoices`, ownerLogin.cookie, "POST", { ...input, amount: "101" })).status, 409);
    assert.equal(await db.platformBillingInvoice.count({ where: { schoolId: schools[0] } }), 1);
    const invoicePath = `${path}/invoices/${created.value.id}`;
    const payment = { requestId: randomUUID(), amount: "40.05", paidOn: "2020-01-10", method: "bank", reference: "SYNTHETIC-RECEIPT-1" };
    const crossSchool = `/platform/schools/${schools[1]}/billing/invoices/${created.value.id}`;
    assert.equal((await request(`${crossSchool}/payments`, ownerLogin.cookie, "POST", payment)).status, 404);
    assert.equal((await request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", { ...payment, paidOn: "2999-01-01" })).status, 400);
    const partial = await request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", payment);
    assert.equal(partial.status, 201); assert.equal(partial.value.balance, "60.05");
    assert.equal((await request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", payment)).value.payments.length, 1);
    assert.equal((await request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", { ...payment, requestId: randomUUID() })).status, 409);
    assert.equal((await request(`${invoicePath}/void`, ownerLogin.cookie, "POST", { reason: "Synthetic correction" })).status, 409);
    const final = { ...payment, requestId: randomUUID(), reference: "SYNTHETIC-RECEIPT-2", amount: "60.05" };
    const racing = await Promise.all([final, { ...final, requestId: randomUUID(), reference: "SYNTHETIC-RECEIPT-3" }].map(p => request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", p)));
    assert.deepEqual(racing.map(r => r.status).sort(), [201, 409]);
    const billed = await request(path, ownerLogin.cookie);
    assert.equal(billed.value.totalPaid, "100.10"); assert.equal(billed.value.outstanding, "0.00");
    assert.equal(billed.value.invoices[0].status, "paid");
    for (const p of billed.value.invoices[0].payments) {
      assert.equal((await request(`${invoicePath}/payments/${p.id}/reverse`, ownerLogin.cookie, "POST", { reason: "Synthetic receipt correction" })).status, 200);
    }
    assert.equal((await request(path, ownerLogin.cookie)).value.outstanding, "100.10");
    assert.equal((await request(`${invoicePath}/void`, ownerLogin.cookie, "POST", { reason: "Synthetic invoice correction" })).value.status, "void");
    assert.equal((await request(`${invoicePath}/payments`, ownerLogin.cookie, "POST", { ...final, requestId: randomUUID() })).status, 409);
    const cleared = await request(path, ownerLogin.cookie);
    assert.equal(cleared.value.totalBilled, "0.00"); assert.equal(cleared.value.totalPaid, "0.00");
    assert.equal(cleared.value.invoices[0].payments.length, 2);
    assert.ok(cleared.value.invoices[0].payments.every((p: { reversedAt: string | null }) => p.reversedAt));
    const profile = await request(`/platform/schools/${schools[0]}`, ownerLogin.cookie, "PATCH", {
      address: "Synthetic address", email: "  BILLING@example.invalid ", phone: "0712345678",
      subscriptionPlan: "Synthetic Annual", subscriptionStartDate: "2026-01-01", subscriptionEndDate: "2027-01-01",
      reason: "Synthetic platform management", confirmation: "CONFIRM",
    });
    assert.equal(profile.status, 200); assert.equal(profile.value.email, "billing@example.invalid");
    assert.equal(profile.value.phone, "254712345678");
    assert.equal((await request("/auth/me", ownerLogin.cookie)).value.mode, "platform");
    const confirm = { reason: "Synthetic read-only protection", confirmation: "CONFIRM", schoolId: schools[0] };
    const grant = await request("/platform/tenant-access", ownerLogin.cookie, "POST", confirm);
    assert.equal(grant.status, 200);
    assert.equal((await request(`${path}/invoices`, grant.cookie, "POST", { ...input, requestId: randomUUID() })).status, 403);
    const audits = await db.platformAudit.findMany({ where: { actorId: owner.id, action: { startsWith: "billing." } } });
    assert.equal(audits.filter(a => a.action === "billing.invoice_created").length, 1);
    assert.equal(audits.filter(a => a.action === "billing.payment_recorded").length, 2);
    assert.equal(audits.filter(a => a.action === "billing.payment_reversed").length, 2);
    assert.equal(audits.filter(a => a.action === "billing.invoice_voided").length, 1);
  } finally {
    await db.platformTenantGrant.updateMany({ where: { actorId: { in: users }, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    await db.school.updateMany({ where: { id: { in: schools } }, data: { status: "suspended" } });
  }
});
