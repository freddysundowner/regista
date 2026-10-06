---
name: API contract naming
description: Prevent generated schema-name collisions across split OpenAPI documents.
---

Use globally distinct named request and enum schemas in split OpenAPI files; avoid inline shapes when their generated names can collide with existing model-property names.

**Why:** Generated body exports collided in barrel files, and two different subscription status enums silently shared one generated type name. Type assertions would hide the missing valid status rather than fix the contract.

**How to apply:** Name new status enums explicitly and reference them. Regenerate and typecheck both clients and API validators after contract changes.

Vite can retain a prebundled workspace client that lacks newly generated hook exports even when source exports and TypeScript are correct.

**Why:** The browser reported a missing hook after codegen; clearing only the frontend's generated Vite dependency cache and restarting fixed the browser import.

**How to apply:** For this exact mismatch, verify the source export first, then clear the generated Vite cache and reload. Do not rename correct generated hooks to work around a stale bundle.
