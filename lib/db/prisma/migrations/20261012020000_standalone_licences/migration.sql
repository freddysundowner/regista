-- Hosted side: signed licences issued for standalone (self-hosted) installs.
CREATE TABLE "standalone_licences" (
  "id" UUID NOT NULL,
  "schoolName" TEXT NOT NULL,
  "maxLearners" INTEGER,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "note" TEXT NOT NULL DEFAULT '',
  "licence" TEXT NOT NULL,
  "createdById" UUID NOT NULL,
  CONSTRAINT "standalone_licences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "standalone_licences_learners_positive" CHECK ("maxLearners" IS NULL OR "maxLearners" > 0)
);
CREATE INDEX "standalone_licences_issuedAt_idx" ON "standalone_licences"("issuedAt");
ALTER TABLE "standalone_licences" ADD CONSTRAINT "standalone_licences_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standalone side: the licence installed on this server.
ALTER TABLE "platform_settings" ADD COLUMN "installedLicence" TEXT;
