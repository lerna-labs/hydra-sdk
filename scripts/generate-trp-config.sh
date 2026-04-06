#!/usr/bin/env bash
set -euo pipefail

# Defaults (can be overridden by env)
: "${TRP_HOST:=0.0.0.0}"
: "${TRP_PORT:=8165}"
: "${HYDRA_HOST:=hydra-node}"
: "${HYDRA_API_PORT:=4001}"
: "${HYDRA_NETWORK:=0}"
: "${USE_TLS:=0}"
: "${TRP_MAX_CONNECTIONS:=100}"

# Determine schemes based on USE_TLS
if [ "${USE_TLS}" = "1" ] || [ "${USE_TLS,,}" = "true" ]; then
  hydra_http_scheme="https"
  hydra_ws_scheme="wss"
else
  hydra_http_scheme="http"
  hydra_ws_scheme="ws"
fi

# Build TRP Listen URL
TRP_LISTEN_URL="${TRP_HOST}:${TRP_PORT}"

# Build Hydra HTTP/WS URLs
hydra_http_url="${hydra_http_scheme}://${HYDRA_HOST}:${HYDRA_API_PORT}"
hydra_ws_url="${hydra_ws_scheme}://${HYDRA_HOST}:${HYDRA_API_PORT}"

# Allow overriding full URLs directly if provided
: "${HYDRA_HTTP_URL:=$hydra_http_url}"
: "${HYDRA_WS_URL:=$hydra_ws_url}"

# Output path (can be parameterized)
CONFIG_PATH=${1:-config.toml}

cat > "${CONFIG_PATH}" <<EOF
[trp]
listen_address = "${TRP_LISTEN_URL}"
permissive_cors = true
max_connections = ${TRP_MAX_CONNECTIONS}

[hydra]
ws_url = "${HYDRA_WS_URL}"
http_url = "${HYDRA_HTTP_URL}"
network = ${HYDRA_NETWORK}
EOF

echo "Wrote TRP config to ${CONFIG_PATH}:"
echo "  listen_address = ${TRP_LISTEN_URL}"
echo "  hydra.ws_url = ${HYDRA_WS_URL}"
echo "  hydra.http_url = ${HYDRA_HTTP_URL}"
echo "  hydra.network = ${HYDRA_NETWORK}"
