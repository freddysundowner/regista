CREATE TABLE schools (
 id uuid PRIMARY KEY, name text NOT NULL, code text NOT NULL UNIQUE, county text, type text NOT NULL,
 address text, phone text, email text, status text NOT NULL DEFAULT 'active',
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE users (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), name text NOT NULL,
 email text UNIQUE, phone text UNIQUE, "passwordHash" text NOT NULL, role text NOT NULL,
 "isActive" boolean NOT NULL DEFAULT true, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 CHECK (email IS NOT NULL OR phone IS NOT NULL),
 CHECK (role IN ('super_admin','school_admin','principal','bursar','teacher','class_teacher'))
);
CREATE TABLE academic_years (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), name text NOT NULL,
 "startDate" date NOT NULL, "endDate" date NOT NULL, "isCurrent" boolean NOT NULL DEFAULT false,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 UNIQUE ("schoolId",name), CHECK ("startDate" <= "endDate")
);
CREATE UNIQUE INDEX academic_years_one_current ON academic_years("schoolId") WHERE "isCurrent";
CREATE TABLE terms (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), "academicYearId" uuid NOT NULL REFERENCES academic_years(id),
 name text NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "isCurrent" boolean NOT NULL DEFAULT false,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 UNIQUE ("academicYearId",name), CHECK ("startDate" <= "endDate")
);
CREATE UNIQUE INDEX terms_one_current ON terms("schoolId") WHERE "isCurrent";
CREATE TABLE grades (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), name text NOT NULL,
 "levelBand" text NOT NULL, "order" integer NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL, UNIQUE ("schoolId",name)
);
CREATE TABLE streams (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), "gradeId" uuid NOT NULL REFERENCES grades(id),
 name text NOT NULL, "classTeacherUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL, UNIQUE ("gradeId",name)
);
CREATE TABLE families (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), name text NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE students (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), "admissionNo" text NOT NULL,
 "firstName" text NOT NULL, "middleName" text, "lastName" text NOT NULL, gender text, "dateOfBirth" date,
 "gradeId" uuid REFERENCES grades(id) ON DELETE SET NULL, "streamId" uuid REFERENCES streams(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'active', "boardingStatus" text NOT NULL DEFAULT 'day', "admissionDate" date, upi text,
 "familyId" uuid REFERENCES families(id) ON DELETE SET NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 UNIQUE ("schoolId","admissionNo"), CHECK (status IN ('active','transferred','graduated','left')),
 CHECK ("boardingStatus" IN ('day','boarder')), CHECK (gender IS NULL OR gender IN ('male','female','other'))
);
CREATE TABLE guardians (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), name text NOT NULL, phone text NOT NULL,
 "altPhone" text, email text, relationship text,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL, UNIQUE ("schoolId",phone)
);
CREATE TABLE student_guardians (
 id uuid PRIMARY KEY, "studentId" uuid NOT NULL REFERENCES students(id), "guardianId" uuid NOT NULL REFERENCES guardians(id),
 relationship text NOT NULL, "isPrimary" boolean NOT NULL DEFAULT false, "receivesNotifications" boolean NOT NULL DEFAULT true,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL, UNIQUE ("studentId","guardianId")
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY, "schoolId" uuid NOT NULL REFERENCES schools(id), "userId" uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL, "entityType" text NOT NULL, "entityId" text,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
);
CREATE INDEX users_school_idx ON users("schoolId");
CREATE INDEX students_school_stream_idx ON students("schoolId","streamId");
CREATE INDEX audit_school_date_idx ON audit_logs("schoolId","createdAt");
CREATE INDEX families_school_idx ON families("schoolId");
CREATE INDEX streams_school_idx ON streams("schoolId");
CREATE INDEX terms_school_idx ON terms("schoolId");