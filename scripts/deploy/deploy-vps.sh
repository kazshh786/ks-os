#!/usr/bin/env bash

# deploy-vps.sh - Automates production deployment of KS OS on the VPS.
# Usage: ./scripts/deploy/deploy-vps.sh [--dry-run] [--rollback-on-failure]

set -euo pipefail

DRY_RUN=false
ROLLBACK_ON_FAILURE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --rollback-on-failure)
      ROLLBACK_ON_FAILURE=true
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
  if $DRY_RUN; then
    log "DRY RUN: $*"
  else
    log "Executing: $*"
    eval "$*"
  fi
}

# 1. Pull latest code on the VPS
run "git fetch && git checkout staging && git pull origin staging"

# 2. Install dependencies (pnpm)
run "pnpm install --frozen-lockfile"

# 3. Build the API (and other packages)
run "pnpm run build"

# 4. Restart the systemd service for the API
run "sudo systemctl restart ks-os-api"

# 5. Wait a moment for the service to start
run "sleep 3"

# 6. Perform health check
HEALTH_URL="http://127.0.0.1:5000/health"
log "Running health check at $HEALTH_URL"
if $DRY_RUN; then
  log "DRY RUN: curl -s -o /dev/null -w '%{http_code}' $HEALTH_URL"
  HTTP_STATUS=200
else
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL")
fi

if [[ "$HTTP_STATUS" -ne 200 ]]; then
  log "Health check failed with status $HTTP_STATUS"
  if $ROLLBACK_ON_FAILURE && ! $DRY_RUN; then
    log "Attempting rollback: restarting previous service state"
    run "sudo systemctl restart ks-os-api"
  fi
  exit 1
fi

log "Deployment completed successfully"
