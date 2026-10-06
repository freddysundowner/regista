---
name: API contract naming
description: Prevent generated schema-name collisions across split OpenAPI documents.
---

Use globally distinct named request and enum schemas in split OpenAPI files; avoid inline shapes when their generated names can collide with existing model-property names.

**Why:** Generated body exports collided in barrel files, and two different subscription status enums silently shared one generated type name. Type assertions would hide the missing valid status rather than fix the contract.

**How to apply:** Name new status enums explicitly and reference them. Regenerate and typecheck both clients and API validators after contract changes.
