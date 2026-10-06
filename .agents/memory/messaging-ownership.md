---
name: Messaging ownership
description: User-selected hybrid messaging ownership and safe provider onboarding boundaries.
---
Use a platform default with optional school-owned messaging accounts. The user named Blessed Text, Onfon and similar platforms for communications and explicitly selected hybrid ownership.

**Why:** The user chose shared platform accounts with school overrides, rather than requiring every school to buy its own account.

**How to apply:** Preserve previously configured school accounts until an administrator explicitly chooses inheritance. Disabled or broken overrides must not silently charge a different account for the same channel. Existing consent-checked WhatsApp-to-SMS fallback remains a separate channel policy.

Only implement provider contracts supported by documentation. Blessed Text's official API documentation requires sign-in; public third-party examples established request fields but did not establish a reliable response contract. Require sanitized documentation before enabling that adapter; never interpret an arbitrary HTTP success as delivery.

**Why:** An uncertain acceptance result may already have cost money; automatically retrying it can cause duplicate paid messages.

**How to apply:** Keep accepted submissions distinct from delivery confirmations. Live provider acceptance testing is still required even when configuration saves successfully. Never expand SMS providers into WhatsApp/email without verified support.

The user requested Brevo for system email and a tabbed platform Settings page covering system settings.

**Why:** The user explicitly selected Brevo; do not substitute another email provider.

**How to apply:** Keep platform email and school-owned email credentials separate and write-only. School email must not silently fall back to platform funds.

The user explicitly requested welcome emails on registration, rich-text marketing and other admin emails, and school-owned email, SMS and LeadsIntel WhatsApp settings.

**Why:** These are authorized product requirements, not optional follow-up suggestions.

**How to apply:** Welcome emails use the platform account and must not fail registration on provider errors. Schools can configure their own sending accounts. Marketing requires recipient permission and a working unsubscribe path; ambiguous provider results must not be retried automatically.
