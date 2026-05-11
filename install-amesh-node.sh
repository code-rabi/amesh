#!/usr/bin/env bash

set -euo pipefail

REPO="${AMESH_REPO:-code-rabi/amesh}"
INSTALL_DIR="${INSTALL_DIR:-}"
VERSION_TAG="${AMESH_VERSION_TAG:-}"
AMESH_HOME="${AMESH_HOME:-$HOME/.local/share/amesh}"
ACPX_PREFIX="${ACPX_PREFIX:-$AMESH_HOME/acpx}"
ACPX_NPM_SPEC="${ACPX_NPM_SPEC:-acpx@latest}"
CONFIG_PATH="${CONFIG_PATH:-$HOME/.config/amesh/agents.json}"
STATE_PATH="${STATE_PATH:-$HOME/.config/amesh/node-state.json}"
BINARY_PATH="${BINARY_PATH:-}"
ACPX_BIN="${ACPX_BIN:-$ACPX_PREFIX/bin/acpx}"
SERVICE_NAME="${SERVICE_NAME:-amesh-node}"
SERVICE_PATH="${SERVICE_PATH:-$HOME/.config/systemd/user/${SERVICE_NAME}.service}"
SERVER_URL="${SERVER_URL:-}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-}"
NODE_ID="${NODE_ID:-$(hostname)-amesh}"

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  log "error: $*"
  exit 1
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

need_cmd curl
need_cmd uname
need_cmd mktemp
need_cmd tar
need_cmd npm
need_cmd install
need_cmd mkdir

if [[ -z "$SERVER_URL" ]]; then
  fail "SERVER_URL is required"
fi

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
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

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
if [ "${os}" = "windows" ]; then
  binary_name="amesh-node.exe"
fi

[ -f "${extract_dir}/${binary_name}" ] || fail "archive did not contain ${binary_name}"
install -m 0755 "${extract_dir}/${binary_name}" "${binary_path}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
fi

if [[ ! -x "$ACPX_BIN" ]]; then
  log "installing managed acpx sidecar into ${ACPX_PREFIX}"
  npm install --global --prefix "$ACPX_PREFIX" "$ACPX_NPM_SPEC"
else
  log "managed acpx already present: ${ACPX_BIN}"
fi

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

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=amesh remote node daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=AMESH_ACPX_PATH=$ACPX_BIN
Environment=AMESH_NODE_VERSION=$tag
ExecStart=$binary_path run --state $STATE_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
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
else
  log "systemctl not found; service file written to $SERVICE_PATH"
  log "start manually: AMESH_ACPX_PATH='${ACPX_BIN}' '${binary_path}' run --state '${STATE_PATH}'"
fi

log "installed ${binary_path}"
log "managed acpx: ${ACPX_BIN}"
log "state: ${STATE_PATH}"
