---
name: Platform billing
description: Manual subscription billing scope and a Decimal validation caveat.
---

Use manual subscription invoices and payment records for schools; do not introduce online payment collection without a new request.

**Why:** The user explicitly chose “Invoices and payment records” rather than online collection.

**How to apply:** Keep platform subscription billing distinct from student fees. Changes to a school's access or subscription remain explicit administrative decisions, not side effects of recording a receipt.

For strictly positive Prisma.Decimal amounts, compare with zero using greaterThan(0), not isPositive().

**Why:** Decimal's isPositive() includes positive zero, which allowed zero past validation and incorrectly treated zero receipts as partial payment or prevented voiding an unpaid invoice.

**How to apply:** Use numerical comparisons for financial amount and balance boundaries, and include zero in regression cases.
