# School Management System — Rejista

A multi-school administration system for Kenyan schools. The current deliverable covers the foundation phase; fees, payments, reconciliation, bot messaging, assessment results and attendance are later phases.

## Run & Operate

- Start the managed workflows `artifacts/api-server: API Server` and `artifacts/school-management: web`.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate Prisma client
- `NODE_ENV=development pnpm --filter @workspace/db run migrate:dev` — apply checked-in migrations in development only
- `NODE_ENV=development pnpm --filter @workspace/api-server run test` — backend unit and transactional integration checks
- `NODE_ENV=development pnpm --filter @workspace/scripts run test:api` — direct HTTP acceptance checks against the running managed API; creates and removes only synthetic test tenants
- Required secrets: `DATABASE_URL`, `SESSION_SECRET`. Never print their values.
- Optional demo seeding: `pnpm --filter @workspace/scripts run seed:demo`, development only, requires `DEMO_ADMIN_PASSWORD` through Secrets and completed initial setup. Never use real student data for demonstrations.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Prisma; the empty Drizzle template was replaced to follow the supplied specification
- Validation: generated Zod schemas
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle), Vite/React/Tailwind frontend

## Where things live

- `lib/api-spec/openapi.yaml` — shared API contract; regenerate after edits
- `lib/db/prisma/schema.prisma` and `lib/db/prisma/migrations` — models and development migrations
- `artifacts/api-server/src` — authenticated routes, tenant permissions, import validation and family linking
- `artifacts/school-management/src` — application screens and theme
- `.local/conversation-workspace/files/attached_assets/SCHOOL_SYSTEM_TECHNICAL_SPEC.md_1790916356512.pdf` — supplied requirements

## Architecture decisions

- Password/JWT authentication follows the user's explicit specification rather than adding a third-party identity provider.
- The first account is the platform owner, bound to the first school. It can provision other schools with separate school administrators; there is no tenant impersonation.
- Every tenant operation derives its school from the authenticated user, not a submitted school ID.
- Public first-run setup is available only while no school exists. Complete setup before sharing access publicly; do not treat an unclaimed installation as ready for real learner data.
- Prisma generation belongs in the build; schema migration does not. Managed production schema changes use Publish, never startup DDL.

## Product

- First-school setup, platform school provisioning, sign-in/out and staff roles.
- Academic years, terms, grades, streams and class teacher assignment.
- Student and guardian records, normalized Kenyan phone numbers and automatic sibling/family linking.
- Excel/CSV import template, validation preview and transactional commit, with duplicate protection.
- School dashboard and audit history.
- Checks cover 500-row imports, tenant/role isolation, family merging and concurrent current-year writes. The first build has not had end-to-end browser journey testing.

## User preferences

Follow the supplied specification's phase order; do not add out-of-scope modules.

## Gotchas

- Externalized Prisma runtime must remain a direct API-server dependency so the built ESM server can resolve it under pnpm.
- The generated API client uses browser iterable types: retain `dom.iterable` in its TypeScript libraries.
- Teacher access is restricted to assigned streams; an unassigned teacher intentionally sees no learners.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
