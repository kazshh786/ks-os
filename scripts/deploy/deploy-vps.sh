#!/usr/bin/env bash

# ==============================================================================
# Production Deployment Script for KS OS Monorepo on VPS
# VPS Target: /srv/ks-os
# Service: ks-os-api (systemd)
# ==============================================================================

set -Eeuo pipefail

DRY_RUN=0
APPLY_MIGRATIONS=${APPLY_MIGRATIONS:-0}
EXPECTED_USER="ksdeploy"
TARGET_DIR="/srv/ks-os"
SERVICE_NAME="ks-os-api"
API_PORT=5000
PUBLIC_HEALTH_URL="https://api.kasimshah.com/health"
LOCAL_HEALTH_URL="http://127.0.0.1:5000/health"

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
  esac
done

echo "========================================================"
echo "    KS OS VPS DEPLOYMENT AUTOMATION                     "
echo "    Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")        "
echo "    Dry Run:   ${DRY_RUN}                              "
echo "========================================================"

# 1. Require execution as ksdeploy (unless in dry-run override)
CURRENT_USER=$(whoami || echo "unknown")
if [ "$CURRENT_USER" != "$EXPECTED_USER" ] && [ "$DRY_RUN" -eq 0 ]; then
  echo "CRITICAL ERROR: Deployment script must be run as '${EXPECTED_USER}', not '${CURRENT_USER}'." >&2
  exit 1
fi

# 2. cd to /srv/ks-os if directory exists
if [ -d "$TARGET_DIR" ]; then
  cd "$TARGET_DIR"
else
  echo "INFO: Target directory $TARGET_DIR does not exist. Using current directory for dry run."
fi

# 3. Confirm working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "CRITICAL ERROR: Working tree is not clean. Uncommitted changes detected." >&2
  git status --short
  exit 1
fi

PREV_COMMIT=$(git rev-parse HEAD)
echo "Recorded current commit for potential rollback: ${PREV_COMMIT}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "\n--- DRY-RUN MODE ACTIVATED ---"
  echo "[Dry Run] Would fetch and pull origin/staging --ff-only"
  echo "[Dry Run] Would run pnpm install --frozen-lockfile"
  echo "[Dry Run] Would run pnpm build && pnpm test"
  echo "[Dry Run] Would execute migration preflight script"
  echo "[Dry Run] Migration plan check:"
  node scripts/database/migrate.mjs --plan || true
  echo "[Dry Run] Would restart systemd service: sudo systemctl restart ${SERVICE_NAME}"
  echo "[Dry Run] Would test health endpoints at ${LOCAL_HEALTH_URL} and ${PUBLIC_HEALTH_URL}"
  echo "✓ DRY RUN COMPLETED SUCCESSFULLY."
  exit 0
fi

# 4. Fetch & pull staging --ff-only
echo "Fetching origin staging branch..."
git fetch origin staging

echo "Pulling staging with --ff-only..."
if ! git pull --ff-only origin staging; then
  echo "CRITICAL ERROR: Git pull --ff-only failed. Deployment aborted." >&2
  exit 1
fi

NEW_COMMIT=$(git rev-parse HEAD)
echo "Successfully pulled commit: ${NEW_COMMIT}"

# Rollback helper function
rollback_app() {
  echo "--------------------------------------------------------"
  echo "CRITICAL DEPLOYMENT FAILURE DETECTED!"
  echo "Initiating application code rollback to commit ${PREV_COMMIT}..."
  echo "--------------------------------------------------------"

  git reset --hard "$PREV_COMMIT"
  pnpm install --frozen-lockfile || true
  pnpm build || true
  sudo systemctl restart "$SERVICE_NAME" || true

  echo "Application rolled back to ${PREV_COMMIT} and restarted."
  echo "Note: Database schema changes (if applied) require manual review."
  exit 1
}

# Trap unexpected errors to trigger rollback
trap 'rollback_app' ERR

# 5. Install dependencies & build
echo "Running pnpm install --frozen-lockfile..."
pnpm install --frozen-lockfile

echo "Building applications and packages..."
pnpm build

echo "Running automated verification tests..."
pnpm test

# 6. Run migration preflight & plan
echo "Running migration preflight tool..."
node scripts/deploy/preflight.mjs

echo "Current database migration plan:"
node scripts/database/migrate.mjs --plan

# 7. Apply migrations if explicitly requested
if [ "$APPLY_MIGRATIONS" -eq 1 ]; then
  echo "APPLY_MIGRATIONS=1 detected. Applying database migrations..."
  node scripts/database/migrate.mjs --apply
else
  echo "APPLY_MIGRATIONS=0. Skipping database migration application step."
fi

# 8. Restart API systemd service
echo "Restarting ${SERVICE_NAME} service..."
sudo systemctl restart "$SERVICE_NAME"

echo "Waiting for service startup..."
sleep 3

# 9. Verify health endpoints
echo "Testing local API health endpoint (${LOCAL_HEALTH_URL})..."
HEALTH_LOCAL=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_HEALTH_URL" || echo "000")

if [ "$HEALTH_LOCAL" != "200" ]; then
  echo "CRITICAL ERROR: Local health check failed with HTTP status ${HEALTH_LOCAL}!" >&2
  echo "Systemd service logs:"
  sudo journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true
  rollback_app
fi

echo "✓ Local health check passed (HTTP 200)."

echo "Testing public API health endpoint (${PUBLIC_HEALTH_URL})..."
HEALTH_PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_HEALTH_URL" || echo "000")

if [ "$HEALTH_PUBLIC" != "200" ]; then
  echo "WARNING: Public health check returned HTTP status ${HEALTH_PUBLIC}. (Local service is running cleanly)."
else
  echo "✓ Public health check passed (HTTP 200)."
fi

echo "========================================================"
echo "    DEPLOYMENT COMPLETED SUCCESSFULLY                   "
echo "    Deployed Commit: ${NEW_COMMIT}                      "
echo "========================================================"
