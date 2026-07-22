# Target Architecture

Browser -> Vite React web app -> Fastify API -> Supabase Postgres

Supabase Auth remains the identity provider during the first migration stages.

## Apps
- `legacy-next`: current application kept operational during migration.
- `web`: redesigned React client with real routes and typed API calls.
- `api`: modular Fastify backend.

## Shared packages
- `database`: Drizzle schema, migrations, and database client.
- `contracts`: Zod validation and shared TypeScript types.
- `auth`: tenant context, role permissions, and support-session rules.
- `ui`: design tokens and reusable components.
- `config`: shared tooling configuration.
