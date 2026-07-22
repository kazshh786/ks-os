# Architecture Decisions

Record material decisions here with:
- date;
- decision;
- rationale;
- alternatives considered;
- consequences.

## Initial decisions
- Use a monorepo.
- Use Vite React for the new web client.
- Use Fastify for the dedicated Node API.
- Retain Supabase Postgres and Supabase Auth initially.
- Use Drizzle for database access.
- Use Zod contracts shared between frontend and backend.
- Keep the legacy application runnable until feature parity is verified.
