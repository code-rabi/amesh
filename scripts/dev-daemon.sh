#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-ws://localhost:3001/ws?role=node}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-demo-token}"
NODE_ID="${NODE_ID:-node-a}"
AMESH_HOME="${AMESH_HOME:-$HOME/.local/share/amesh}"
ACPX_PREFIX="${ACPX_PREFIX:-$AMESH_HOME/acpx}"
ACPX_NPM_SPEC="${ACPX_NPM_SPEC:-acpx@latest}"
AMESH_ACPX_PATH="${AMESH_ACPX_PATH:-$ACPX_PREFIX/bin/acpx}"
ACPX_CONFIG_PATH="${ACPX_CONFIG_PATH:-$HOME/.acpx/config.json}"
CONFIG_PATH="${CONFIG_PATH:-.amesh-agents.json}"
STATE_PATH="${STATE_PATH:-.amesh-node-state.json}"
STALE_EXAMPLE_CONFIG="examples/agents.json"
SERVER_ENV_PATH="apps/server/.env"
SERVER_ENV_LOCAL_PATH="apps/server/.env.local"

read_registration_token() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi
  grep -E '^AMESH_REGISTRATION_TOKEN=' "$env_file" | tail -n 1 | cut -d '=' -f 2-
}

ensure_acpx_config() {
  local config_path="$1"
  mkdir -p "$(dirname "$config_path")"

  node <<'EOF' "$config_path"
const fs = require("fs");
const path = process.argv[1];
const valid = new Set(["deny", "fail"]);
let config = {};
let original = null;
let needsWrite = false;
let backupWritten = false;

function writeBackup(contents) {
  if (backupWritten) {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.amesh-backup-${stamp}`;
  fs.writeFileSync(backupPath, contents);
  console.warn(`[amesh] backed up existing ACPX config to ${backupPath}`);
  backupWritten = true;
}

if (fs.existsSync(path)) {
  original = fs.readFileSync(path, "utf8");
  try {
    config = JSON.parse(original);
  } catch (error) {
    writeBackup(original);
    console.warn(`[amesh] ACPX config at ${path} is invalid JSON; rewriting a minimal compatible config: ${error.message}`);
    needsWrite = true;
  }
}

if (typeof config !== "object" || config === null || Array.isArray(config)) {
  if (original !== null && !needsWrite) {
    writeBackup(original);
    console.warn(`[amesh] ACPX config at ${path} is not a JSON object; rewriting a minimal compatible config`);
  }
  config = {};
  needsWrite = true;
}

if (!valid.has(config.nonInteractivePermissions)) {
  if (original !== null) {
    console.warn(
      `[amesh] ACPX config at ${path} has unsupported nonInteractivePermissions=${JSON.stringify(config.nonInteractivePermissions)}; overriding to "deny"`
    );
  }
  config.nonInteractivePermissions = "deny";
  needsWrite = true;
}

if (!fs.existsSync(path)) {
  needsWrite = true;
}

if (needsWrite) {
  if (original !== null) {
    writeBackup(original);
  }
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
EOF
}

register_node() {
  AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node register \
    --server "$SERVER_URL" \
    --token "$REGISTRATION_TOKEN" \
    --node-id "$NODE_ID" \
    --config "$CONFIG_PATH" \
    --state "$STATE_PATH"
}

run_node() {
  env AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node run --state "$STATE_PATH"
}

if [[ -z "${REGISTRATION_TOKEN:-}" || "$REGISTRATION_TOKEN" == "demo-token" ]]; then
  if token="$(read_registration_token "$SERVER_ENV_PATH")"; then
    REGISTRATION_TOKEN="$token"
  fi
  if token="$(read_registration_token "$SERVER_ENV_LOCAL_PATH")"; then
    REGISTRATION_TOKEN="$token"
  fi
fi

mkdir -p "$AMESH_HOME"

if [[ "$CONFIG_PATH" == "$STALE_EXAMPLE_CONFIG" ]]; then
  echo "dev:daemon refuses to use $STALE_EXAMPLE_CONFIG as CONFIG_PATH" >&2
  exit 1
fi

if [[ -f "$STATE_PATH" ]] && grep -Eq "\"configPath\"[[:space:]]*:[[:space:]]*\"${STALE_EXAMPLE_CONFIG//\//\\/}\"" "$STATE_PATH"; then
  echo "Removing stale local daemon state that points at $STALE_EXAMPLE_CONFIG"
  rm -f "$STATE_PATH"
  if [[ -f "$CONFIG_PATH" ]]; then
    echo "Removing stale generated config at $CONFIG_PATH"
    rm -f "$CONFIG_PATH"
  fi
fi

if [[ ! -x "$AMESH_ACPX_PATH" ]]; then
  npm install --global --prefix "$ACPX_PREFIX" "$ACPX_NPM_SPEC"
fi

ensure_acpx_config "$ACPX_CONFIG_PATH"

if [[ ! -f "$CONFIG_PATH" ]]; then
  AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node detect \
    --config "$CONFIG_PATH"
fi

if [[ ! -f "$STATE_PATH" ]]; then
  register_node
fi

run_log="$(mktemp "${TMPDIR:-/tmp}/amesh-dev-daemon.XXXXXX.log")"
trap 'rm -f "$run_log"' EXIT

if run_node 2>&1 | tee "$run_log"; then
  exit 0
fi
status=${PIPESTATUS[0]}

if grep -q 'resume denied: invalid_reconnect_token' "$run_log"; then
  echo "Detected stale local node state; re-registering $NODE_ID against $SERVER_URL" >&2
  rm -f "$STATE_PATH"
  register_node
  exec env AMESH_ACPX_PATH="$AMESH_ACPX_PATH" go run ./cmd/amesh-node run --state "$STATE_PATH"
fi

exit "$status"
