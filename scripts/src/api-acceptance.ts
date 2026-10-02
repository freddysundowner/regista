import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { db } from "@workspace/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Acceptance fixtures are development-only");
if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
const base = "http://localhost:80/api";
const ids: string[] = [];
const password = randomBytes(24).toString("base64url");
const material = createHash("sha384").update("school-password-v1\0").update(password).digest("base64");
const hash = await bcrypt.hash(material, 12);
const run = randomUUID().slice(0, 8);
function token(userId: string) {
  return `school_session=${jwt.sign({}, process.env.SESSION_SECRET!, { subject: userId, expiresIn: "15m", issuer: "school-api", audience: "school-web" })}`;
}
async function call(path: string, method = "GET", data?: unknown, cookie?: string, expected = 200) {
  const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const value = await response.json() as any;
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
  return { value, response };
}
async function fixture(label: string) {
  const school = await db.school.create({ data: { name: `Synthetic acceptance ${label} ${run}`, code: `ACCEPT-${label}-${run}`, type: "primary" } });
  ids.push(school.id);
  const admin = await db.user.create({ data: { schoolId: school.id, name: "Synthetic Administrator", email: `accept-${label}-${run}@example.invalid`, role: "school_admin", passwordHash: hash } });
  return { school, admin, cookie: token(admin.id) };
}
try {
  await call("/health");
  await call("/students", "GET", undefined, undefined, 401);
  const a = await fixture("a"), b = await fixture("b");
  const g = (await call("/grades", "POST", { name: "Synthetic Grade", levelBand: "lower_primary", order: 1 }, a.cookie, 201)).value;
  const g2 = (await call("/grades", "POST", { name: "Synthetic Other Grade", levelBand: "lower_primary", order: 2 }, a.cookie, 201)).value;
  const gb = (await call("/grades", "POST", { name: "Synthetic Grade", levelBand: "lower_primary", order: 1 }, b.cookie, 201)).value;
  const teacher = (await call("/users", "POST", { name: "Synthetic Teacher", email: `teacher-${run}@example.invalid`, role: "class_teacher", password }, a.cookie, 201)).value;
  const bursar = (await call("/users", "POST", { name: "Synthetic Bursar", email: `bursar-${run}@example.invalid`, role: "bursar", password }, a.cookie, 201)).value;
  const principal = (await call("/users", "POST", { name: "Synthetic Principal", email: `principal-${run}@example.invalid`, role: "principal", password }, a.cookie, 201)).value;
  const tc = token(teacher.id), bc = token(bursar.id), pc = token(principal.id);
  const stream = (await call("/streams", "POST", { name: "A", gradeId: g.id, classTeacherUserId: teacher.id }, a.cookie, 201)).value;
  const otherStream = (await call("/streams", "POST", { name: "B", gradeId: g.id }, a.cookie, 201)).value;
  const login = await call("/auth/login", "POST", { identifier: a.admin.email, password });
  const setCookie = login.response.headers.get("set-cookie")!;
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i); assert.match(setCookie, /Max-Age=/i);
  assert.ok(!JSON.stringify(login.value).includes("passwordHash"));
  await call("/users", "POST", { name: "Forbidden", role: "super_admin", password, email: `forbidden-${run}@example.invalid` }, a.cookie, 403);
  await call(`/users/${a.admin.id}`, "PATCH", { isActive: false }, a.cookie, 409);
  await call("/grades", "POST", { name: "Denied", levelBand: "other", order: 9 }, bc, 403);
  await call("/students", "POST", { admissionNo: "tenant-invalid", firstName: "Synthetic", lastName: "Pupil", gradeId: gb.id, status: "active", boardingStatus: "day" }, a.cookie, 404);
  const hidden = (await call("/students", "POST", { admissionNo: "hidden", firstName: "Synthetic", lastName: "Hidden", gradeId: g.id, streamId: otherStream.id, status: "active", boardingStatus: "day" }, bc, 201)).value;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    admissionNo: `S-${i}`, firstName: `Synthetic${i}`, lastName: "Pupil", gradeName: "Synthetic Grade", streamName: "A",
    guardianName: "Synthetic Guardian", guardianPhone: `0710${String(100000 + Math.floor(i / 2)).padStart(6, "0")}`, guardianRelationship: "Guardian", boardingStatus: "day",
  }));
  const preview = (await call("/imports/students/preview", "POST", { rows }, bc)).value;
  assert.equal(preview.validRows, 500); assert.equal(preview.siblingMatches, 250);
  const commit = (await call("/imports/students/commit", "POST", { rows }, bc)).value;
  assert.equal(commit.createdStudents, 500); assert.equal(commit.linkedGuardians, 500);
  const duplicate = (await call("/imports/students/commit", "POST", { rows }, bc)).value;
  assert.equal(duplicate.createdStudents, 0); assert.equal(duplicate.skippedRows, 500);
  const invalidPreview = (await call("/imports/students/preview", "POST", { rows: [
    { admissionNo: "bad", firstName: " ", lastName: "Pupil", gradeName: "Missing", dateOfBirth: "2025-02-30", boardingStatus: "spaceship", guardianName: "Synthetic", guardianPhone: "123" },
    { ...rows[0], admissionNo: "in-file" }, { ...rows[0], admissionNo: "in-file" },
  ] }, bc)).value;
  assert.equal(invalidPreview.errorRows, 1); assert.equal(invalidPreview.duplicateRows, 1);
  assert.ok(invalidPreview.rows[0].errors.length >= 3);
  const listed = (await call("/students", "GET", undefined, tc)).value;
  assert.equal(listed.length, 500); assert.ok(listed.every((s: any) => s.streamId === stream.id));
  assert.ok(listed.every((s: any) => s.siblingCount === 1));
  const student = listed[0];
  await call(`/students/${hidden.id}`, "GET", undefined, tc, 404);
  await call(`/students/${student.id}`, "GET", undefined, b.cookie, 404);
  await call(`/students/${student.id}`, "PATCH", { gradeId: g2.id }, bc, 400);
  await call(`/students/${student.id}`, "PATCH", { firstName: "Forbidden" }, tc, 403);
  await call(`/students/${student.id}`, "PATCH", { firstName: "Forbidden" }, pc, 403);
  for (const path of ["/guardians", "/families", "/audit-logs", "/users"]) await call(path, "GET", undefined, tc, 403);
  assert.equal((await call("/students", "GET", undefined, b.cookie)).value.length, 0);
  const families = (await call("/families", "GET", undefined, a.cookie)).value;
  assert.equal(families.length, 250); assert.ok(families.every((f: any) => f.students.length === 2));
  // Bridge two existing families and verify all four connected siblings move together.
  const original = (await call(`/students/${student.id}`, "GET", undefined, a.cookie)).value;
  const other = listed.find((s: any) => s.familyId !== original.familyId);
  await call(`/students/${student.id}/guardians`, "POST", { name: "Synthetic Shared Guardian", phone: other.guardianPhones[0], relationship: "Guardian" }, bc);
  const bridged = (await call(`/students/${student.id}`, "GET", undefined, a.cookie)).value;
  assert.equal(bridged.siblingCount, 3);
  const year = (await call("/academic-years", "POST", { name: "Synthetic Year", startDate: "2026-01-01", endDate: "2026-12-31", isCurrent: true }, a.cookie, 201)).value;
  assert.equal(year.startDate, "2026-01-01");
  await call("/terms", "POST", { academicYearId: year.id, name: "Invalid Term", startDate: "2025-01-01", endDate: "2026-04-01" }, a.cookie, 400);
  await Promise.all([1, 2].map(i => call("/academic-years", "POST", { name: `Concurrent ${i}`, startDate: "2027-01-01", endDate: "2027-12-31", isCurrent: true }, a.cookie, 201)));
  assert.equal(await db.academicYear.count({ where: { schoolId: a.school.id, isCurrent: true } }), 1);
  const setupInput = { schoolName: `Forbidden setup ${run}`, schoolCode: `SETUP-${run}`, schoolType: "primary", adminName: "Synthetic Administrator", email: `setup-${run}@example.invalid`, password };
  await Promise.all([1, 2].map(() => call("/setup", "POST", setupInput, undefined, 409)));
  const csrf = await fetch(`${base}/students`, { method: "POST", headers: { Cookie: a.cookie, "Content-Type": "application/json", Origin: "https://evil.example.invalid" }, body: "{}" });
  assert.equal(csrf.status, 403);
  await db.user.update({ where: { id: teacher.id }, data: { isActive: false } });
  await call("/auth/me", "GET", undefined, tc, 401);
  console.info("API acceptance passed: 500-row imports, duplicates, invalid rows, tenant/role isolation, family merging, current-year concurrency, disabled setup concurrency, dates, cookies, CSRF and active-user verification.");
} finally {
  if (ids.length) await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.studentGuardian.deleteMany({ where: { student: { schoolId: { in: ids } } } });
    await tx.student.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.guardian.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.family.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.stream.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.grade.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.term.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.user.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.school.deleteMany({ where: { id: { in: ids } } });
  }, { timeout: 30000 });
  await db.$disconnect();
}