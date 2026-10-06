ALTER TABLE messaging_accounts DROP CONSTRAINT messaging_accounts_check1;
ALTER TABLE messaging_accounts ADD CONSTRAINT messaging_accounts_check1 CHECK (
 provider IS NULL OR (channel = 'whatsapp' AND provider = 'leadsintel')
 OR (channel = 'sms' AND provider IN ('blessedtexts','onfon','africastalking'))
 OR (channel = 'email' AND provider = 'brevo')
);
CREATE TABLE email_campaigns (
 id UUID PRIMARY KEY, scope TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('welcome','marketing','announcement','transactional')),
 subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL,
 "publicOrigin" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(scope,"idempotencyKey")
);
CREATE TABLE email_recipients (
 id UUID PRIMARY KEY, "campaignId" UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
 email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued'
 CHECK(status IN ('queued','sending','accepted','failed','uncertain','skipped')),
 error TEXT, "providerMessageId" TEXT, "unsubscribeToken" UUID NOT NULL UNIQUE,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("campaignId",email)
);
CREATE INDEX email_recipients_status_updatedAt_idx ON email_recipients(status,"updatedAt");
CREATE TABLE email_suppressions (
 scope TEXT NOT NULL, email TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(scope,email)
);
