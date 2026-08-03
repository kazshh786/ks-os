#!/usr/bin/env bash

# Controlled KS OS VPS deployment. The API, site worker, and shared renderer
# are one release unit; migrations remain an explicit operator decision.

set -euo pipefail

cd /srv/ks-os

KS_OS_RUNTIME_BIN="${KS_OS_RUNTIME_BIN:-/home/ksdeploy/.nvm/versions/node/v24.18.0/bin}"
[[ -x "$KS_OS_RUNTIME_BIN/node" ]] || {
  echo "Required KS OS Node runtime is missing at $KS_OS_RUNTIME_BIN/node." >&2
  exit 1
}
export PATH="$KS_OS_RUNTIME_BIN:$PATH"
export CI="${CI:-true}"

DRY_RUN=false
ROLLBACK_ON_FAILURE=true
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
APPLY_MIGRATIONS="${APPLY_MIGRATIONS:-0}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:5000/health}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-http://127.0.0.1:8091/health}"
WORKER_READY_URL="${WORKER_READY_URL:-http://127.0.0.1:8091/ready}"
RENDERER_HEALTH_URL="${RENDERER_HEALTH_URL:-http://127.0.0.1:5001/health}"
RENDERER_HEALTH_HOST="${RENDERER_HEALTH_HOST:-sites.kasimshah.com}"
SERVICES=(ks-os-api ks-os-site-worker ks-os-sites)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --rollback-on-failure) ROLLBACK_ON_FAILURE=true ;;
    --no-rollback-on-failure) ROLLBACK_ON_FAILURE=false ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

log() { echo "[deploy] $*"; }
run() { log "Executing: $*"; "$@"; }

require_clean_branch() {
  [[ -z "$(git status --porcelain)" ]] || {
    log "Refusing deployment because /srv/ks-os has uncommitted changes."
    return 1
  }
  local branch
  branch="$(git branch --show-current)"
  [[ "$branch" == "$DEPLOY_BRANCH" ]] || {
    log "Refusing deployment from branch '${branch:-DETACHED}'; expected '$DEPLOY_BRANCH'."
    return 1
  }
}

check_http() {
  local label="$1" url="$2" host="${3:-}"
  local status
  if [[ -n "$host" ]]; then
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --retry 59 --retry-connrefused --retry-all-errors --retry-delay 1 \
      --retry-max-time 60 --header "Host: $host" "$url" || true)"
  else
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --retry 59 --retry-connrefused --retry-all-errors --retry-delay 1 \
      --retry-max-time 60 "$url" || true)"
  fi
  [[ "$status" == "200" ]] || {
    log "$label health check failed with HTTP $status."
    return 1
  }
}

require_service_owned_ports() {
  if [[ -f .env ]] && grep --quiet --extended-regexp \
    '^[[:space:]]*PORT[[:space:]]*=' .env; then
    log "Refusing deployment because the shared production .env sets PORT. The API and renderer own separate ports through their service configuration."
    return 1
  fi
}

restart_release_services() {
  run sudo systemctl restart "${SERVICES[@]}"
  for service in "${SERVICES[@]}"; do
    run sudo systemctl is-active --quiet "$service"
  done
}

write_release_version() {
  local release_version release_file
  release_version="$(git rev-parse HEAD)"
  release_file="$(mktemp)"
  printf 'RELEASE_VERSION=%s\n' "$release_version" > "$release_file"
  run sudo install -D -m 0644 "$release_file" /run/ks-os/release.env
  rm -f "$release_file"
}

PREV_COMMIT="$(git rev-parse HEAD)"

rollback() {
  $ROLLBACK_ON_FAILURE || { log "Rollback disabled; manual recovery is required."; return; }
  log "Rolling the complete application release back to $PREV_COMMIT. Database down-migrations are never automatic."
  run git switch --detach "$PREV_COMMIT"
  run git branch --force "$DEPLOY_BRANCH" "$PREV_COMMIT"
  run git switch "$DEPLOY_BRANCH"
  run pnpm install --frozen-lockfile
  run pnpm run build
  write_release_version
  restart_release_services
}

on_error() {
  local exit_code=$?
  trap - ERR
  log "Deployment failed with exit code $exit_code."
  if ! $DRY_RUN; then rollback || true; fi
  exit "$exit_code"
}
trap on_error ERR

require_clean_branch
require_service_owned_ports
log "Preparing $DEPLOY_BRANCH from $PREV_COMMIT."
run git fetch origin "$DEPLOY_BRANCH"
run git merge --ff-only "origin/$DEPLOY_BRANCH"
run pnpm install --frozen-lockfile
run pnpm run build
run pnpm deploy:preflight
run pnpm db:migrations:validate
run pnpm db:migrations:plan

if $DRY_RUN; then
  trap - ERR
  log "Dry run complete. No migration or service state was changed."
  exit 0
fi

if [[ "$APPLY_MIGRATIONS" == "1" ]]; then
  run pnpm db:migrations:apply
else
  log "Skipping migrations. Set APPLY_MIGRATIONS=1 only after reviewing the plan."
fi

write_release_version
restart_release_services
check_http "API" "$API_HEALTH_URL"
check_http "site worker health" "$WORKER_HEALTH_URL"
check_http "site worker readiness" "$WORKER_READY_URL"
check_http "shared renderer" "$RENDERER_HEALTH_URL" "$RENDERER_HEALTH_HOST"

trap - ERR
log "Deployment completed at $(git rev-parse HEAD)."
