---
name: Shared VPS database safety
description: PostgreSQL on the user's VPS may serve other software; never assume a dedicated fresh server.
---

The user says other software on their VPS uses PostgreSQL. Treat it as a shared server, not a fresh machine.

**Why:** The user objected to automatic installation potentially disrupting those applications.

**How to apply:** Require explicit permission for new server installation. Existing PostgreSQL versions, services, accounts and passwords must not be taken over or changed by Rejista setup. Use an explicitly selected, dedicated application database; do not silently rewrite shared repositories to work around installation errors.

Occupied API ports must advance to the next available port for other apps. Stop and reuse a port only when the listener is verifiably Rejista's own service.

**Why:** The user explicitly requested this port behaviour and protection of other software on the shared VPS.

The user requires one installer command: check PostgreSQL, reuse an existing Rejista database connection, or create a dedicated database when absent, then continue.

**Why:** The user rejected having to run separate database setup and application installation commands.

**How to apply:** Keep provisioning inside the installer's workflow while preserving collision/password safeguards; never reset an unknown existing account to make automatic setup proceed.

Database connection changes require verification with a real, isolated PostgreSQL cluster, not only mocked command-line clients.

**Why:** Mock clients accepted a full connection URI in `PGDATABASE`, while actual libpq clients treated it as a database name and failed immediately after successful provisioning.

**How to apply:** Keep credentials out of process arguments; verify actual connection, dump and restore behaviour using a temporary private cluster rather than the shared application database.

Missing or outdated Node/pnpm should be handled with a private Rejista toolchain, not by upgrading shared runtime installations.

**Why:** The user's VPS has other apps, and its older Node blocked installation. Private runtimes preserve those apps while keeping the requested one-command setup.

**How to apply:** Pass the selected runtime explicitly through privileged user switches and service configuration; retain checksum verification and avoid shared package-manager configuration changes.
