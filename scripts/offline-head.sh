#!/usr/bin/env bash
#
# offline-head.sh — start/stop a single-party *offline* Hydra head seeded with a
# given UTxO set, for rapid and dynamic local testing.
#
# An offline Hydra head needs no Cardano L1, no peers, and no init/commit dance:
# the node boots straight into the `Open` state with the UTxOs you hand it via
# `--initial-utxo`. That makes it the fastest possible loop for exercising the
# SDK against a real hydra-node (matching the version pinned in .env).
#
# Usage:
#   scripts/offline-head.sh up            # start the head (default UTxO set)
#   UTXO=path/to/utxo.json \
#     scripts/offline-head.sh up          # start seeded with a custom UTxO set
#   scripts/offline-head.sh status        # show the running container + head status
#   scripts/offline-head.sh logs          # follow hydra-node logs
#   scripts/offline-head.sh down          # stop and remove the head
#
# Environment overrides:
#   UTXO   Path to a Hydra UTxO JSON file to seed the head with. When set, it is
#          copied to data/offline/config/utxo.json (the original is preserved
#          once as utxo.json.bak). Omit to reuse the existing utxo.json.
#   WAIT   "1" (default) to poll the API until the head is Open; "0" to skip.
#   FRESH  "1" to wipe persisted head state before starting, so a new UTxO set
#          actually takes effect. (A persisted head RESUMES its old state and
#          ignores --initial-utxo.) `reset` is shorthand for FRESH=1 up.
#
set -euo pipefail

# ── Resolve repo root and load env ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

NETWORK=offline

# Read a single key from the docker env files (offline overrides base). These are
# docker-style env files (unquoted values may contain spaces), so we parse the
# specific keys we need rather than `source`-ing them as shell.
getenv() {
  local key="$1" val=""
  local f
  for f in ".env" ".${NETWORK}.env"; do
    [ -f "$f" ] || continue
    local line
    line="$(grep -E "^${key}=" "$f" | tail -n1 || true)"
    [ -n "$line" ] && val="${line#*=}"
  done
  printf '%s' "$val"
}

INSTANCE="${INSTANCE:-$(getenv INSTANCE)}"; INSTANCE="${INSTANCE:-participant1}"
NODE_ID="${NODE_ID:-$(getenv NODE_ID)}"; NODE_ID="${NODE_ID:-$INSTANCE}"
API_PORT="${API_PORT:-$(getenv API_PORT)}"; API_PORT="${API_PORT:-4000}"
HYDRA_IMAGE="${HYDRA_IMAGE:-$(getenv HYDRA_IMAGE)}"
[ -n "$HYDRA_IMAGE" ] || { echo "❌ HYDRA_IMAGE must be set in .env" >&2; exit 1; }
WAIT="${WAIT:-1}"
FRESH="${FRESH:-0}"
HYDRA_STATE_DIR="data/${NETWORK}/instances/${INSTANCE}/hydra"

export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"
export NETWORK INSTANCE NODE_ID

COMPOSE_FILE="docker/docker-compose.${NETWORK}.yml"
PROJECT="hydra-${NETWORK}-${INSTANCE}"
NET_NAME="hydra-network-${NETWORK}"
CONFIG_DIR="data/${NETWORK}/config"
KEY_DIR="data/${NETWORK}/instances/${INSTANCE}/keys"
CONTAINER="hydra-node-${NETWORK}"

# docker compose only auto-loads .env; pass the offline overrides explicitly.
ENV_FILES=(--env-file .env --env-file ".${NETWORK}.env")
DC=(docker compose "${ENV_FILES[@]}" -f "$COMPOSE_FILE" -p "$PROJECT")

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }

ensure_network() {
  if ! docker network inspect "$NET_NAME" >/dev/null 2>&1; then
    log "Creating external docker network: $NET_NAME"
    docker network create "$NET_NAME" >/dev/null
  fi
  ok "Network ready: $NET_NAME"
}

ensure_keys() {
  mkdir -p "$KEY_DIR" "data/${NETWORK}/instances/${INSTANCE}/hydra"
  if [ -f "${KEY_DIR}/${NODE_ID}.hydra.sk" ]; then
    ok "Hydra keys present: ${KEY_DIR}/${NODE_ID}.hydra.sk"
    return
  fi
  log "Generating Hydra keys for ${INSTANCE} (offline)"
  docker compose "${ENV_FILES[@]}" -f docker/docker-compose.keys.yml run --rm hydra-key-gen
  ok "Hydra keys generated"
}

apply_utxo() {
  mkdir -p "$CONFIG_DIR"
  if [ -n "${UTXO:-}" ]; then
    [ -f "$UTXO" ] || { echo "❌ UTXO file not found: $UTXO" >&2; exit 1; }
    if [ -f "${CONFIG_DIR}/utxo.json" ] && [ ! -f "${CONFIG_DIR}/utxo.json.bak" ]; then
      cp "${CONFIG_DIR}/utxo.json" "${CONFIG_DIR}/utxo.json.bak"
      warn "Backed up existing UTxO set to ${CONFIG_DIR}/utxo.json.bak"
    fi
    cp "$UTXO" "${CONFIG_DIR}/utxo.json"
    ok "Seeded head with UTxO set from: $UTXO"
  else
    [ -f "${CONFIG_DIR}/utxo.json" ] || { echo "❌ No UTXO given and ${CONFIG_DIR}/utxo.json is missing" >&2; exit 1; }
    ok "Using existing UTxO set: ${CONFIG_DIR}/utxo.json"
  fi
  if command -v jq >/dev/null 2>&1; then
    log "Initial UTxO set:"; jq -C . "${CONFIG_DIR}/utxo.json" || true
  fi
}

persistence_nonempty() {
  [ -d "$HYDRA_STATE_DIR" ] && [ -n "$(ls -A "$HYDRA_STATE_DIR" 2>/dev/null || true)" ]
}

wipe_persistence() {
  # hydra-node writes state as root, so wipe via a throwaway container.
  log "Wiping persisted head state: $HYDRA_STATE_DIR"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run --rm -v "$(pwd)/${HYDRA_STATE_DIR}:/state" busybox:latest \
    sh -c 'rm -rf /state/* /state/.[!.]* 2>/dev/null || true'
  ok "Head state wiped (next start will be a fresh head)"
}

clear_stale() {
  # The compose uses a fixed container_name, so a leftover container (even from a
  # different project/version) blocks a fresh `up`. Remove it if not running.
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      log "Removing stale container: $CONTAINER"
      docker rm -f "$CONTAINER" >/dev/null
    fi
  fi
}

wait_for_open() {
  [ "$WAIT" = "1" ] || { warn "WAIT=0 — skipping readiness poll"; return; }
  local url="http://localhost:${API_PORT}/snapshot/utxo"

  # How many UTxOs did we seed? Under hydra-node v2 (ADR-33) the head opens
  # EMPTY and the initial UTxO set is ingested as a deposit/increment that
  # finalizes a moment later — so "ready" means the API responds AND the seeded
  # UTxOs have landed in the confirmed snapshot, not just that the head is Open.
  local want=0
  if command -v jq >/dev/null 2>&1; then
    want="$(jq 'length' "${CONFIG_DIR}/utxo.json" 2>/dev/null || echo 0)"
  fi

  log "Waiting for head to be Open and funded (${want} UTxO(s)) at ${url} ..."
  for i in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      if [ "$want" = "0" ] || ! command -v jq >/dev/null 2>&1; then
        ok "Head is Open (API responding on :${API_PORT})"
        return 0
      fi
      local have; have="$(curl -fsS "$url" | jq 'length' 2>/dev/null || echo 0)"
      if [ "$have" -ge "$want" ]; then
        ok "Head is Open and funded: ${have}/${want} UTxO(s) in the L2 snapshot"
        log "Live head UTxO snapshot:"; curl -fsS "$url" | jq -C . || true
        return 0
      fi
    fi
    sleep 1
  done
  echo "❌ Timed out waiting for the head to open/fund on :${API_PORT}" >&2
  warn "Recent hydra-node logs:"; "${DC[@]}" logs --tail=30 hydra-node || true
  exit 1
}

cmd_up() {
  log "Starting offline Hydra head  (image=${HYDRA_IMAGE}, instance=${INSTANCE}, api=:${API_PORT})"
  ensure_network
  ensure_keys
  if [ "$FRESH" = "1" ]; then
    wipe_persistence
  elif persistence_nonempty; then
    warn "Persisted head state exists — RESUMING it. --initial-utxo is ignored."
    [ -n "${UTXO:-}" ] && warn "Your UTXO=$UTXO will NOT take effect. Re-run with FRESH=1 (or 'reset') to apply it."
  fi
  apply_utxo
  clear_stale
  log "Booting hydra-node only (TRP/express-api intentionally skipped for a fast loop)"
  "${DC[@]}" up -d hydra-node
  wait_for_open
  echo
  ok "Offline head ready."
  echo "    API   : http://localhost:${API_PORT}"
  echo "    WS    : ws://localhost:${API_PORT}"
  echo "    Logs  : scripts/offline-head.sh logs"
  echo "    Stop  : scripts/offline-head.sh down"
}

cmd_down() {
  log "Stopping offline Hydra head"
  "${DC[@]}" down --remove-orphans || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  ok "Offline head stopped."
}

cmd_status() {
  "${DC[@]}" ps || true
  if curl -fsS "http://localhost:${API_PORT}/snapshot/utxo" >/dev/null 2>&1; then
    ok "Head API responding on :${API_PORT} (Open)"
  else
    warn "Head API not responding on :${API_PORT}"
  fi
}

cmd_logs() { "${DC[@]}" logs -ft --tail=50 hydra-node; }

case "${1:-up}" in
  up)     cmd_up ;;
  reset)  FRESH=1; cmd_up ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  logs)   cmd_logs ;;
  *) echo "Usage: $0 {up|reset|down|status|logs}   (UTXO=path WAIT=0|1 FRESH=0|1)" >&2; exit 2 ;;
esac
