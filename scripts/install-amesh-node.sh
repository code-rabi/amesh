#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/examples/agents.json}"
STATE_PATH="${STATE_PATH:-$HOME/.config/amesh/node-state.json}"
BINARY_PATH="${BINARY_PATH:-$INSTALL_DIR/amesh-node}"
SERVICE_NAME="${SERVICE_NAME:-amesh-node}"
SERVICE_PATH="${SERVICE_PATH:-$HOME/.config/systemd/user/${SERVICE_NAME}.service}"
SERVER_URL="${SERVER_URL:-}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-}"
NODE_ID="${NODE_ID:-$(hostname)-amesh}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

need go
need mkdir

if [[ -z "$SERVER_URL" ]]; then
  echo "SERVER_URL is required" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "config file not found: $CONFIG_PATH" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$(dirname "$STATE_PATH")"
mkdir -p "$(dirname "$SERVICE_PATH")"

(
  cd "$ROOT_DIR"
  go build -o "$BINARY_PATH" ./cmd/amesh-node
)

if [[ ! -f "$STATE_PATH" ]]; then
  if [[ -z "$REGISTRATION_TOKEN" ]]; then
    echo "REGISTRATION_TOKEN is required for first-time registration" >&2
    exit 1
  fi

  "$BINARY_PATH" register \
    --server "$SERVER_URL" \
    --token "$REGISTRATION_TOKEN" \
    --node-id "$NODE_ID" \
    --config "$CONFIG_PATH" \
    --state "$STATE_PATH"
fi

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=amesh remote node daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BINARY_PATH run --state $STATE_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"
  echo "installed and started user service: $SERVICE_NAME"
else
  echo "systemctl not found; service file written to $SERVICE_PATH"
fi

echo "binary: $BINARY_PATH"
echo "state: $STATE_PATH"
