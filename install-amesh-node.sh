#!/usr/bin/env bash

set -euo pipefail

REPO="${AMESH_REPO:-code-rabi/amesh}"
INSTALL_DIR="${INSTALL_DIR:-}"
VERSION_TAG="${AMESH_VERSION_TAG:-}"
AMESH_HOME="${AMESH_HOME:-$HOME/.local/share/amesh}"
ACPX_PREFIX="${ACPX_PREFIX:-$AMESH_HOME/acpx}"
ACPX_NPM_SPEC="${ACPX_NPM_SPEC:-acpx@latest}"
ACPX_CONFIG_PATH="${ACPX_CONFIG_PATH:-$HOME/.acpx/config.json}"
CONFIG_PATH="${CONFIG_PATH:-$HOME/.config/amesh/agents.json}"
STATE_PATH="${STATE_PATH:-$HOME/.config/amesh/node-state.json}"
BINARY_PATH="${BINARY_PATH:-}"
ACPX_BIN="${ACPX_BIN:-$ACPX_PREFIX/bin/acpx}"
SERVICE_NAME="${SERVICE_NAME:-amesh-node}"
SERVICE_PATH="${SERVICE_PATH:-$HOME/.config/systemd/user/${SERVICE_NAME}.service}"
SERVER_URL="${SERVER_URL:-}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-}"
NODE_ID="${NODE_ID:-$(hostname)-amesh}"
SELF_UPDATE="${AMESH_NODE_SELF_UPDATE:-0}"
REINSTALL="${AMESH_NODE_REINSTALL:-0}"

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  log "error: $*"
  exit 1
}

ensure_acpx_config() {
  config_path="$1"
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

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

detect_os() {
  case "$(uname -s)" in
    Linux) printf 'linux' ;;
    Darwin) printf 'darwin' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'windows' ;;
    *) fail "unsupported operating system: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
}

pick_install_dir() {
  if [ -n "${INSTALL_DIR}" ]; then
    printf '%s' "${INSTALL_DIR}"
    return
  fi

  if [ -w "/usr/local/bin" ]; then
    printf '/usr/local/bin'
    return
  fi

  printf '%s/.local/bin' "${HOME}"
}

latest_tag() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

asset_ext() {
  case "$1" in
    windows) printf 'zip' ;;
    *) printf 'tar.gz' ;;
  esac
}

extract_archive() {
  archive="$1"
  target_dir="$2"
  case "$archive" in
    *.tar.gz) tar -xzf "$archive" -C "$target_dir" ;;
    *.zip)
      if command -v unzip >/dev/null 2>&1; then
        unzip -q "$archive" -d "$target_dir"
      else
        bsdtar -xf "$archive" -C "$target_dir"
      fi
      ;;
    *) fail "unsupported archive format: $archive" ;;
  esac
}

require_node_major() {
  min_major="$1"
  current_major="$(
    node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null
  )"
  case "$current_major" in
    ''|*[!0-9]*)
      fail "could not determine Node.js major version from $(command -v node)"
      ;;
  esac
  if [ "$current_major" -lt "$min_major" ]; then
    fail "Node.js ${min_major}+ is required; found $(node -v) at $(command -v node)"
  fi
}

systemd_escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_systemd_env() {
  key="$1"
  value="$2"
  printf 'Environment="%s=%s"\n' "$key" "$(systemd_escape_env_value "$value")"
}

main() {
  need_cmd curl
  need_cmd uname
  need_cmd mktemp
  need_cmd tar
  need_cmd node
  need_cmd npm
  need_cmd install
  need_cmd mkdir

  if [[ -z "$SERVER_URL" && ! -f "$STATE_PATH" ]]; then
    fail "SERVER_URL is required"
  fi

  require_node_major 22

  os="$(detect_os)"
  arch="$(detect_arch)"
  ext="$(asset_ext "$os")"
  tag="${VERSION_TAG}"

  if [ -z "${tag}" ]; then
    tag="$(latest_tag)"
  fi

  [ -n "${tag}" ] || fail "could not determine release tag"

  asset="amesh-node-${os}-${arch}.${ext}"
  download_url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
  install_dir="$(pick_install_dir)"
  binary_path="${BINARY_PATH:-$install_dir/amesh-node}"
  cli_binary_path="${AMESH_CLI_PATH:-$install_dir/amesh}"
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  if [[ "$REINSTALL" == "1" ]]; then
    log "reinstall requested; removing existing node install artifacts"
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
      systemctl --user disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
    rm -f "$SERVICE_PATH" "$STATE_PATH" "$CONFIG_PATH" "$binary_path" "$cli_binary_path"
    rm -rf "$AMESH_HOME"
  fi

  mkdir -p "${install_dir}"
  mkdir -p "${AMESH_HOME}"
  mkdir -p "$(dirname "$STATE_PATH")"
  mkdir -p "$(dirname "$SERVICE_PATH")"
  mkdir -p "$(dirname "$CONFIG_PATH")"

  log "installing amesh-node from ${tag}"
  log "downloading ${download_url}"
  curl -fsSL "${download_url}" -o "${tmp_dir}/${asset}"

  extract_dir="${tmp_dir}/extract"
  mkdir -p "${extract_dir}"
  extract_archive "${tmp_dir}/${asset}" "${extract_dir}"

  binary_name="amesh-node"
  cli_binary_name="amesh"
  if [ "${os}" = "windows" ]; then
    binary_name="amesh-node.exe"
    cli_binary_name="amesh.exe"
  fi

  [ -f "${extract_dir}/${binary_name}" ] || fail "archive did not contain ${binary_name}"
  install -m 0755 "${extract_dir}/${binary_name}" "${binary_path}"
  if [ -f "${extract_dir}/${cli_binary_name}" ]; then
    install -m 0755 "${extract_dir}/${cli_binary_name}" "${cli_binary_path}"
  fi

  if command -v systemctl >/dev/null 2>&1 && [[ "$SELF_UPDATE" != "1" ]]; then
    systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if [[ ! -x "$ACPX_BIN" ]]; then
    log "installing managed acpx sidecar into ${ACPX_PREFIX}"
    npm install --global --prefix "$ACPX_PREFIX" "$ACPX_NPM_SPEC"
  else
    log "managed acpx already present: ${ACPX_BIN}"
  fi

  ensure_acpx_config "$ACPX_CONFIG_PATH"

  if [[ ! -f "$CONFIG_PATH" ]]; then
    log "no node config found; running detect into ${CONFIG_PATH}"
    env AMESH_ACPX_PATH="$ACPX_BIN" "$binary_path" detect --config "$CONFIG_PATH"
  else
    log "reusing existing node config: ${CONFIG_PATH}"
  fi

  if [[ -n "$REGISTRATION_TOKEN" ]]; then
    if [[ -f "$STATE_PATH" ]]; then
      log "registration token provided; refreshing node registration for ${NODE_ID}"
    else
      log "no node state found; registering node ${NODE_ID} against ${SERVER_URL}"
    fi
    "$binary_path" register \
      --server "$SERVER_URL" \
      --token "$REGISTRATION_TOKEN" \
      --node-id "$NODE_ID" \
      --config "$CONFIG_PATH" \
      --state "$STATE_PATH"
  elif [[ -f "$STATE_PATH" ]]; then
    log "reusing existing node state: ${STATE_PATH}"
  else
    fail "REGISTRATION_TOKEN is required for first-time registration"
  fi

  {
    cat <<EOF
[Unit]
Description=amesh remote node daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EOF
    write_systemd_env "AMESH_ACPX_PATH" "$ACPX_BIN"
    write_systemd_env "AMESH_NODE_VERSION" "$tag"
    write_systemd_env "PATH" "$PATH"
    printf 'ExecStart=%q run --state %q\n' "$binary_path" "$STATE_PATH"
    cat <<EOF
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  } >"$SERVICE_PATH"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    if [[ "$SELF_UPDATE" == "1" ]]; then
      systemctl --user enable "$SERVICE_NAME"
      log "prepared user service restart after self-update: $SERVICE_NAME"
    else
      systemctl --user enable --now "$SERVICE_NAME"
      sleep 2
      if ! systemctl --user --quiet is-active "$SERVICE_NAME"; then
        log "service failed to stay active: $SERVICE_NAME"
        systemctl --user --no-pager --full status "$SERVICE_NAME" >&2 || true
        journalctl --user -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
        fail "amesh-node user service did not reach active state"
      fi
      log "installed and started user service: $SERVICE_NAME"
      log "service logs: journalctl --user -u ${SERVICE_NAME} -f"
    fi
  else
    log "systemctl not found; service file written to $SERVICE_PATH"
    log "start manually: AMESH_ACPX_PATH='${ACPX_BIN}' '${binary_path}' run --state '${STATE_PATH}'"
  fi

  log "installed ${binary_path}"
  if [ -x "${cli_binary_path}" ]; then
    log "installed ${cli_binary_path}"
  fi
  log "managed acpx: ${ACPX_BIN}"
  log "state: ${STATE_PATH}"
}

if [[ "${BASH_SOURCE[0]-$0}" == "$0" ]]; then
  main "$@"
fi
