import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { db } from "@workspace/db";
import bcrypt from "bcryptjs";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Demo seeding is development-only");
const password = process.env.DEMO_ADMIN_PASSWORD;
if (!password || password.length < 10 || password.length > 128) throw new Error("Set DEMO_ADMIN_PASSWORD to a new strong 10–128 character password before seeding");
if (await db.school.count() === 0) throw new Error("Complete first-run setup before opting into a separate demo school");
const hash = await bcrypt.hash(createHash("sha384").update("school-password-v1\0").update(password).digest("base64"), 12);
try {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('foundation-demo-v2', 0))`;
    // A new, clearly synthetic seed namespace preserves any previously seeded or edited records.
    const school = await tx.school.upsert({ where: { code: "DEMO-FOUNDATION-V2" }, create: { name: "Synthetic Foundation Demo School", code: "DEMO-FOUNDATION-V2", type: "primary" }, update: {} });
    const admin = await tx.user.upsert({ where: { email: "foundation-demo-admin@example.invalid" },
      create: { schoolId: school.id, name: "Demo Administrator", role: "school_admin", email: "foundation-demo-admin@example.invalid", passwordHash: hash },
      update: { passwordHash: hash, sessionVersion: { increment: 1 } },
    });
    if (admin.schoolId !== school.id) throw new Error("Demo administrator belongs to another school; seed aborted without changes");
    const year = await tx.academicYear.upsert({ where: { schoolId_name: { schoolId: school.id, name: "2027" } },
      create: { schoolId: school.id, name: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), isCurrent: true }, update: {} });
    await tx.term.upsert({ where: { academicYearId_name: { academicYearId: year.id, name: "Term 1" } },
      create: { schoolId: school.id, academicYearId: year.id, name: "Term 1", startDate: new Date("2027-01-04"), endDate: new Date("2027-04-09"), isCurrent: true }, update: {} });
    const placements: { gradeId: string; streamId: string }[] = [];
    for (let g = 1; g <= 3; g++) {
      const grade = await tx.grade.upsert({ where: { schoolId_name: { schoolId: school.id, name: `Grade ${g}` } },
        create: { schoolId: school.id, name: `Grade ${g}`, levelBand: "lower_primary", order: g }, update: {} });
      for (const name of ["East", "West"]) {
        const stream = await tx.stream.upsert({ where: { gradeId_name: { gradeId: grade.id, name } }, create: { schoolId: school.id, gradeId: grade.id, name }, update: {} });
        placements.push({ gradeId: grade.id, streamId: stream.id });
      }
    }
    let number = 0;
    for (let i = 0; i < 45; i++) {
      const phone = `254710990${String(i).padStart(3, "0")}`;
      const guardian = await tx.guardian.upsert({ where: { schoolId_phone: { schoolId: school.id, phone } },
        create: { schoolId: school.id, name: `Demo Guardian ${i + 1}`, phone, relationship: "Guardian" }, update: {} });
      const children = i < 5 ? 3 : i < 10 ? 2 : 1;
      let familyId: string | null = null;
      if (children > 1) {
        const existing = await tx.family.findFirst({ where: { schoolId: school.id, name: `Demo Family ${i + 1}` } });
        familyId = (existing ?? await tx.family.create({ data: { schoolId: school.id, name: `Demo Family ${i + 1}` } })).id;
      }
      for (let j = 0; j < children; j++) {
        number++;
        const admissionNo = `DEMO-${String(number).padStart(3, "0")}`;
        const student = await tx.student.upsert({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo } },
          create: { schoolId: school.id, admissionNo, firstName: `DemoPupil${number}`, lastName: `Family${i + 1}`, ...placements[(number - 1) % 6], familyId, status: "active", boardingStatus: "day" }, update: {} });
        await tx.studentGuardian.upsert({ where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } },
          create: { schoolId: school.id, studentId: student.id, guardianId: guardian.id, relationship: "Guardian", isPrimary: true, receivesNotifications: false }, update: {} });
      }
    }
    await tx.auditLog.create({ data: { schoolId: school.id, userId: admin.id, action: "seeded_demo", entityType: "school", entityId: school.id,
      after: { grades: 3, streams: 6, students: number, guardians: 45, families: 10 } } });
  }, { timeout: 60000 });
  console.info("Synthetic foundation demo seed complete: 3 grades, 6 streams, 60 students, 45 guardians. Sign in as foundation-demo-admin@example.invalid using DEMO_ADMIN_PASSWORD. Existing records are preserved.");
  const finance = spawnSync("pnpm", ["--filter", "@workspace/api-server", "exec", "tsx", "seed-finance-demo.ts"], { stdio: "inherit", env: process.env });
  if (finance.status !== 0) throw new Error("Demo foundation seed completed but finance seed failed; retry the seed command");
} finally { await db.$disconnect(); }