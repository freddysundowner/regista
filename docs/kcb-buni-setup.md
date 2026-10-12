# KCB Buni payment notifications

Source: KCB Buni InstantPaymentNotification 1.0.0, API ID
`01b3ebbd-1452-4baf-a068-2913ecd3af73` in the official sandbox developer portal.

## Activation

Sources: KCB Buni InstantPaymentNotification 1.0.0 in the sandbox developer portal. That covers the OpenAPI
definition, the IPN-Account, IPN-Till and IPN-WithValidation documents, and the *Partner Request Letter for Buni API
Integration* (v2026).

1. Platform settings, done once:
   - `ENCRYPTION_KEY`. Do not replace a key already used for saved credentials.
   - `APP_BASE_URL`: the published app's public HTTPS origin. KCB's documents require HTTPS ("secure IPN
     endpoint"). It is needed only for step 4, not for the letter.
   - `KCB_PUBLIC_KEY`: KCB's RSA signing public key in PEM form (`\n` escapes allowed). KCB's documents say the
     signature is verified "using the PUBLIC KEY that will be provided by KCB"; get it from KCB during UAT. It is KCB's
     own signing key, so it is set once for the whole platform. Schools never handle it. A key saved on one account
     (`PUT /api/bank-accounts/{id}/kcb-key`) overrides it, in case KCB ever issues different keys.
   - `PROVIDER_BUSINESS_NAME`, `PROVIDER_CONTACT_NAME`, `PROVIDER_CONTACT_EMAIL`, `PROVIDER_CONTACT_PHONE`: the
     service provider on the letter. They default to Regginna Technology Services, Fredrick Mundia Githumbi,
     githumbi3fred@gmail.com, 0715 363 474.
2. In **Settings → Bank → Add bank**, the school picks KCB and enters the account name, number and branch. A **KCB till
   number** is optional: add it only if parents also pay to a Vooma till, or a Lipa na KCB till through paybill 522533.
   KCB sends it as the till notification's `primaryData.businessKey`.
3. **Letter (PDF)** downloads KCB's partner request letter, filled in on the school's letterhead (logo, name, address
   and contacts from the school profile). It follows KCB's Word template line for line: New Setup, Account and Till as
   they apply, and Instant Payment Notification plus the Account Balance Query, Account Statement and Transaction
   Query APIs are ticked, and the service provider is filled in. The letter has no field for the endpoint, so it never needs the public
   address. The account signatories sign it. It is generated on request and never stored.
4. The card shows the account's notification addresses, with copy buttons, for the school to email to
   `buni@kcbgroup.com` together with the signed letter:
   - `/api/integrations/kcb/account-notification/{token}`
   - `/api/integrations/kcb/till-notification/{token}` (only with a till number)
   The token is made the first time the card is opened. It is stored hashed for routing and encrypted so it can be
   shown again. **Replace addresses** issues a new one, and the old addresses stop working at once. While
   `APP_BASE_URL` is unset the card says so instead of showing addresses.
5. The account shows **Waiting for KCB** until the first correctly signed notification arrives, then turns **Live**.
   Notifications are refused with 503 while no KCB key is configured. KCB checks signature verification during UAT.

A KCB account number, or till number, can belong to only one school on Rejista. Configurations saved on the old
Integrations page keep working through the same notification paths. That page only shows KCB for schools that
already have one.

## Format tolerance

KCB's OpenAPI definition and its PDFs differ on a few fields, so the adapter accepts both versions:
- `primaryData.businessKeyType` can be `notifyBiller` or `queryBiller`.
- `originatorConversationID` can be empty.
- A till `transactionDate` can be `Mon May 19 13:30:54 EAT 2025`, `yyyyMMddHHmmss`, or a bare `yyyyMMdd`. A bare date
  takes its time from the header's `timeStamp` when that is on the same day.

A correctly signed notification with a time that can't be read, such as the 13-digit account sample, is stored with
its receipt time and held for the bursar (`timestamp_unreadable`), not refused. Till acknowledgements return
Rejista's own payment ID as `transactionInfo.transactionId`, as KCB's specification asks.

## Payment handling

Verify base64 `Signature` using SHA256withRSA over the original JSON bytes before parsing financial data. Check the receiving account/business key against the configured school. Only positive KES decimal amounts are accepted. Compact account timestamps are interpreted in EAT; till transaction dates accept KCB's documented EAT example format. Unknown formats fail explicitly.

Acknowledgements mean durable receipt, not successful learner allocation. The existing collections worker posts payments with one unambiguous active-student admission reference. Missing/incorrect references enter the reconciliation queue; names and telephone numbers do not cause automatic KCB allocation. Existing receipt generation and ledger allocation flows are reused.

Transaction identity is `(school, provider=kcb, bank transaction ID)`. Repeated callbacks do not create new credits; altered amounts or references conflict. Use provider `kcb` and the same bank transaction ID when importing KCB statements to avoid parallel identities. Manual records entered under other provider names cannot be automatically deduplicated.

KCB account/business identifiers cannot be registered to multiple schools. Disabled configurations, suspended schools, missing keys and invalid signatures do not accept payment notifications. Durable transaction IDs handle delayed retries without an arbitrary short replay window.

## Scope and acceptance boundaries

- Supported: account notifications and till notifications, signed receipt, matching, reconciliation and existing receipts/ledger.
- Not included: STK initiation, funds transfers, statement pull, or optional over-the-counter/agency pre-payment validation (IPN-WithValidation). The published validation leg does not specify the same Signature header; do not expose student names/balances through an unauthenticated guess.
- KCB must confirm signing byte format, trusted key distribution/rotation, acknowledgement correlation, retry/error handling, actual timestamp formats and primary business key semantics during sandbox testing.
- If the two notification channels supply different bank transaction IDs for the same payment, configure only one notification channel until KCB confirms cross-channel identity.
- Local cryptographic/handler/database tests use ephemeral keys and rolled-back synthetic school records. They are not evidence of a live KCB connection.

Test: `NODE_ENV=development pnpm --filter @workspace/api-server exec tsx --test src/lib/kcb.test.ts`
