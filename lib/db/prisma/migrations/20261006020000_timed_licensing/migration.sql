ALTER TABLE schools ADD COLUMN "licenceManaged" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE licence_plans (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  "durationDays" INTEGER NOT NULL CHECK ("durationDays" BETWEEN 1 AND 3650),
  price DECIMAL(12,2) NOT NULL CHECK (price > 0),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE school_licences (
  id UUID PRIMARY KEY,
  "schoolId" UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "planId" UUID NOT NULL REFERENCES licence_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "planName" TEXT NOT NULL,
  "durationDays" INTEGER NOT NULL CHECK ("durationDays" BETWEEN 1 AND 3650),
  price DECIMAL(12,2) NOT NULL CHECK (price > 0),
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestedStartsAt" TIMESTAMP(3),
  source TEXT NOT NULL CHECK (source IN ('admin','payment')),
  "revokedAt" TIMESTAMP(3),
  "revocationType" TEXT CHECK ("revocationType" IN ('admin','payment')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("expiresAt" > "startsAt")
);
CREATE INDEX "school_licences_schoolId_startsAt_expiresAt_idx" ON school_licences("schoolId","startsAt","expiresAt");
CREATE TABLE licence_orders (
  id UUID PRIMARY KEY,
  "schoolId" UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "planId" UUID NOT NULL REFERENCES licence_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "planName" TEXT NOT NULL,
  "durationDays" INTEGER NOT NULL CHECK ("durationDays" BETWEEN 1 AND 3650),
  price DECIMAL(12,2) NOT NULL CHECK (price > 0),
  "invoiceId" UUID NOT NULL UNIQUE REFERENCES platform_billing_invoices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "licenceId" UUID UNIQUE REFERENCES school_licences(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "licence_orders_schoolId_createdAt_idx" ON licence_orders("schoolId","createdAt");
