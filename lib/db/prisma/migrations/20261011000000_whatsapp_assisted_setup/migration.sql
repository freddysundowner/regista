CREATE TABLE "LeadsIntelPlatform" (id TEXT PRIMARY KEY DEFAULT 'platform', "encryptedCredentials" TEXT NOT NULL);
CREATE TABLE "WhatsappSetup" (
 scope TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "connectionId" TEXT NOT NULL UNIQUE,
 "phoneNumber" TEXT NOT NULL UNIQUE, "businessName" TEXT NOT NULL, "displayName" TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'submitting', "requestId" TEXT, "phoneNumberId" TEXT UNIQUE,
 error TEXT NOT NULL DEFAULT '', "encryptedCredentials" TEXT NOT NULL,
 "webhookToken" TEXT NOT NULL UNIQUE, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WhatsappInbound" ("eventId" TEXT PRIMARY KEY, scope TEXT NOT NULL, payload JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
