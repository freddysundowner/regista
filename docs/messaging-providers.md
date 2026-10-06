# Messaging accounts

Owners configure SMS and WhatsApp defaults under **Messaging defaults**. School administrators use **Messaging routing** to choose a school override or explicitly inherit the platform account.

An existing school Africa's Talking or LeadsIntel integration remains a school override until inheritance is selected. Disabling a school override does not transfer that channel's charges to the platform. Existing consent-checked WhatsApp-to-SMS fallback follows the school's separate SMS fallback setting.

Credentials are encrypted and write-only. Saving an unchanged provider without `credentials` retains its credentials. Supplying an object replaces the complete credential set. Provider changes cannot retain credentials from another provider.

## Providers

- **Onfon SMS:** implemented against <https://www.docs.onfonmedia.co.ke/rest/sms/>. Live endpoint, approved sender ID, API key, client ID and access key required. No verified sandbox endpoint.
- **Africa's Talking SMS:** existing live and sandbox transports retained.
- **LeadsIntel WhatsApp:** existing approved templates and verified 24-hour session restrictions retained; school template definitions remain school-specific even when an account is shared.
- **Blessed Text SMS:** settings can be saved disabled. Sending is blocked pending verified response documentation from <https://sms.blessedtexts.com/api-documentation>, which requires sign-in. Third-party examples alone were insufficient to establish acceptance, rejection and recipient identity semantics.

Saving credentials is not a live connectivity test. No paid test messages are sent automatically. No email or native two-way SMS support is implied.

## Optional delivery gateway

New accounts support a separately operated, authenticated normalization gateway, **not native provider webhook URLs**. The gateway must verify the real provider's approved delivery evidence first.

Configure `callbackToken` (32–128 URL-safe characters) and `deliveryGatewaySecret` (32+ characters) together in the account's write-only credentials. These advanced credentials are API-only; omit both when no verified gateway exists.

POST `/api/integrations/messaging-delivery/events/{callbackToken}` with JSON:

```json
{"schoolId":"<school UUID>","providerMessageId":"<provider message ID>","status":"delivered"}
```

Use `X-Delivery-Timestamp` as epoch milliseconds within five minutes and `X-Delivery-Signature` as hex HMAC-SHA256 of `timestamp + "." + raw JSON body`, keyed by the gateway secret. Status is `delivered`, `rejected`, or WhatsApp-only `read`.

The server binds each event to the message's persisted school, provider and sending account. School credentials cannot update another school's messages; a shared account cannot update messages submitted using a school override. Retries are idempotent and positive delivery evidence is never downgraded.

Without a verified gateway, accepted sends remain **submitted**, not **delivered**. Timeouts, malformed responses and missing recipient identities remain **uncertain** and are not automatically retried.
