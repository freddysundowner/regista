-- Bank accounts a school collects fees into; NCBA accounts also carry generated push-notification credentials.
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "bank" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branch" TEXT,
    "collectionType" TEXT,
    "collectionNumber" TEXT,
    "notificationStatus" TEXT NOT NULL DEFAULT 'off',
    "encryptedCredentials" TEXT,
    "callbackTokenHash" TEXT,
    "requestedAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "lastNotificationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_accounts_callbackTokenHash_key" ON "bank_accounts"("callbackTokenHash");
CREATE UNIQUE INDEX "bank_accounts_schoolId_bank_accountNumber_key" ON "bank_accounts"("schoolId", "bank", "accountNumber");
CREATE INDEX "bank_accounts_schoolId_idx" ON "bank_accounts"("schoolId");
-- One NCBA till or paybill belongs to one school, so a notification can never be routed to the wrong tenant.
CREATE UNIQUE INDEX "bank_accounts_collection_key" ON "bank_accounts"("bank", "collectionType", "collectionNumber") WHERE "collectionNumber" IS NOT NULL;
