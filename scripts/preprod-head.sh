#!/usr/bin/env bash
#
# preprod-head.sh — start/stop just the hydra-node for a preprod instance.
#
# Unlike `make hydra-start`, this boots ONLY the hydra-node (no TRP, no express
# middleware, no TLS requirement) so you can drive a head directly with the SDK.
# It connects to the local cardano-node via its node.socket and observes L1.
#
# Prerequisites (see docs/e2e-preprod.md):
#   - cardano-node-preprod running and synced (data/preprod/config/node.socket)
#   - an instance created:  make NETWORK=preprod INSTANCE=<id> create-instance
#   - the instance's admin cardano address funded with tADA (for L1 txs)
#
# Usage:
#   INSTANCE=e2e scripts/preprod-head.sh up       # start (wait for API/Greetings)
#   INSTANCE=e2e scripts/preprod-head.sh status
#   INSTANCE=e2e scripts/preprod-head.sh logs
#   INSTANCE=e2e scripts/preprod-head.sh down      # stop + remove container
#   INSTANCE=e2e scripts/preprod-head.sh kill      # down + purge instance state
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

NETWORK=preprod
INSTANCE="${INSTANCE:-e2e}"

getenv() {
  local key="$1" val="" f
  for f in ".env" ".${NETWORK}.env" ".${NETWORK}.${INSTANCE}.env"; do
    [ -f "$f" ] || continue
    local line; line="$(grep -E "^${key}=" "$f" | tail -n1 || true)"
    [ -n "$line" ] && val="${line#*=}"
  done
  printf '%s' "$val"
}

API_PORT="${API_PORT:-$(getenv API_PORT)}"; API_PORT="${API_PORT:-4102}"
HYDRA_IMAGE="${HYDRA_IMAGE:-$(getenv HYDRA_IMAGE)}"
[ -n "$HYDRA_IMAGE" ] || { echo "❌ HYDRA_IMAGE must be set in .env" >&2; exit 1; }
WAIT="${WAIT:-1}"

export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"
export NETWORK INSTANCE
# The preprod compose declares an express-api service with `image: ${EXPRESS_IMAGE}`
# and no default/build-context, so compose fails project validation when it is
# unset — even though we only ever start `hydra-node`. Provide a harmless
# placeholder; express-api is never started, so this image is never used.
export EXPRESS_IMAGE="${EXPRESS_IMAGE:-busybox:latest}"

COMPOSE_FILE="docker/docker-compose.${NETWORK}.yml"
PROJECT="hydra-${NETWORK}-${INSTANCE}"
NET_NAME="hydra-network-${NETWORK}"
CONTAINER="hydra-node-${NETWORK}-${INSTANCE}"
STATE_DIR="data/${NETWORK}/instances/${INSTANCE}/hydra"

ENV_FILES=(--env-file .env --env-file ".${NETWORK}.env" --env-file ".${NETWORK}.${INSTANCE}.env")
DC=(docker compose "${ENV_FILES[@]}" -f "$COMPOSE_FILE" -p "$PROJECT")

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { echo "❌ $*" >&2; exit 1; }

preflight() {
  [ -f ".${NETWORK}.${INSTANCE}.env" ] || die "Missing .${NETWORK}.${INSTANCE}.env — run: make NETWORK=${NETWORK} INSTANCE=${INSTANCE} create-instance"
  [ -f "data/${NETWORK}/instances/${INSTANCE}/keys/${INSTANCE}.hydra.sk" ] || die "Missing hydra key — run create-instance"
  [ -f "data/${NETWORK}/instances/${INSTANCE}/keys/${INSTANCE}.cardano.sk" ] || die "Missing cardano key — run create-instance"
  [ -S "data/${NETWORK}/config/node.socket" ] || die "No cardano node.socket — is cardano-node-${NETWORK} running and synced? (make cardano-start)"
  if ! docker network inspect "$NET_NAME" >/dev/null 2>&1; then
    log "Creating external docker network: $NET_NAME"; docker network create "$NET_NAME" >/dev/null
  fi
}

wait_ready() {
  [ "$WAIT" = "1" ] || { warn "WAIT=0 — skipping readiness poll"; return; }
  local url="http://localhost:${API_PORT}/protocol-parameters"
  log "Waiting for hydra-node API at ${url} (connects to cardano-node + observes L1) ..."
  for i in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ok "hydra-node API is up on :${API_PORT}"
      return 0
    fi
    sleep 2
  done
  warn "API not up after ~240s. Recent logs:"; "${DC[@]}" logs --tail=40 hydra-node || true
  die "Timed out waiting for hydra-node API on :${API_PORT}"
}

cmd_up() {
  log "Starting preprod hydra-node (instance=${INSTANCE}, image=${HYDRA_IMAGE}, api=:${API_PORT})"
  preflight
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER" && ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    log "Removing stale container: $CONTAINER"; docker rm -f "$CONTAINER" >/dev/null
  fi
  log "Booting hydra-node only (TRP/express-api skipped)"
  "${DC[@]}" up -d hydra-node
  wait_ready
  echo; ok "Preprod hydra-node ready."
  echo "    API : http://localhost:${API_PORT}"
  echo "    WS  : ws://localhost:${API_PORT}"
}

cmd_down() { log "Stopping preprod hydra-node"; "${DC[@]}" down --remove-orphans || true; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; ok "Stopped."; }

cmd_kill() {
  cmd_down
  log "Purging instance state: $STATE_DIR"
  docker run --rm -v "$(pwd)/${STATE_DIR}:/state" busybox:latest sh -c 'rm -rf /state/* /state/.[!.]* 2>/dev/null || true'
  ok "Instance head state purged (keys + env kept)."
}

cmd_status() {
  "${DC[@]}" ps || true
  curl -fsS "http://localhost:${API_PORT}/protocol-parameters" >/dev/null 2>&1 \
    && ok "API responding on :${API_PORT}" || warn "API not responding on :${API_PORT}"
}

cmd_logs() { "${DC[@]}" logs -ft --tail=50 hydra-node; }

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  kill)   cmd_kill ;;
  status) cmd_status ;;
  logs)   cmd_logs ;;
  *) echo "Usage: INSTANCE=<id> $0 {up|down|kill|status|logs}   (WAIT=0|1)" >&2; exit 2 ;;
esac
