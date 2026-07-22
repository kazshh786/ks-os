# Bootstrap KS OS Monorepo

1. Read `AGENTS.md` and all files in `docs/`.
2. Inventory both source folders without editing them.
3. Produce a proposed file move/copy plan before making changes.
4. Bootstrap a pnpm workspace in the target.
5. Copy the current application into `apps/legacy-next`, excluding generated and secret files.
6. Copy the redesign into `apps/web`, excluding `node_modules`, `dist`, and secret files.
7. Create a minimal Fastify TypeScript app in `apps/api` with `/health`.
8. Confirm each app installs, type-checks, and builds independently.
9. Report all failures and do not conceal warnings.
