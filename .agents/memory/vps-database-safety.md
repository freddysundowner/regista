---
name: Shared VPS database safety
description: PostgreSQL on the user's VPS may serve other software; never assume a dedicated fresh server.
---

The user says other software on their VPS uses PostgreSQL. Treat it as a shared server, not a fresh machine.

**Why:** The user objected to automatic installation potentially disrupting those applications.

**How to apply:** Require explicit permission for new server installation. Existing PostgreSQL versions, services, accounts and passwords must not be taken over or changed by Rejista setup. Use an explicitly selected, dedicated application database; do not silently rewrite shared repositories to work around installation errors.
