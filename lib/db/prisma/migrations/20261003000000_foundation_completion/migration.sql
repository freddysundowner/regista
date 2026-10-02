-- Additive foundation migration. No startup DDL or destructive record replacement.
BEGIN;
ALTER TABLE schools ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "subscriptionPlan" TEXT NOT NULL DEFAULT 'foundation',
  ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN "subscriptionStartDate" DATE, ADD COLUMN "subscriptionEndDate" DATE;
ALTER TABLE users ALTER COLUMN "schoolId" DROP NOT NULL;
ALTER TABLE users ADD COLUMN "sessionSchoolId" UUID REFERENCES schools(id),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE users SET "sessionSchoolId" = "schoolId", "schoolId" = NULL WHERE role = 'super_admin';
ALTER TABLE users ADD CONSTRAINT users_platform_school_check CHECK
  (("schoolId" IS NOT NULL AND role <> 'super_admin') OR (role = 'super_admin' AND "sessionSchoolId" IS NOT NULL));
ALTER TABLE students ADD COLUMN pathway TEXT, ADD COLUMN "photoUrl" TEXT, ADD COLUMN "transportRouteId" TEXT;
ALTER TABLE guardians ADD COLUMN "idNumber" TEXT, ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE audit_logs ADD COLUMN before JSONB, ADD COLUMN after JSONB, ADD COLUMN ip TEXT, ADD COLUMN "userAgent" TEXT;
ALTER TABLE student_guardians ADD COLUMN "schoolId" UUID;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM student_guardians l JOIN students s ON s.id=l."studentId" JOIN guardians g ON g.id=l."guardianId" WHERE s."schoolId" <> g."schoolId") THEN
    RAISE EXCEPTION 'Cross-school guardian links require manual review before migration; no data changed';
  END IF;
END $$;
UPDATE student_guardians l SET "schoolId"=s."schoolId" FROM students s WHERE s.id=l."studentId";
ALTER TABLE student_guardians ALTER COLUMN "schoolId" SET NOT NULL;
CREATE INDEX student_guardians_school_id_idx ON student_guardians("schoolId");
CREATE UNIQUE INDEX students_id_school_unique ON students(id,"schoolId");
CREATE UNIQUE INDEX guardians_id_school_unique ON guardians(id,"schoolId");
ALTER TABLE student_guardians ADD CONSTRAINT link_student_tenant_fk FOREIGN KEY ("studentId","schoolId") REFERENCES students(id,"schoolId");
ALTER TABLE student_guardians ADD CONSTRAINT link_guardian_tenant_fk FOREIGN KEY ("guardianId","schoolId") REFERENCES guardians(id,"schoolId");
CREATE TABLE teacher_assignments (
 id UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "userId" UUID NOT NULL REFERENCES users(id), "streamId" UUID NOT NULL REFERENCES streams(id),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("userId","streamId")
);
CREATE INDEX teacher_assignments_school_idx ON teacher_assignments("schoolId");
-- Canonicalization is fail-closed: collisions abort the whole migration for manual
-- review. Never silently merge people, drop links, or replace financial references.
CREATE FUNCTION pg_temp.canonical_phone(v TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE WHEN regexp_replace(v, '[[:space:]()+-]', '', 'g') ~ '^(254|0)?[71][0-9]{8}$'
 THEN '254' || regexp_replace(regexp_replace(v, '[[:space:]()+-]', '', 'g'), '^(254|0)', '')
 ELSE v END
$$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM users WHERE phone IS NOT NULL GROUP BY pg_temp.canonical_phone(phone) HAVING count(*)>1) OR
 EXISTS (SELECT 1 FROM guardians GROUP BY "schoolId",pg_temp.canonical_phone(phone) HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Canonical phone collision: review duplicate users/guardians before retrying. No records merged or deleted.';
 END IF;
END $$;
UPDATE users SET phone=pg_temp.canonical_phone(phone) WHERE phone IS NOT NULL;
UPDATE guardians SET phone=pg_temp.canonical_phone(phone), "altPhone"=pg_temp.canonical_phone("altPhone");
UPDATE schools SET phone=pg_temp.canonical_phone(phone) WHERE phone IS NOT NULL;
CREATE TABLE stored_files (
 id UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id), "ownerId" UUID NOT NULL,
 "entityType" TEXT NOT NULL, "entityId" UUID NOT NULL, "objectKey" TEXT NOT NULL UNIQUE,
 filename TEXT NOT NULL, "contentType" TEXT NOT NULL, size INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX stored_files_school_idx ON stored_files("schoolId");
COMMIT;