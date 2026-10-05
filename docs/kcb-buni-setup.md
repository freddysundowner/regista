# KCB Buni payment notifications

Source: KCB Buni InstantPaymentNotification 1.0.0, API ID
`01b3ebbd-1452-4baf-a068-2913ecd3af73` in the official sandbox developer portal.

## Activation

1. Set `ENCRYPTION_KEY` through project Secrets (a new random 32-byte key encoded as base64 or 64 hexadecimal characters). Do not replace a key already used for saved integrations.
2. Obtain the RSA signing **public** key directly from KCB through its approved onboarding channel. Never supply a private key. Confirm separate sandbox/production signing keys and receiving account identifiers.
3. In the school's **Integrations → KCB Buni → Configure** dialog, select the environment and enter the collection account, public key and a generated callback token. For till notifications, enter the receiving `primaryData.businessKey` confirmed by KCB; this is not the learner's reference.
4. Copy the applicable callback path shown in the dialog before saving. Register it with KCB using the published app's HTTPS domain:
   - `/api/integrations/kcb/account-notification/{callbackToken}`
   - `/api/integrations/kcb/till-notification/{callbackToken}`
   The public specification directs endpoint onboarding to `buni@kcbgroup.com`. Registration is manual, not an invented outbound registration API.
5. Run KCB sandbox acceptance, then repeat onboarding for production. Saving a configuration does not verify connectivity or activate an account at KCB.

The environment label does not redirect an outbound API: KCB calls this application. Only enable the environment whose key and accounts were registered. A school currently has one bank configuration; production replaces sandbox settings.

## Payment handling

Verify base64 `Signature` using SHA256withRSA over the original JSON bytes before parsing financial data. Check the receiving account/business key against the configured school. Only positive KES decimal amounts are accepted. Compact account timestamps are interpreted in EAT; till transaction dates accept KCB's documented EAT example format. Unknown formats fail explicitly.

Acknowledgements mean durable receipt, not successful learner allocation. The existing collections worker posts payments with one unambiguous active-student admission reference. Missing/incorrect references enter the reconciliation queue; names and telephone numbers do not cause automatic KCB allocation. Existing receipt generation and ledger allocation flows are reused.

Transaction identity is `(school, provider=kcb, bank transaction ID)`. Repeated callbacks do not create new credits; altered amounts or references conflict. Use provider `kcb` and the same bank transaction ID when importing KCB statements to avoid parallel identities. Manual records entered under other provider names cannot be automatically deduplicated.

KCB account/business identifiers cannot be registered to multiple schools. Disabled configurations, suspended schools, missing keys and invalid signatures do not accept payment notifications. Durable transaction IDs handle delayed retries without an arbitrary short replay window.

## Scope and acceptance boundaries

- Supported: account notifications and till notifications, signed receipt, matching, reconciliation and existing receipts/ledger.
- Not included: STK initiation, funds transfers, statement pull, or optional over-the-counter pre-payment validation. The published validation leg does not specify the same Signature header; do not expose student names/balances through an unauthenticated guess.
- KCB must confirm signing byte format, trusted key distribution/rotation, acknowledgement correlation, retry/error handling, actual timestamp formats and primary business key semantics during sandbox testing.
- If the two notification channels supply different bank transaction IDs for the same payment, configure only one notification channel until KCB confirms cross-channel identity.
- Local cryptographic/handler/database tests use ephemeral keys and rolled-back synthetic school records. They are not evidence of a live KCB connection.

Test: `NODE_ENV=development pnpm --filter @workspace/api-server exec tsx --test src/lib/kcb.test.ts`
