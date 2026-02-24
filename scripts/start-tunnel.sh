#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH=/tunnel/node.socket
SOCKET_DIR=$(dirname "$SOCKET_PATH")

DEMETER_VERSION=$(dmtrctl --version)

# Abort if the socket directory does not exist
if [ ! -d "$SOCKET_DIR" ]; then
  echo "Error: Socket directory '$SOCKET_DIR' does not exist."
  echo "Please create it or check your volume mount configuration."
  exit 1
fi

# Remove existing socket if present
if [ -e "$SOCKET_PATH" ]; then
  echo "Removing existing socket at $SOCKET_PATH"
  rm -f "$SOCKET_PATH"
fi

# Check required environment variables
if [ -z "${PORT_NAME}" ] || [ -z "${NAMESPACE}" ] || [ -z "${API_KEY}" ]; then
  echo "Missing required env vars: PORT_NAME, NAMESPACE, API_KEY"
  exit 1
fi

echo "Using version: ${DEMETER_VERSION}"
echo "Starting Demeter tunnel to $PORT_NAME in namespace $NAMESPACE..."
echo "Socket Path: ${SOCKET_PATH}..."
exec dmtrctl ports tunnel "$PORT_NAME" \
  --socket "$SOCKET_PATH" \
  --namespace "$NAMESPACE" \
  --api-key "$API_KEY" \
  --verbose
