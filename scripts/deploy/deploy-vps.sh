#!/usr/bin/env bash

# deploy-vps.sh - Controlled staging/production deployment for KS OS.
# Usage: ./scripts/deploy/deploy-vps.sh [--dry-run] [--rollback-on-failure]

set -euo pipefail

DRY_RUN=false
ROLLBACK_ON_FAILURE=true
DEPLOY_BRANCH="${DEPLOY_BRANCH:-staging}"
APPLY_MIGRATIONS="${APPLY_MIGRATIONS:-0}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/health}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --rollback-on-failure)
      ROLLBACK_ON_FAILURE=true
      shift
      ;;
    --no-rollback-on-failure)
      ROLLBACK_ON_FAILURE=false
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

log() {
  echo "[deploy] $*"
}

run() {
  log "Executing: $*"
  eval "$*"
}

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PREV_COMMIT="$(git rev-parse HEAD)"

rollback() {
  if ! $ROLLBACK_ON_FAILURE; then
    log "Rollback disabled; manual recovery is required."
    return
  fi

  log "Rolling application code back to ${PREV_COMMIT}"
  git reset --hard "$PREV_COMMIT"
  pnpm install --frozen-lockfile
  pnpm run build
  sudo systemctl restart ks-os-api
}

on_error() {
  local exit_code=$?
  log "Deployment failed with exit code ${exit_code}."
  if ! $DRY_RUN; then
    rollback || true
  fi
  exit "$exit_code"
}

trap on_error ERR

log "Preparing ${DEPLOY_BRANCH} from ${CURRENT_BRANCH} at ${PREV_COMMIT}"
run "git fetch origin ${DEPLOY_BRANCH}"
run "git checkout ${DEPLOY_BRANCH}"
run "git reset --hard origin/${DEPLOY_BRANCH}"
run "pnpm install --frozen-lockfile"
run "pnpm run build"

# Preflight runs after build because it imports the compiled database manifest.
run "pnpm deploy:preflight"
run "pnpm db:migrations:plan"

if $DRY_RUN; then
  log "Dry run completed successfully. No migrations were applied and no service was restarted."
  trap - ERR
  exit 0
fi

if [[ "$APPLY_MIGRATIONS" == "1" ]]; then
  log "Applying pending database migrations"
  run "pnpm db:migrations:apply"
else
  log "Skipping database migrations (set APPLY_MIGRATIONS=1 to apply them)"
fi

run "sudo systemctl restart ks-os-api"
run "sleep 3"

log "Running readiness check at ${HEALTH_URL}"
HTTP_STATUS="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$HEALTH_URL")"
if [[ "$HTTP_STATUS" != "200" ]]; then
  log "Readiness check failed with status ${HTTP_STATUS}"
  false
fi

trap - ERR
log "Deployment completed successfully at commit $(git rev-parse HEAD)"
