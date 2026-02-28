#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────
# Generate dolos.toml for Dolos (L1 Cardano TRP)
#
# Usage:
#   ./scripts/generate-dolos-config.sh <output-path>
#
# Required env vars:
#   DOLOS_TRP_PORT, DOLOS_GRPC_PORT,
#   DOLOS_PEER_ADDRESS, DOLOS_NETWORK_MAGIC, DOLOS_IS_TESTNET
# ────────────────────────────────────────────────

: "${DOLOS_TRP_PORT:=8064}"
: "${DOLOS_GRPC_PORT:=50051}"
: "${DOLOS_PEER_ADDRESS:?DOLOS_PEER_ADDRESS is required}"
: "${DOLOS_NETWORK_MAGIC:?DOLOS_NETWORK_MAGIC is required}"
: "${DOLOS_IS_TESTNET:=true}"

CONFIG_PATH=${1:-dolos.toml}

cat > "${CONFIG_PATH}" <<EOF
[upstream]
peer_address = "${DOLOS_PEER_ADDRESS}"
network_magic = ${DOLOS_NETWORK_MAGIC}
is_testnet = ${DOLOS_IS_TESTNET}

[storage]
version = "v3"
path = "/data"

[genesis]
byron_path = "/data/genesis/byron.json"
shelley_path = "/data/genesis/shelley.json"
alonzo_path = "/data/genesis/alonzo.json"
conway_path = "/data/genesis/conway.json"

[sync]
pull_batch_size = 200

[submit]
prune_height = 10000

[serve.grpc]
listen_address = "0.0.0.0:${DOLOS_GRPC_PORT}"
permissive_cors = true

[serve.trp]
listen_address = "0.0.0.0:${DOLOS_TRP_PORT}"
max_optimize_rounds = 10
permissive_cors = true

[logging]
max_level = "INFO"
EOF

echo "Wrote Dolos config to ${CONFIG_PATH}:"
echo "  upstream.peer_address = ${DOLOS_PEER_ADDRESS}"
echo "  upstream.network_magic = ${DOLOS_NETWORK_MAGIC}"
echo "  serve.trp.listen_address = 0.0.0.0:${DOLOS_TRP_PORT}"
echo "  serve.grpc.listen_address = 0.0.0.0:${DOLOS_GRPC_PORT}"
