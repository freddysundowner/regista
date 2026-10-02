---
name: Platform tenancy
description: Central administration scope and safeguards when extending school tenancy.
---

The user requested full multi-tenancy and an administrator who can manage everything. Keep the platform owner independent of any school, with a separate console. Entering a school's operational workspace must be explicit, temporary, reasoned and audited; default to read-only. Never silently impersonate a school's administrator.

**Why:** A school-bound platform owner could lose central access when that school is suspended. User-global selection also risks cross-tab context confusion.

**How to apply:** Keep access grants bound to individual authenticated sessions. Clear client caches and drafts on context transitions. School staff cannot choose a tenant or access platform management.

Historical database checks and composite actor constraints require inspection when changing identity semantics; Prisma schema alone does not describe all deployed constraints.

**Why:** Existing SQL checks rejected independent owner accounts and owner-attributed school actions even after TypeScript and schema generation passed.

**How to apply:** Use additive migrations, preserve tenant-user restrictions and append-only history, and run database-backed tests for both authorized owner actions and rejected cross-school staff actions.