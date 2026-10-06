ALTER TABLE "WhatsappSetup" DROP CONSTRAINT "WhatsappSetup_connectionId_key";
ALTER TABLE "WhatsappSetup" ADD CONSTRAINT "WhatsappSetup_tenantId_connectionId_key" UNIQUE ("tenantId", "connectionId");
