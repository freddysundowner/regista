-- Single-price subscriptions, online payment gateways, prepaid licence keys and trials.
ALTER TABLE "schools" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

ALTER TABLE "licence_orders" ADD COLUMN "maxLearners" INTEGER, ALTER COLUMN "planId" DROP NOT NULL;
ALTER TABLE "school_licences" ADD COLUMN "maxLearners" INTEGER, ALTER COLUMN "planId" DROP NOT NULL;

CREATE TABLE "subscription_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "price" DECIMAL(12,2) NOT NULL,
  "periodDays" INTEGER NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "maxLearners" INTEGER,
  "trialDays" INTEGER NOT NULL DEFAULT 7,
  "highlights" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_settings_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "subscription_settings_price_positive" CHECK ("price" > 0),
  CONSTRAINT "subscription_settings_period_positive" CHECK ("periodDays" > 0),
  CONSTRAINT "subscription_settings_trial_range" CHECK ("trialDays" >= 0 AND "trialDays" <= 90),
  CONSTRAINT "subscription_settings_learners_positive" CHECK ("maxLearners" IS NULL OR "maxLearners" > 0)
);

CREATE TABLE "payment_gateways" (
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "publicConfig" JSONB NOT NULL DEFAULT '{}',
  "encryptedCredentials" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("provider"),
  CONSTRAINT "payment_gateways_provider_known" CHECK ("provider" IN ('mpesa', 'stripe', 'paystack')),
  CONSTRAINT "payment_gateways_environment_known" CHECK ("environment" IN ('sandbox', 'live'))
);

CREATE TABLE "licence_keys" (
  "id" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "encryptedCode" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "maxLearners" INTEGER,
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "redeemedAt" TIMESTAMP(3),
  "redeemedSchoolId" UUID,
  "licenceId" UUID,
  CONSTRAINT "licence_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "licence_keys_duration_positive" CHECK ("durationDays" > 0),
  CONSTRAINT "licence_keys_price_nonnegative" CHECK ("price" >= 0),
  CONSTRAINT "licence_keys_redemption_complete" CHECK (("redeemedAt" IS NULL) = ("redeemedSchoolId" IS NULL) AND ("redeemedAt" IS NULL) = ("licenceId" IS NULL))
);
CREATE UNIQUE INDEX "licence_keys_codeHash_key" ON "licence_keys"("codeHash");
CREATE UNIQUE INDEX "licence_keys_licenceId_key" ON "licence_keys"("licenceId");
CREATE INDEX "licence_keys_createdAt_idx" ON "licence_keys"("createdAt");
ALTER TABLE "licence_keys" ADD CONSTRAINT "licence_keys_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "school_licences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "licence_keys" ADD CONSTRAINT "licence_keys_redeemedSchoolId_fkey" FOREIGN KEY ("redeemedSchoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "licence_keys" ADD CONSTRAINT "licence_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_checkouts" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "providerRef" TEXT,
  "receipt" TEXT,
  "phone" TEXT,
  "redirectUrl" TEXT,
  "failure" TEXT,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_checkouts_provider_known" CHECK ("provider" IN ('mpesa', 'stripe', 'paystack')),
  CONSTRAINT "payment_checkouts_status_known" CHECK ("status" IN ('pending', 'paid', 'failed', 'cancelled')),
  CONSTRAINT "payment_checkouts_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "payment_checkouts_provider_providerRef_key" ON "payment_checkouts"("provider", "providerRef");
CREATE INDEX "payment_checkouts_schoolId_createdAt_idx" ON "payment_checkouts"("schoolId", "createdAt");
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "licence_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
