#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-ws://localhost:3001/ws?role=node}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-demo-token}"
NODE_ID="${NODE_ID:-node-a}"
AMESH_HOME="${AMESH_HOME:-$HOME/.local/share/amesh}"
ACPX_PREFIX="${ACPX_PREFIX:-$AMESH_HOME/acpx}"
ACPX_NPM_SPEC="${ACPX_NPM_SPEC:-acpx@latest}"
AMESH_ACPX_PATH="${AMESH_ACPX_PATH:-$ACPX_PREFIX/bin/acpx}"
CONFIG_PATH="${CONFIG_PATH:-.amesh-agents.json}"
STATE_PATH="${STATE_PATH:-.amesh-node-state.json}"

mkdir -p "$AMESH_HOME"

if [[ ! -x "$AMESH_ACPX_PATH" ]]; then
  npm install --global --prefix "$ACPX_PREFIX" "$ACPX_NPM_SPEC"
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node detect \
    --config "$CONFIG_PATH"
fi

if [[ ! -f "$STATE_PATH" ]]; then
  AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node register \
    --server "$SERVER_URL" \
    --token "$REGISTRATION_TOKEN" \
    --node-id "$NODE_ID" \
    --config "$CONFIG_PATH" \
    --state "$STATE_PATH"
fi

exec env AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node run --state "$STATE_PATH"
