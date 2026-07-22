# KS OS Agent Instructions

## Mission
Migrate KS OS into a production-ready monorepo using the visual and workflow design from the Vite redesign while preserving the proven backend logic, database model, security checks, and business rules from the current Next.js application.

## Source folders
The Antigravity Project contains two external reference folders:

- `01-current-next`: current Next.js + Supabase + Drizzle application.
- `02-redesign-vite`: Google AI Studio Vite React redesign.

Treat both as read-only unless the user explicitly says otherwise. Make all changes in this target repository.

## Target architecture
- `apps/legacy-next`: controlled copy of the current app during migration.
- `apps/web`: Vite React TypeScript application.
- `apps/api`: Fastify TypeScript API.
- `packages/database`: shared Drizzle schema, migrations, and DB client.
- `packages/contracts`: Zod schemas and shared API types.
- `packages/auth`: authentication, roles, permissions, tenant boundaries.
- `packages/ui`: reusable design-system components.
- `packages/config`: shared TypeScript, lint, and build configuration.

## Non-negotiable rules
1. Never delete or rewrite the source reference folders.
2. Never commit `.env`, credentials, tokens, customer data, or generated secrets.
3. Do not use browser `localStorage` as the system of record.
4. Keep Supabase Auth initially.
5. Preserve tenant isolation, host validation, rate limits, and booking rules.
6. Migrate one vertical slice at a time: UI, API, database, permissions, tests, verification.
7. Do not claim a feature works until it has been built and verified.
8. Split oversized redesign components before adding new behaviour.
9. Use real routes; do not use a single state variable as the application router.
10. Ask before destructive database migrations or production deployment commands.

## First milestone
Deliver:
- monorepo bootstrapped;
- Vite redesign shell with React Router;
- Supabase login and logout;
- protected staff and agency layouts;
- current tenant loaded from real data;
- read-only dashboard metrics;
- read-only booking calendar;
- legacy app still runnable.
