CREATE TABLE messaging_accounts (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp')),
  mode TEXT NOT NULL DEFAULT 'override' CHECK (mode IN ('inherit','override')),
  provider TEXT CHECK (provider IN ('blessedtexts','onfon','africastalking','leadsintel')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live','sandbox')),
  "publicConfig" JSONB NOT NULL DEFAULT '{}',
  "encryptedCredentials" TEXT,
  "callbackTokenHash" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE(scope,channel),
  CHECK (scope <> 'platform' OR mode = 'override'),
  CHECK (provider IS NULL OR (channel = 'whatsapp' AND provider = 'leadsintel') OR (channel = 'sms' AND provider <> 'leadsintel'))
);
ALTER TABLE message_deliveries ADD COLUMN "transportAccountId" UUID;
ALTER TABLE message_deliveries ADD COLUMN "transportProvider" TEXT;
CREATE INDEX "message_deliveries_transportAccountId_providerMessageId_idx" ON message_deliveries("transportAccountId","providerMessageId");
