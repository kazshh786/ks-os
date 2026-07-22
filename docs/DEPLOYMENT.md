# Production Deployment & Database Migration Guide

## 1. Architecture Overview

- **Repository**: `kazshh786/ks-os` (Monorepo)
- **Deployment Branch**: `staging`
- **Target VPS Path**: `/srv/ks-os`
- **Systemd Service**: `ks-os-api`
- **Execution User**: `ksdeploy`
- **Node.js**: `24.x` | **pnpm**: `11.13.1`
- **Fastify API Entry**: `apps/api/dist/server.js` (Binds to `127.0.0.1:5000`)
- **Reverse Proxy**: Apache / Nginx proxying HTTPS `https://api.kasimshah.com` to `http://127.0.0.1:5000`

---

## 2. Required Environment Variables

The VPS environment file is stored strictly at `/srv/ks-os/.env`. It must NEVER be checked into Git, logged, or overwritten.

Required variables:
- `NODE_ENV=production`
- `PORT=5000`
- `DATABASE_URL=postgresql://...` (Supabase pooled or direct PostgreSQL string)
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`

---

## 3. Command Reference

### Preflight Check
```bash
pnpm deploy:preflight
```

### Migration Status & Planning
```bash
# View applied vs pending migration status
pnpm db:migrations:status

# View execution plan for pending migrations
pnpm db:migrations:plan
```

### Migration Execution (Production)
```bash
# Applies pending migrations in order (requires NODE_ENV=production)
pnpm db:migrations:apply
```

### Dry Run Deployment
```bash
pnpm deploy:vps:dry-run
```

### Full VPS Production Deployment Command
```bash
APPLY_MIGRATIONS=1 bash scripts/deploy/deploy-vps.sh
```

---

## 4. Normal Deployment Procedure

1. Connect to VPS as `ksdeploy`:
   ```bash
   ssh ksdeploy@79.99.41.192
   cd /srv/ks-os
   ```
2. Verify clean git working tree:
   ```bash
   git status
   ```
3. Run a dry run to inspect pending code changes and migration plan:
   ```bash
   pnpm deploy:vps:dry-run
   ```
4. Execute controlled production deployment:
   - **Code update only (no DB schema changes)**:
     ```bash
     bash scripts/deploy/deploy-vps.sh
     ```
   - **Code update WITH database migrations**:
     ```bash
     APPLY_MIGRATIONS=1 bash scripts/deploy/deploy-vps.sh
     ```

---

## 5. Application Rollback Protocol

If the deployment script fails during health check verification (`/health`), it automatically initiates an **application code rollback**:

1. Reverts git working tree to `PREV_COMMIT` via `git reset --hard`.
2. Runs `pnpm install --frozen-lockfile` and `pnpm build`.
3. Restarts `ks-os-api` systemd service.

### Why Database Rollbacks Are Manual
Schema migrations in PostgreSQL are non-trivial to automatically reverse without risk of data loss. If a database migration succeeds but the API fails post-migration:
- The runner **never** attempts automatic database down-migrations.
- Developers must inspect column/table modifications manually and issue compensating migrations if necessary.

---

## 6. Security Rules & Migration Best Practices

1. **Applied Migrations Are Immutable**: Once a migration file has been applied in production or staging, its SQL content and SHA-256 hash must NEVER be modified.
2. **Deterministic Manifest**: New migrations must be added to `packages/database/src/manifest.ts` with explicit sequence order.
3. **Transactional Execution**: Every migration runs inside an isolated `BEGIN ... COMMIT` block. If any query fails, the entire file rolls back.
4. **Advisory Locking**: All migration attempts acquire PostgreSQL session advisory lock `88492026` to prevent simultaneous concurrent runner executions.
