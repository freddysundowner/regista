import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { hashPassword } from "./password";

test("public registration requires only essentials and rejects privilege fields", () => {
  const input = { schoolName: "Synthetic School", schoolType: "primary", adminName: "Synthetic Admin", email: "synthetic@example.invalid", password: "SyntheticOnly!123" };
  assert.ok(schemas.RegisterSchoolBody.strict().safeParse(input).success);
  for (const extra of [{ role: "super_admin" }, { status: "active" }, { schoolId: randomUUID() }]) {
    assert.equal(schemas.RegisterSchoolBody.strict().safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(schemas.RegisterSchoolBody.safeParse({ ...input, password: "short" }).success, false);
  assert.equal(schemas.RegisterSchoolBody.safeParse({ ...input, email: "not-email" }).success, false);
});

test("isolated registration HTTP: approval gate, rollback, review authorization and persisted status", { skip: process.env.REGISTRATION_HTTP_TEST !== "1" }, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development fixtures only");
  const marker = `SYNTH-REG-${randomUUID()}`;
  const password = `Synthetic!${randomUUID()}`;
  const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:80/api";
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  async function request(path: string, cookie = "", method = "GET", data?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: res.status, value: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
  }
  try {
    const owner = await db.user.create({ data: { name: marker, email: `${marker.toLowerCase()}-owner@example.invalid`,
      role: "super_admin", passwordHash: await hashPassword(password) } });
    userIds.push(owner.id);
    const ownerLogin = await request("/auth/login", "", "POST", { identifier: owner.email, password });
    assert.equal(ownerLogin.status, 200);
    const input = { schoolName: marker, schoolType: "primary", adminName: marker,
      email: `${marker.toLowerCase()}@example.invalid`, password };
    assert.equal((await request("/auth/register", "", "POST", { ...input, role: "super_admin" })).status, 400);
    assert.equal((await request("/auth/register", "", "POST", { ...input, schoolName: "   " })).status, 400);
    const registration = await request("/auth/register", "", "POST", input);
    assert.equal(registration.status, 201);
    schoolIds.push(registration.value.school.id); userIds.push(registration.value.user.id);
    assert.equal(registration.value.mode, "registration");
    assert.equal(registration.value.school.status, "pending");
    assert.equal(registration.value.user.role, "school_admin");
    assert.equal(registration.value.user.passwordHash, undefined);
    assert.equal((await request("/school", registration.cookie)).status, 403);
    assert.equal((await request("/students", registration.cookie)).status, 403);
    assert.equal((await request("/platform/schools", registration.cookie)).status, 403);
    assert.equal((await request("/auth/me", registration.cookie)).value.mode, "registration");
    const again = await request("/auth/login", "", "POST", { identifier: input.email, password });
    assert.equal(again.status, 200); assert.equal(again.value.mode, "registration");
    assert.equal((await request("/auth/register", "", "POST", { ...input, email: input.email.toUpperCase() })).status, 409);
    assert.equal(await db.school.count({ where: { name: marker } }), 1, "duplicate email rolls back whole school creation");
    const reviewPath = `/platform/schools/${schoolIds[0]}/registration`;
    assert.equal((await request(reviewPath, registration.cookie, "POST", { decision: "approve" })).status, 403);
    assert.equal((await request(`/platform/schools/${schoolIds[0]}`, ownerLogin.cookie, "PATCH",
      { status: "active", reason: "Synthetic review bypass", confirmation: "CONFIRM" })).status, 409);
    assert.equal((await request("/platform/tenant-access", ownerLogin.cookie, "POST",
      { schoolId: schoolIds[0], reason: "Synthetic pending access", confirmation: "CONFIRM" })).status, 409);
    assert.equal((await request(reviewPath, ownerLogin.cookie, "POST", { decision: "reject" })).status, 400);
    assert.equal((await request(reviewPath, ownerLogin.cookie, "POST", { decision: "reject", reason: "Synthetic verification declined" })).status, 200);
    const rejected = await request("/auth/me", registration.cookie);
    assert.equal(rejected.value.school.status, "rejected");
    assert.equal(rejected.value.school.registrationNote, "Synthetic verification declined");
    assert.equal((await request("/school", registration.cookie)).status, 403);
    const reviews = await Promise.all([1, 2].map(() => request(reviewPath, ownerLogin.cookie, "POST", { decision: "approve" })));
    assert.deepEqual(reviews.map(r => r.status).sort(), [200, 409]);
    const approved = await request("/auth/me", registration.cookie);
    assert.equal(approved.value.mode, "tenant"); assert.equal(approved.value.school.registrationNote, null);
    assert.equal((await request("/school", registration.cookie)).value.id, schoolIds[0]);
    const audits = await db.platformAudit.findMany({ where: { actorId: owner.id, schoolId: schoolIds[0] } });
    assert.equal(audits.filter(a => a.action === "school.registration_approved").length, 1);
    assert.equal(audits.filter(a => a.action === "school.registration_rejected").length, 1);
    assert.equal(JSON.stringify(audits).includes(password), false);
  } finally {
    // Preserve append-only audit history; make every fixture unusable after the check.
    await db.platformTenantGrant.updateMany({ where: { actorId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    await db.school.updateMany({ where: { id: { in: schoolIds } }, data: { status: "suspended" } });
  }
});
