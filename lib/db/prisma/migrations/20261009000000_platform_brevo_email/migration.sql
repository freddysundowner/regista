-- Extend existing encrypted messaging configuration to platform email.
-- Keep provider/channel pairs explicit so email cannot be routed through SMS.
ALTER TABLE messaging_accounts DROP CONSTRAINT messaging_accounts_channel_check;
ALTER TABLE messaging_accounts DROP CONSTRAINT messaging_accounts_provider_check;
ALTER TABLE messaging_accounts DROP CONSTRAINT messaging_accounts_check1;
ALTER TABLE messaging_accounts ADD CONSTRAINT messaging_accounts_channel_check
  CHECK (channel IN ('sms', 'whatsapp', 'email'));
ALTER TABLE messaging_accounts ADD CONSTRAINT messaging_accounts_provider_check
  CHECK (provider IN ('blessedtexts', 'onfon', 'africastalking', 'leadsintel', 'brevo'));
ALTER TABLE messaging_accounts ADD CONSTRAINT messaging_accounts_check1 CHECK (
  provider IS NULL
  OR (channel = 'whatsapp' AND provider = 'leadsintel')
  OR (channel = 'sms' AND provider IN ('blessedtexts', 'onfon', 'africastalking'))
  OR (channel = 'email' AND provider = 'brevo' AND scope = 'platform')
);
