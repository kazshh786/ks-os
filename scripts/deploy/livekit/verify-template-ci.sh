#!/usr/bin/env bash
# GitHub-hosted CI only. Validates the production template inside an isolated,
# network-disabled container with temporary credentials and self-signed test TLS.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${CI:-}" == true && -n "${RUNNER_TEMP:-}" ]] || {
  echo 'This check is restricted to an isolated GitHub Actions runner.' >&2
  exit 1
}
template_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
task_dir="$(mktemp -d "$RUNNER_TEMP/ksos-livekit-template.XXXXXX")"
project="ksos-livekit-template-${GITHUB_RUN_ID:-ci}-${GITHUB_RUN_ATTEMPT:-1}"
export LIVEKIT_CONFIG_FILE="$task_dir/livekit.yaml"
export LIVEKIT_KEYS_FILE="$task_dir/keys.yaml"
export LIVEKIT_TURN_CERT_DIR="$task_dir/certs"
compose=(docker compose --project-name "$project" -f "$template_dir/compose.yml" -f "$task_dir/isolated.yml")
cleanup() {
  "${compose[@]}" down --timeout 5 >/dev/null 2>&1 || true
  case "$task_dir" in "$RUNNER_TEMP"/ksos-livekit-template.*) sudo rm -rf -- "$task_dir" ;; esac
}
trap cleanup EXIT
mkdir -p "$task_dir/certs"
chmod 755 "$task_dir" "$task_dir/certs"
secret="$(openssl rand -hex 32)"
echo "::add-mask::$secret"
printf 'ksos_ci_template: %s\n' "$secret" > "$LIVEKIT_KEYS_FILE"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj /CN=turn.invalid -addext subjectAltName=DNS:turn.invalid \
  -keyout "$task_dir/certs/privkey.pem" -out "$task_dir/certs/fullchain.pem" >/dev/null 2>&1
sed \
  -e 's/REPLACE_WITH_MEDIA_PUBLIC_IPV4/127.0.0.1/' \
  -e 's/REPLACE_WITH_APPROVED_TURN_HOSTNAME/turn.invalid/' \
  -e 's/REPLACE_WITH_SEPARATE_TURN_PUBLIC_IPV4/127.0.0.1/' \
  -e 's/REPLACE_WITH_SAME_SERVER_API_KEY/ksos_ci_template/' \
  -e 's/enable_loopback_candidate: false/enable_loopback_candidate: true/' \
  -e 's#https://api.kasimshah.com/api/v1/communications/conversations/meetings/webhook#http://127.0.0.1:9/isolated-webhook#' \
  "$template_dir/livekit.example.yaml" > "$LIVEKIT_CONFIG_FILE"
if grep -q REPLACE_ "$LIVEKIT_CONFIG_FILE"; then
  echo 'A template placeholder was not replaced.' >&2
  exit 1
fi
sudo chown 65532:65532 "$LIVEKIT_KEYS_FILE" "$task_dir/certs/privkey.pem"
sudo chmod 600 "$LIVEKIT_KEYS_FILE" "$task_dir/certs/privkey.pem"
cat > "$task_dir/isolated.yml" <<'YAML'
services:
  livekit:
    network_mode: none
    restart: 'no'
YAML
"${compose[@]}" config --quiet
"${compose[@]}" pull --quiet
"${compose[@]}" up -d --wait --wait-timeout 90
"${compose[@]}" exec -T livekit wget -q -O /dev/null http://127.0.0.1:7880/
"${compose[@]}" exec -T livekit wget -q -O /dev/null http://127.0.0.1:6789/metrics
printf 'Pinned LiveKit production template parsed and started with isolated test TLS; health and metrics passed.\n'
printf 'This check does not validate production listeners, DNS, certificates, capacity, TURN relay paths or WebRTC connectivity.\n'
