import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { phone, body, validDate, send, lock, redactSnapshot, streamAccess, validateAsset } from "./core";
import { verifySetupToken } from "../routes/auth";
import { signPromotion, readPromotion, promotionRoster } from "./promotions";
import { hashPassword, verifyPassword } from "./password";
import { importPreview, createStudentRecord, linkGuardian, mergeFamily, studentInclude, studentView, checkPlacement } from "./students";
import type { Response } from "express";

test("Kenyan phone normalization accepts all supported forms and rejects invalid phones", () => {
  for (const input of ["0712345678", "712345678", "+254712345678", "254712345678", "07 1234 5678"]) assert.equal(phone(input), "254712345678");
  for (const input of ["0112345678", "112345678", "+254112345678"]) assert.equal(phone(input), "254112345678");
  for (const input of ["123", "+15551234567", "0271234567", "07123456789"]) assert.throws(() => phone(input));
});
test("audit snapshots deeply redact credentials and personal information while preserving changed state", () => {
  const value = redactSnapshot({ name: "Private", phone: "254712345678", idNumber: "1234567", passwordHash: "hash", nested: { setupToken: "secret", firstName: "Private" }, status: "active", count: 2 });
  assert.equal(JSON.stringify(value).includes("Private"), false);
  assert.equal(JSON.stringify(value).includes("254712"), false);
  assert.equal((value as any).status, "active");
  assert.equal((value as any).nested.setupToken, "[REDACTED]");
});
test("production owner setup is fail-closed, token-gated; development is unchanged", () => {
  const prior = { node: process.env.NODE_ENV, token: process.env.SETUP_TOKEN, deployment: process.env.REPLIT_DEPLOYMENT };
  try {
    process.env.NODE_ENV = "production"; delete process.env.SETUP_TOKEN;
    assert.throws(() => verifySetupToken(), /disabled/);
    process.env.SETUP_TOKEN = "secure-test-token-".repeat(3);
    assert.throws(() => verifySetupToken("wrong"), /valid setup token/);
    verifySetupToken(process.env.SETUP_TOKEN);
    process.env.NODE_ENV = "development"; delete process.env.REPLIT_DEPLOYMENT;
    verifySetupToken();
  } finally {
    for (const [key, value] of [["NODE_ENV", prior.node], ["SETUP_TOKEN", prior.token], ["REPLIT_DEPLOYMENT", prior.deployment]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
test("safe settings, image references and promotion confirmations validate at contract boundary", () => {
  assert.throws(() => body(z.UpdateSchoolBody, { settings: { autoPostThreshold: 151 } }));
  assert.throws(() => body(z.UpdateSchoolBody, { logoUrl: "https://example.invalid/logo.png" }));
  assert.throws(() => body(z.UpdateStudentBody, { photoUrl: "data:image/png;base64,AA==" }));
  assert.throws(() => body(z.AnonymizeGuardianBody, { confirmation: "yes" }));
  assert.throws(() => body(z.CommitPromotionBody, { previewToken: "test", confirmation: "yes" }));
  assert.throws(() => body(z.UpdatePlatformSchoolBody, { subscriptionEndDate: "2027-02-30" }));
  assert.ok(streamAccess(randomUUID()).OR?.length === 2);
});
test("bcrypt passwords distinguish the complete password after the 72-byte boundary", async () => {
  const password = "a".repeat(90) + "secret";
  const hash = await hashPassword(password);
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("a".repeat(90) + "other", hash), false);
});
test("calendar validation rejects overflow dates and generated response serialization preserves date-only values", () => {
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2025-02-29"), false);
  assert.throws(() => body(z.CreateAcademicYearBody, { name: "Year", startDate: "2025-02-30", endDate: "2025-12-31" }));
  const record = body(z.CreateAcademicYearBody, { name: "Year", startDate: "2025-01-01", endDate: "2025-12-31" });
  let output: any;
  const response = { status: () => response, json: (value: any) => { output = value; } } as unknown as Response;
  send(response, "CreateAcademicYear", { id: randomUUID(), ...record });
  assert.equal(output.startDate, "2025-01-01");
  assert.equal(output.endDate, "2025-12-31");
});
test("development transaction: 500 imports, useful errors, duplicate revalidation, same-tenant placement, sibling family bridges", { timeout: 180000 }, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Integration fixture test is development-only");
  const rollback = new Error("Rollback synthetic fixtures");
  try {
    await db.$transaction(async tx => {
      const code = `UNIT-${randomUUID()}`;
      const school = await tx.school.create({ data: { code, name: "Synthetic Unit School", type: "primary" } });
      const user = await tx.user.create({ data: { schoolId: school.id, name: "Synthetic Administrator", email: `${randomUUID()}@example.invalid`, passwordHash: "non-login-test-record", role: "school_admin" } });
      const actor = { school, user };
      const promotionInput = { sourceYearId: randomUUID(), targetYearId: randomUUID(), sourceStreamId: randomUUID(), action: "graduate" as const };
      const previewToken = signPromotion(actor, promotionInput, "fingerprint");
      assert.equal(readPromotion(actor, previewToken).fingerprint, "fingerprint");
      assert.throws(() => readPromotion({ ...actor, user: { ...user, id: randomUUID() } }, previewToken), /invalid or expired/);
      assert.throws(() => readPromotion({ ...actor, school: { ...school, id: randomUUID() } }, previewToken), /invalid or expired/);
      await lock(tx, school.id);
      const grade = await tx.grade.create({ data: { schoolId: school.id, name: "Synthetic Grade", levelBand: "lower_primary", order: 1 } });
      const stream = await tx.stream.create({ data: { schoolId: school.id, gradeId: grade.id, name: "A" } });
      const sourceYear = await tx.academicYear.create({ data: { schoolId: school.id, name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
      const targetYear = await tx.academicYear.create({ data: { schoolId: school.id, name: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") } });
      const otherGrade = await tx.grade.create({ data: { schoolId: school.id, name: "Other Grade", levelBand: "lower_primary", order: 2 } });
      await assert.rejects(() => checkPlacement(tx, school.id, otherGrade.id, stream.id), /Stream must belong/);
      const otherSchool = await tx.school.create({ data: { code: `${code}-OTHER`, name: "Synthetic Other School", type: "primary" } });
      const foreignGrade = await tx.grade.create({ data: { schoolId: otherSchool.id, name: "Foreign Grade", levelBand: "other", order: 1 } });
      await assert.rejects(() => checkPlacement(tx, school.id, foreignGrade.id, null), /Record not found/);
      const rows = Array.from({ length: 500 }, (_, i) => ({ admissionNo: `S-${i}`, firstName: `Synthetic${i}`, lastName: "Pupil", gradeName: grade.name, streamName: stream.name,
        guardianName: "Synthetic Guardian", guardianPhone: `0710${String(100000 + Math.floor(i / 2)).padStart(6, "0")}` }));
      const preview = await importPreview(tx, actor, rows);
      assert.equal(preview.preview.validRows, 500);
      assert.equal(preview.preview.siblingMatches, 250);
      let siblingGroups = 0;
      for (const input of preview.inputs) {
        const result = await createStudentRecord(tx, actor, input);
        if (result.groupCreated) siblingGroups++;
      }
      assert.equal(siblingGroups, 250);
      assert.equal(await tx.student.count({ where: { schoolId: school.id } }), 500);
      assert.equal(await tx.guardian.count({ where: { schoolId: school.id } }), 250);
      assert.equal(await tx.family.count({ where: { schoolId: school.id } }), 250);
      const duplicate = await importPreview(tx, actor, rows);
      assert.equal(duplicate.preview.duplicateRows, 500);
      const invalid = await importPreview(tx, actor, [{ admissionNo: "", firstName: " ", lastName: "Pupil", gradeName: "Absent", dateOfBirth: "2025-02-30", gender: "invalid", boardingStatus: "invalid", guardianPhone: "bad" }]);
      assert.equal(invalid.preview.errorRows, 1);
      assert.ok(invalid.preview.rows[0].errors.length >= 3);
      const first = await tx.student.findUniqueOrThrow({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo: "S-0" } }, include: studentInclude });
      const roster = await promotionRoster(tx, actor, { sourceYearId: sourceYear.id, targetYearId: targetYear.id, sourceStreamId: stream.id, action: "graduate" });
      assert.equal(roster.records.length, 500);
      await assert.rejects(() => promotionRoster(tx, actor, { sourceYearId: targetYear.id, targetYearId: sourceYear.id, sourceStreamId: stream.id, action: "graduate" }), /must start after/);
      await assert.rejects(() => validateAsset(tx, school.id, first.id, "student_photo", `/api/storage/files/${randomUUID()}`), /completed upload/);
      const asset = await tx.storedFile.create({ data: { schoolId: school.id, ownerId: user.id, entityType: "student_photo", entityId: first.id, objectKey: randomUUID(), filename: "synthetic.png", contentType: "image/png", size: 8, status: "ready" } });
      await validateAsset(tx, school.id, first.id, "student_photo", `/api/storage/files/${asset.id}`);
      await assert.rejects(() => validateAsset(tx, otherSchool.id, first.id, "student_photo", `/api/storage/files/${asset.id}`), /completed upload/);
      assert.equal(await tx.studentGuardian.count({ where: { schoolId: school.id } }), 500);
      const log = await tx.auditLog.findFirstOrThrow({ where: { schoolId: school.id, action: "family_linked" } });
      assert.ok(log.before && log.after);
      const second = await tx.student.findUniqueOrThrow({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo: "S-2" } }, include: studentInclude });
      assert.equal(studentView(first).siblingCount, 1);
      await linkGuardian(tx, actor, first.id, { name: "Synthetic Bridge", phone: second.guardians[0].guardian.phone, relationship: "Guardian" });
      await mergeFamily(tx, actor, first.id);
      const merged = await tx.student.findUniqueOrThrow({ where: { id: first.id }, include: studentInclude });
      assert.equal(studentView(merged).siblingCount, 3);
      assert.equal(await tx.family.count({ where: { schoolId: school.id } }), 249);
      assert.equal(await tx.student.count({ where: { schoolId: otherSchool.id } }), 0);
      throw rollback;
    }, { timeout: 180000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});