import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { body, safeTenantRequest } from "./core";
import { requirePlatform } from "./platform";
import { hashPassword } from "./password";
import * as schemas from "@workspace/api-zod";
import type { Request } from "express";

test("platform contracts reject missing confirmations, escalation, and unsafe passwords", () => {
  assert.throws(() => body(schemas.EnterTenantAccessBody, { schoolId: randomUUID(), reason: "support" }));
  assert.throws(() => body(schemas.ResetPlatformAdminPasswordBody, { password: "short", reason: "support", confirmation: "CONFIRM" }));
  assert.throws(() => body(schemas.EditPlatformAdminBody.strict(), { role: "super_admin", reason: "support", confirmation: "CONFIRM" }));
  assert.throws(() => requirePlatform({ identity: { user: { role: "school_admin" } } } as Request));
  assert.equal(safeTenantRequest("POST", "/imports/students/preview"), true);
  assert.equal(safeTenantRequest("POST", "/reports/attendance"), true);
  for (const path of ["/reports/attendance/export", "/finance/invoices/preview", "/users", "/report-cards", "/imports/students/commit"]) assert.equal(safeTenantRequest("POST", path), false);
});

test("database actor guards allow independent owner, retain tenant scope and parent integrity", async () => {
  const rollback = new Error("rollback synthetic platform actor fixtures");
  await assert.rejects(db.$transaction(async tx => {
    const marker = `PLATFORM-ACTOR-TEST-${randomUUID()}`;
    const a = await tx.school.create({ data: { code: `${marker}-A`, name: marker, type: "primary" } });
    const b = await tx.school.create({ data: { code: `${marker}-B`, name: marker, type: "primary" } });
    const owner = await tx.user.create({ data: { name: marker, email: `${randomUUID()}@example.invalid`, passwordHash: "non-login-fixture", role: "super_admin" } });
    const staff = await tx.user.create({ data: { schoolId: a.id, name: marker, email: `${randomUUID()}@example.invalid`, passwordHash: "non-login-fixture", role: "school_admin" } });
    const payment = { provider: "synthetic-platform-test", channel: "bank", amount: "1.00", transactionTime: new Date(), source: "synthetic-fixture", rawPayload: {} };
    await tx.incomingPayment.create({ data: { ...payment, schoolId: a.id, providerTxnId: randomUUID(), requestedBy: owner.id } });
    await tx.incomingPayment.create({ data: { ...payment, schoolId: b.id, providerTxnId: randomUUID(), requestedBy: owner.id } });
    await tx.incomingPayment.create({ data: { ...payment, schoolId: a.id, providerTxnId: randomUUID(), requestedBy: staff.id } });
    await tx.$executeRawUnsafe("SAVEPOINT invalid_staff_scope");
    await assert.rejects(tx.incomingPayment.create({ data: { ...payment, schoolId: b.id, providerTxnId: randomUUID(), requestedBy: staff.id } }));
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_staff_scope");
    await tx.$executeRawUnsafe("SAVEPOINT invalid_parent_move");
    await assert.rejects(tx.user.update({ where: { id: staff.id }, data: { schoolId: b.id } }));
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_parent_move");
    await tx.$executeRawUnsafe("SAVEPOINT invalid_tenant_account");
    await assert.rejects(tx.user.create({ data: { name: marker, email: `${randomUUID()}@example.invalid`, passwordHash: "non-login-fixture", role: "school_admin" } }));
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_tenant_account");
    throw rollback;
  }, { timeout: 15000 }), error => error === rollback);
});

test("isolated platform HTTP acceptance: sessions, grants, suspension, admin safety and audit", { skip: process.env.PLATFORM_HTTP_TEST !== "1" }, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Platform fixtures are development-only");
  const marker = `PLATFORM-TEST-${randomUUID()}`;
  const password = `Synthetic!${randomUUID()}`;
  const schools: string[] = [];
  const users: string[] = [];
  const json = { "content-type": "application/json" };
  async function request(path: string, cookie = "", method = "GET", data?: unknown) {
    const res = await fetch(`http://localhost:80/api${path}`, { method, headers: { ...json, cookie }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    const value = await res.json();
    return { status: res.status, value, total: res.headers.get("X-Total-Count"), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
  }
  const confirmation = { reason: `${marker} synthetic acceptance`, confirmation: "CONFIRM" };
  try {
    const school = await db.school.create({ data: { code: marker, name: marker, type: "primary" } }); schools.push(school.id);
    const hash = await hashPassword(password);
    const owner = await db.user.create({ data: { name: marker, email: `${marker.toLowerCase()}-owner@example.invalid`, passwordHash: hash, role: "super_admin" } }); users.push(owner.id);
    const admin = await db.user.create({ data: { schoolId: school.id, name: marker, email: `${marker.toLowerCase()}-admin@example.invalid`, passwordHash: hash, role: "school_admin" } }); users.push(admin.id);
    const login = await request("/auth/login", "", "POST", { identifier: owner.email, password });
    assert.equal(login.status, 200); assert.equal(login.value.mode, "platform"); assert.equal(login.value.school, null);
    const otherLogin = await request("/auth/login", "", "POST", { identifier: owner.email, password });
    const tenant = await request("/auth/login", "", "POST", { identifier: admin.email, password });
    const otherSchool = await db.school.create({ data: { code: `${marker}-OTHER`, name: marker, type: "primary" } }); schools.push(otherSchool.id);
    const action = `${marker}.pagination`;
    await db.platformAudit.createMany({ data: [
      ...Array.from({ length: 5 }, (_, i) => ({ actorId: owner.id, schoolId: school.id, action, reason: `${marker} page fixture ${i}`, createdAt: new Date("2026-01-01T00:00:00Z") })),
      { actorId: owner.id, schoolId: school.id, action: `${marker}.excluded`, reason: `${marker} other action` },
      { actorId: owner.id, schoolId: otherSchool.id, action, reason: `${marker} other school` },
    ] });
    const filter = `schoolId=${school.id}&action=${encodeURIComponent(action)}&limit=2`;
    const firstPage = await request(`/platform/audit?${filter}&page=1`, login.cookie);
    const secondPage = await request(`/platform/audit?${filter}&page=2`, login.cookie);
    assert.equal(firstPage.status, 200); assert.equal(firstPage.total, "5");
    assert.equal(secondPage.total, "5"); assert.equal(secondPage.value.length, 2);
    assert.equal(firstPage.value.length, 2);
    assert.ok(secondPage.value.every((entry: { id: string; schoolId: string; action: string }) =>
      entry.schoolId === school.id && entry.action === action && !firstPage.value.some((first: { id: string }) => first.id === entry.id)));
    const lastPage = await request(`/platform/audit?${filter}&page=3`, login.cookie);
    assert.equal(lastPage.value.length, 1);
    assert.equal((await request(`/platform/audit?${filter}&search=${encodeURIComponent("page fixture 4")}`, login.cookie)).total, "1");
    assert.equal((await request(`/platform/audit?${filter}&page=2`, tenant.cookie)).status, 403);
    assert.equal((await request("/platform/audit?page=0", login.cookie)).status, 400);
    const overviewAudit = await request("/platform/audit?limit=8", login.cookie);
    assert.ok(Array.isArray(overviewAudit.value) && overviewAudit.value.length <= 8);
    assert.equal((await request("/platform/schools", tenant.cookie)).status, 403);
    assert.equal((await request("/platform/tenant-access", tenant.cookie, "POST", { ...confirmation, schoolId: school.id })).status, 403);
    assert.equal((await request("/school", login.cookie)).status, 403);
    const entered = await request("/platform/tenant-access", login.cookie, "POST", { ...confirmation, schoolId: school.id });
    assert.equal(entered.status, 200); assert.equal(entered.value.tenantAccess.writeEnabled, false);
    assert.equal((await request("/school", entered.cookie)).value.id, school.id);
    assert.equal((await request("/school", otherLogin.cookie)).status, 403);
    assert.equal((await request("/school", entered.cookie, "PATCH", { name: "Must not write" })).status, 403);
    const grant = await db.platformTenantGrant.findUniqueOrThrow({ where: { id: entered.value.tenantAccess.id } });
    await db.platformTenantGrant.update({ where: { id: grant.id }, data: { sessionId: "different-login" } });
    assert.equal((await request("/school", entered.cookie)).status, 403);
    await db.platformTenantGrant.update({ where: { id: grant.id }, data: { sessionId: grant.sessionId, expiresAt: new Date(0) } });
    assert.equal((await request("/school", entered.cookie)).status, 403);
    const exited = await request("/platform/tenant-access/exit", entered.cookie, "POST");
    assert.equal(exited.status, 200); assert.equal(exited.value.mode, "platform");
    assert.equal((await request(`/platform/schools/${school.id}/admins/${admin.id}`, exited.cookie, "PATCH", { ...confirmation, isActive: false })).status, 409);
    assert.equal((await request(`/platform/schools/${school.id}/admins/${admin.id}`, exited.cookie, "PATCH", { ...confirmation, role: "super_admin" })).status, 400);
    assert.equal((await request(`/platform/schools/${school.id}/admins/${admin.id}/reset-password`, exited.cookie, "POST", { ...confirmation, password: `${password}reset` })).status, 200);
    assert.equal((await request("/auth/me", tenant.cookie)).status, 401);
    assert.equal((await request(`/platform/schools/${school.id}`, exited.cookie, "PATCH", { ...confirmation, status: "suspended" })).status, 200);
    assert.equal((await request("/auth/login", "", "POST", { identifier: owner.email, password })).status, 200);
    assert.equal((await request("/platform/tenant-access", exited.cookie, "POST", { ...confirmation, schoolId: school.id })).status, 409);
    const logout = await request("/auth/logout", tenant.cookie, "POST");
    assert.equal(logout.status, 200); assert.equal(logout.cookie, "school_session=");
    const audit = await db.platformAudit.findMany({ where: { actorId: owner.id } });
    assert.ok(audit.some(a => a.action === "tenant.entered" && a.grantId === grant.id && a.schoolId === school.id));
    assert.ok(audit.some(a => a.action === "admin.password_reset" && a.reason === confirmation.reason));
    assert.equal(JSON.stringify(audit).includes(password), false);
  } finally {
    await db.platformAudit.deleteMany({ where: { actorId: { in: users } } });
    await db.platformTenantGrant.deleteMany({ where: { actorId: { in: users } } });
    await db.auditLog.deleteMany({ where: { schoolId: { in: schools } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.school.deleteMany({ where: { id: { in: schools } } });
  }
});