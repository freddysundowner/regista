import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import bcrypt from "bcryptjs";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Demo seeding is development-only");
const password = process.env.DEMO_ADMIN_PASSWORD;
if (!password || password.length < 10 || password.length > 128) throw new Error("Set DEMO_ADMIN_PASSWORD to a new strong 10–128 character password before seeding");
if (await db.school.count() === 0) throw new Error("Complete first-run setup before opting into a separate demo school");
const hash = await bcrypt.hash(createHash("sha384").update("school-password-v1\0").update(password).digest("base64"), 12);
try {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('phase1-demo-seed', 0))`;
    const school = await tx.school.upsert({ where: { code: "DEMO-PHASE1" }, create: { name: "Synthetic Demo School", code: "DEMO-PHASE1", type: "primary" }, update: {} });
    const admin = await tx.user.upsert({ where: { email: "phase1-demo-admin@example.invalid" },
      create: { schoolId: school.id, name: "Demo Administrator", role: "school_admin", email: "phase1-demo-admin@example.invalid", passwordHash: hash },
      update: { passwordHash: hash },
    });
    const grade = await tx.grade.upsert({ where: { schoolId_name: { schoolId: school.id, name: "Demo Grade" } }, create: { schoolId: school.id, name: "Demo Grade", levelBand: "lower_primary", order: 1 }, update: {} });
    const stream = await tx.stream.upsert({ where: { gradeId_name: { gradeId: grade.id, name: "Demo Stream" } }, create: { schoolId: school.id, gradeId: grade.id, name: "Demo Stream" }, update: {} });
    for (let i = 0; i < 10; i++) {
      const guardian = await tx.guardian.upsert({ where: { schoolId_phone: { schoolId: school.id, phone: `+254710990${String(i).padStart(3, "0")}` } },
        create: { schoolId: school.id, name: `Demo Guardian ${i + 1}`, phone: `+254710990${String(i).padStart(3, "0")}`, relationship: "Guardian" }, update: {} });
      const existing = await tx.student.findFirst({ where: { schoolId: school.id, admissionNo: `DEMO-${i * 2 + 1}` } });
      const family = existing?.familyId ? await tx.family.findUniqueOrThrow({ where: { id: existing.familyId } }) : await tx.family.create({ data: { schoolId: school.id, name: `Demo Family ${i + 1}` } });
      for (let j = 0; j < 2; j++) {
        const admissionNo = `DEMO-${i * 2 + j + 1}`;
        const student = await tx.student.upsert({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo } },
          create: { schoolId: school.id, admissionNo, firstName: `DemoPupil${i * 2 + j + 1}`, lastName: `Family${i + 1}`, gradeId: grade.id, streamId: stream.id, familyId: family.id, status: "active", boardingStatus: "day" }, update: {} });
        await tx.studentGuardian.upsert({ where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } },
          create: { studentId: student.id, guardianId: guardian.id, relationship: "Guardian", isPrimary: true, receivesNotifications: false }, update: {} });
      }
    }
    await tx.auditLog.create({ data: { schoolId: school.id, userId: admin.id, action: "seeded_demo", entityType: "school", entityId: school.id } });
  }, { timeout: 30000 });
  console.info("Opt-in synthetic demo seed complete. Sign in as phase1-demo-admin@example.invalid using your DEMO_ADMIN_PASSWORD. No credentials were printed.");
} finally { await db.$disconnect(); }