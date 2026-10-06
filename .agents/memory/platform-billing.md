---
name: Platform billing
description: Timed school licences, renewal/payment boundaries and a Decimal validation caveat.
---

Schools need time-based licences, with a price for each licence option, platform-admin issuance, and school self-service subscription/renewal. The requested payment options are M-Pesa, cards via Stripe, and Paystack.

Only the platform administrator sets licence and subscription prices. Schools may select offered plans and request renewals, but may not set or change those prices.

**Why:** The user explicitly requires platform-admin ownership of both licence pricing and subscription pricing.

**How to apply:** Enforce this authority on the server as well as in the interface. School requests must use server-stored prices, never client-supplied amounts.

Licence issuance prices and subscription renewal prices must be independently configurable; merely explaining the original shared-price model did not satisfy the user.

**Why:** The user said the pricing prompt had not been acted upon after receiving an explanation of existing restrictions.

**How to apply:** Provide real owner-facing controls for both prices. Preserve existing invoice snapshots, and do not mistake price separation for authorization to add an extra charge to a renewal.

**Why:** The user expanded the earlier manual-billing scope to timed licences and integrated online renewal.

**How to apply:** Keep platform subscription billing distinct from student fees. Verified licence purchases can activate or extend licence coverage; generic manual invoice/payment entries must not silently change school access or registration approval.

Existing schools retain access until first granted a timed licence. Once managed, expired schools retain sign-in, account and renewal access but not school operations. Registration approval and school suspension are independent boundaries.

**Why:** Adding licences must not unexpectedly lock out existing schools; expired administrators must be able to renew.

**How to apply:** Extend early renewals after existing purchased time; start expired renewals at settlement. Snapshot each purchase's price and duration, never recalculate it from later plan edits. Direct owner grants do not imply payment. Reversing a linked invoice payment removes that licence's coverage; re-settlement restores its original dates, not extra days.

Online payment setup was deferred when the user dismissed the Stripe connection and asked to continue without integration. Manual invoice-backed renewals are the current working payment path.

**Why:** No provider may be represented as connected or collect funds without verified provider setup.

**How to apply:** Keep M-Pesa, Stripe and Paystack unavailable until separately configured. When adding them, reuse immutable licence orders and atomic idempotent verified settlement; do not use student-fee provider settings for platform charges.

For strictly positive Prisma.Decimal amounts, compare with zero using greaterThan(0), not isPositive().

**Why:** Decimal's isPositive() includes positive zero, which allowed zero past validation and incorrectly treated zero receipts as partial payment or prevented voiding an unpaid invoice.

**How to apply:** Use numerical comparisons for financial amount and balance boundaries, and include zero in regression cases.
