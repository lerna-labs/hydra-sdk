#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────
# Generate a per-instance .env for a Hydra node
# with an auto-incrementing per-NETWORK port offset.
#
# Usage:
#   ./scripts/generate-instance-env.sh <network> <instance> [offset]
#
# Examples:
#   ./scripts/generate-instance-env.sh mainnet alpha        # auto offset
#   ./scripts/generate-instance-env.sh mainnet beta 3       # force offset=3
# ────────────────────────────────────────────────

NETWORK=${1:-}
INSTANCE=${2:-}
USER_OFFSET=${3:-}

if [[ -z "${NETWORK}" || -z "${INSTANCE}" ]]; then
  echo "Usage: $0 <network> <instance> [offset]" >&2
  exit 1
fi

BASE_ENV=".${NETWORK}.env"
NEW_ENV=".${NETWORK}.${INSTANCE}.env"

if [[ ! -f "${BASE_ENV}" ]]; then
  echo "❌ Base env '${BASE_ENV}' not found." >&2
  exit 1
fi

if [[ -f "${NEW_ENV}" ]]; then
  echo "⚠️  ${NEW_ENV} already exists; aborting to avoid overwrite." >&2
  exit 1
fi

# Per-network counter lives under data/<network>/instances/.counter
COUNTER_DIR="data/${NETWORK}/instances"
STATE_DIR="data/${NETWORK}/instances/${INSTANCE}/hydra"
COUNTER_FILE="${COUNTER_DIR}/.counter"
LOCK_FILE="${COUNTER_FILE}.lock"

mkdir -p "${COUNTER_DIR}"
mkdir -p "${STATE_DIR}"
mkdir -p "data/${NETWORK}/instances/${INSTANCE}/keys"
mkdir -p "data/${NETWORK}/instances/${INSTANCE}/config"

# Decide the offset:
# - If user provided an explicit offset, use it.
# - Else, increment the per-network counter and use that value.
if [[ -n "${USER_OFFSET}" ]]; then
  OFFSET="${USER_OFFSET}"
else
  # Initialize counter to 0 if missing; first auto-allocated offset will be 1
  [[ -f "${COUNTER_FILE}" ]] || echo "0" > "${COUNTER_FILE}"

  # Use a simple flock if available to prevent races
  if command -v flock >/dev/null 2>&1; then
    exec 9>"${LOCK_FILE}"
    flock 9
    CUR=$(cat "${COUNTER_FILE}")
    OFFSET=$((CUR + 1))
    echo "${OFFSET}" > "${COUNTER_FILE}"
    # lock fd 9 auto-released on exit
  else
    # Best-effort without flock
    CUR=$(cat "${COUNTER_FILE}")
    OFFSET=$((CUR + 1))
    echo "${OFFSET}" > "${COUNTER_FILE}"
  fi
fi

echo "🔧 Generating ${NEW_ENV} from ${BASE_ENV} (offset=${OFFSET})"
echo "   Counter file: ${COUNTER_FILE}"

# Helper to add offset safely
bump() {
  local base=${1:-0}
  local inc=${2:-0}
  echo $((base + inc))
}

# Read base values (fall back to sensible defaults if not present)
get_var() { grep -E "^$1=" "$2" | head -n1 | cut -d= -f2-; }

API_PORT=$(get_var API_PORT "${BASE_ENV}");      API_PORT=${API_PORT:-4001}
LISTEN_PORT=$(get_var LISTEN_PORT "${BASE_ENV}");LISTEN_PORT=${LISTEN_PORT:-5001}
TRP_PORT=$(get_var TRP_PORT "${BASE_ENV}");      TRP_PORT=${TRP_PORT:-8165}
EXPRESS_PORT=$(get_var EXPRESS_PORT "${BASE_ENV}");EXPRESS_PORT=${EXPRESS_PORT:-3000}

# Dolos is per-network (not per-instance), so read but don't offset
DOLOS_TRP_PORT=$(get_var DOLOS_TRP_PORT "${BASE_ENV}"); DOLOS_TRP_PORT=${DOLOS_TRP_PORT:-}

API_PORT=$(bump "${API_PORT}" "${OFFSET}")
LISTEN_PORT=$(bump "${LISTEN_PORT}" "${OFFSET}")
TRP_PORT=$(bump "${TRP_PORT}" "${OFFSET}")
EXPRESS_PORT=$(bump "${EXPRESS_PORT}" "${OFFSET}")

NODE_ID="${NETWORK}-${INSTANCE}"

# UUIDv4 for X_API_KEY
if command -v uuidgen >/dev/null 2>&1; then
  X_API_KEY=$(uuidgen)
elif [[ -r /proc/sys/kernel/random/uuid ]]; then
  X_API_KEY=$(cat /proc/sys/kernel/random/uuid)
else
  # Fallback (not perfect, but fine for dev)
  X_API_KEY=$(date +%s%N | sha256sum | cut -c1-32)
fi

cat > "${NEW_ENV}" <<EOF
# ── Network: ${NETWORK} Instance: ${INSTANCE} overrides (auto-generated) ─────────────────────
INSTANCE=${INSTANCE}
NODE_ID=${NODE_ID}

# Unique ports for this instance
API_PORT=${API_PORT}
EXPRESS_PORT=${EXPRESS_PORT}
LISTEN_PORT=${LISTEN_PORT}
TRP_PORT=${TRP_PORT}

# Instance-specific URLs
HYDRA_API_URL=http://hydra-node-\${NETWORK}-\${INSTANCE}:\${API_PORT}
HYDRA_HTTP_URL=http://hydra-node-\${NETWORK}-\${INSTANCE}:\${API_PORT}
HYDRA_WS_URL=ws://hydra-node-\${NETWORK}-\${INSTANCE}:\${API_PORT}
TRP_URL=http://hydra-trp-\${NETWORK}-\${INSTANCE}:\${TRP_PORT}

# The header value for x-api-key that Express Middleware will check for
X_API_KEY=${X_API_KEY}

# EXPRESS_IMAGE=ghcr.io/lerna-labs/ekklesia-hydra:branch-main
EOF

# Append Dolos TRP URL if the network has Dolos configured
if [[ -n "${DOLOS_TRP_PORT}" ]]; then
  cat >> "${NEW_ENV}" <<EOF

# Cardano L1 TRP (Dolos) — shared across instances on this network
DOLOS_TRP_URL=http://cardano-dolos-\${NETWORK}:${DOLOS_TRP_PORT}
EOF
fi

echo "✅ Created ${NEW_ENV}"
