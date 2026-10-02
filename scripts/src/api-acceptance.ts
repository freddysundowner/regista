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
  assert.ok(login.value.user.lastLoginAt);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: a.admin.id } })).lastLoginAt);
  assert.equal(typeof (await call("/setup/status")).value.requiresSetupToken, "boolean");
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
  // Foundation gaps: independent teacher scope, audit redaction/privacy, platform
  // operational subscriptions, safe assets/settings and two-stage promotion.
  await call("/audit-logs", "GET", undefined, bc, 403);
  assert.deepEqual((await call("/dashboard/summary", "GET", undefined, bc)).value.recentActivity, []);
  await call("/audit-logs", "GET", undefined, pc);
  const settings = { autoPostThreshold: 90, siblingSplitRule: "ask_parent", reminderDays: [-3, 0, 3], absenceAlertsEnabled: true };
  const profile = (await call("/school", "PATCH", { settings }, a.cookie)).value;
  assert.deepEqual(profile.settings, settings);
  await call("/school", "PATCH", { settings: { apiKey: "not-allowed" } }, a.cookie, 400);
  await call("/school", "PATCH", { settings: { autoPostThreshold: 999 } }, a.cookie, 400);
  await call("/school", "PATCH", { logoUrl: "https://example.invalid/logo.png" }, a.cookie, 400);
  await call("/school", "PATCH", { logoUrl: `/api/storage/files/${randomUUID()}` }, a.cookie, 400);
  const general = (await call("/users", "POST", { name: "General Teacher", email: `general-${run}@example.invalid`, role: "teacher", password }, a.cookie, 201)).value;
  const generalCookie = token(general.id);
  assert.equal((await call("/students", "GET", undefined, generalCookie)).value.length, 0);
  const assignment = (await call("/teacher-assignments", "POST", { userId: general.id, streamId: otherStream.id }, a.cookie, 201)).value;
  await call("/teacher-assignments", "POST", { userId: general.id, streamId: otherStream.id }, a.cookie, 409);
  await call("/teacher-assignments", "POST", { userId: principal.id, streamId: stream.id }, a.cookie, 400);
  await call(`/teacher-assignments/${assignment.id}`, "DELETE", undefined, b.cookie, 404);
  const myLearners = (await call("/students", "GET", undefined, generalCookie)).value;
  assert.equal(myLearners.length, 1); assert.equal(myLearners[0].id, hidden.id);
  assert.equal((await call("/grades", "GET", undefined, generalCookie)).value.length, 1);
  assert.equal((await call("/streams", "GET", undefined, generalCookie)).value[0].id, otherStream.id);
  assert.equal((await call("/teacher-assignments", "GET", undefined, generalCookie)).value[0].id, assignment.id);
  await call(`/students/${student.id}`, "GET", undefined, generalCookie, 404);
  const privacy = (await call("/guardians", "POST", { name: "Private Person", phone: "0112999888", idNumber: "SYNTHETIC-ID", email: `privacy-${run}@example.invalid` }, a.cookie, 201)).value;
  assert.equal(privacy.phone, "254112999888");
  const privateStudent = (await call("/students", "POST", { admissionNo: "PRIVACY", firstName: "Private", lastName: "Learner", status: "active", boardingStatus: "day", pathway: "STEM", transportRouteId: "route-ref",
    guardians: [{ name: privacy.name, phone: privacy.phone, relationship: "Guardian", isPrimary: true }] }, a.cookie, 201)).value;
  assert.equal(privateStudent.pathway, "STEM"); assert.equal(privateStudent.transportRouteId, "route-ref");
  await call(`/students/${privateStudent.id}`, "PATCH", { photoUrl: `/api/storage/files/${randomUUID()}` }, a.cookie, 400);
  await call(`/guardians/${privacy.id}/export`, "GET", undefined, bc, 403);
  await call(`/guardians/${privacy.id}/export`, "GET", undefined, b.cookie, 404);
  const exported = (await call(`/guardians/${privacy.id}/export`, "GET", undefined, a.cookie)).value;
  assert.equal(exported.guardian.idNumber, "SYNTHETIC-ID");
  assert.equal(exported.links[0].studentId, privateStudent.id);
  await call(`/guardians/${privacy.id}/anonymize`, "POST", { confirmation: "yes" }, a.cookie, 400);
  const anonymized = (await call(`/guardians/${privacy.id}/anonymize`, "POST", { confirmation: "ANONYMIZE" }, a.cookie)).value;
  assert.equal(anonymized.idNumber, null); assert.equal(anonymized.email, null);
  assert.ok(anonymized.anonymizedAt); assert.equal(anonymized.studentCount, 1);
  assert.equal(await db.student.count({ where: { id: privateStudent.id } }), 1);
  assert.equal(await db.studentGuardian.count({ where: { guardianId: privacy.id, receivesNotifications: true } }), 0);
  await call(`/guardians/${privacy.id}`, "PATCH", { name: "Revive", phone: "0112999888" }, a.cookie, 409);
  await call(`/students/${privateStudent.id}`, "PATCH", { status: "left" }, a.cookie);
  const auditLogs = (await call("/audit-logs?limit=100", "GET", undefined, a.cookie)).value;
  const changed = auditLogs.find((l: any) => l.entityId === privateStudent.id && l.action === "updated");
  assert.equal(changed.before.status, "active"); assert.equal(changed.after.status, "left");
  assert.ok(changed.ip); assert.ok(changed.userAgent);
  assert.equal(changed.before.firstName, "[REDACTED]");
  assert.ok(!JSON.stringify(auditLogs).includes("SYNTHETIC-ID"));
  const owner = await db.user.create({ data: { name: "Synthetic Platform Owner", role: "super_admin", schoolId: null, sessionSchoolId: a.school.id, email: `platform-${run}@example.invalid`, passwordHash: hash } });
  const ownerCookie = token(owner.id);
  const ownerSession = (await call("/auth/me", "GET", undefined, ownerCookie)).value;
  assert.equal(ownerSession.user.schoolId, null); assert.equal(ownerSession.school.id, a.school.id);
  await call(`/schools/${b.school.id}`, "PATCH", { subscriptionPlan: "pilot" }, a.cookie, 403);
  await call(`/schools/${b.school.id}`, "PATCH", { subscriptionStartDate: "2027-12-31", subscriptionEndDate: "2027-01-01" }, ownerCookie, 400);
  const subscription = (await call(`/schools/${b.school.id}`, "PATCH", { subscriptionPlan: "pilot", subscriptionStatus: "active", subscriptionStartDate: "2027-01-01", subscriptionEndDate: "2027-12-31", status: "suspended" }, ownerCookie)).value;
  assert.equal(subscription.subscriptionPlan, "pilot"); assert.equal(subscription.subscriptionEndDate, "2027-12-31");
  await call("/auth/me", "GET", undefined, b.cookie, 401);
  await call(`/schools/${b.school.id}`, "PATCH", { status: "active" }, ownerCookie);
  await call("/auth/me", "GET", undefined, b.cookie);
  await call(`/schools/${a.school.id}`, "PATCH", { status: "suspended" }, ownerCookie, 409);
  const targetYear = (await call("/academic-years", "GET", undefined, a.cookie)).value.find((y: any) => y.name === "Concurrent 1");
  const targetStream = (await call("/streams", "POST", { name: "Next", gradeId: g2.id }, a.cookie, 201)).value;
  const promotionInput = { sourceYearId: year.id, targetYearId: targetYear.id, sourceStreamId: otherStream.id, targetStreamId: targetStream.id, action: "promote" };
  await call("/promotions/preview", "POST", promotionInput, bc, 403);
  await call("/promotions/preview", "POST", promotionInput, b.cookie, 404);
  const stale = (await call("/promotions/preview", "POST", promotionInput, a.cookie)).value;
  assert.equal(stale.count, 1); assert.equal(stale.students[0].id, hidden.id);
  await call(`/students/${hidden.id}`, "PATCH", { pathway: "STEM" }, a.cookie);
  await call("/promotions/commit", "POST", { previewToken: stale.previewToken, confirmation: "PROMOTE" }, a.cookie, 409);
  const promotion = (await call("/promotions/preview", "POST", promotionInput, a.cookie)).value;
  await call("/promotions/commit", "POST", { previewToken: promotion.previewToken, confirmation: "PROMOTE" }, ownerCookie, 400);
  const promoted = (await call("/promotions/commit", "POST", { previewToken: promotion.previewToken, confirmation: "PROMOTE" }, a.cookie)).value;
  assert.equal(promoted.updatedStudents, 1);
  assert.equal((await call(`/students/${hidden.id}`, "GET", undefined, a.cookie)).value.streamId, targetStream.id);
  await call("/promotions/commit", "POST", { previewToken: promotion.previewToken, confirmation: "PROMOTE" }, a.cookie, 409);
  const graduate = (await call("/promotions/preview", "POST", { sourceYearId: year.id, targetYearId: targetYear.id, sourceStreamId: stream.id, action: "graduate" }, a.cookie)).value;
  assert.equal((await call("/promotions/commit", "POST", { previewToken: graduate.previewToken, confirmation: "PROMOTE" }, a.cookie)).value.updatedStudents, 500);
  assert.equal((await call(`/students/${student.id}`, "GET", undefined, a.cookie)).value.status, "graduated");
  await call(`/teacher-assignments/${assignment.id}`, "DELETE", undefined, a.cookie);
  assert.equal((await call("/teacher-assignments", "GET", undefined, generalCookie)).value.length, 0);
  await call("/auth/password", "POST", { currentPassword: "incorrect", newPassword: `${password}-new` }, generalCookie, 403);
  const changedPassword = await call("/auth/password", "POST", { currentPassword: password, newPassword: `${password}-new` }, generalCookie);
  await call("/auth/me", "GET", undefined, generalCookie, 401);
  await call("/auth/me", "GET", undefined, changedPassword.response.headers.get("set-cookie")!.split(";")[0]);
  await call("/auth/login", "POST", { identifier: general.email, password }, undefined, 401);
  await call("/auth/login", "POST", { identifier: general.email, password: `${password}-new` });
  const setupInput = { schoolName: `Forbidden setup ${run}`, schoolCode: `SETUP-${run}`, schoolType: "primary", adminName: "Synthetic Administrator", email: `setup-${run}@example.invalid`, password };
  await Promise.all([1, 2].map(() => call("/setup", "POST", setupInput, undefined, 409)));
  const csrf = await fetch(`${base}/students`, { method: "POST", headers: { Cookie: a.cookie, "Content-Type": "application/json", Origin: "https://evil.example.invalid" }, body: "{}" });
  assert.equal(csrf.status, 403);
  await db.user.update({ where: { id: teacher.id }, data: { isActive: false } });
  await call("/auth/me", "GET", undefined, tc, 401);
  console.info("API acceptance passed: 500-row imports, tenant/role isolation, family merging, audit snapshots and permissions, nullable platform ownership, subscriptions, settings, privacy, independent teaching assignments, stale/replayed promotions, own-password session invalidation and existing foundation checks.");
} finally {
  if (ids.length) await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.storedFile.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.teacherAssignment.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.studentGuardian.deleteMany({ where: { student: { schoolId: { in: ids } } } });
    await tx.student.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.guardian.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.family.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.stream.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.grade.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.term.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await tx.user.deleteMany({ where: { OR: [{ schoolId: { in: ids } }, { sessionSchoolId: { in: ids } }] } });
    await tx.school.deleteMany({ where: { id: { in: ids } } });
  }, { timeout: 30000 });
  await db.$disconnect();
}