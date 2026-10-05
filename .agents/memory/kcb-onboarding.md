---
name: KCB onboarding boundaries
description: Security and activation boundaries for the user-selected KCB Buni integration.
---

The user selected KCB Buni InstantPaymentNotification, not a generic bank feed. Treat its RSA-signed account/till callbacks separately from other providers' HMAC gateways.

**Why:** The public KCB API contract supplies native notification signing, but its optional pre-payment validation leg does not document the same signature requirement. Exposing learner validation without authenticated onboarding could disclose student details.

**How to apply:** Do not add unauthenticated pre-payment validation or silently reuse a generic webhook contract. Confirm public-key provenance, receiving business keys, timestamps, retry acknowledgements and cross-channel transaction IDs with KCB before claiming live acceptance. A saved sandbox/production label is not a verified bank connection.
