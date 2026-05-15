#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/install-amesh-node.sh"

assert_contains() {
  needle="$1"
  path="$2"
  if ! grep -F "$needle" "$path" >/dev/null 2>&1; then
    printf 'expected %s to contain %s\n' "$path" "$needle" >&2
    exit 1
  fi
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

require_node_major 22

fake_bin_dir="$tmp_dir/bin"
mkdir -p "$fake_bin_dir"

cat <<'EOF' >"$fake_bin_dir/node"
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -v)
    printf 'v24.13.1\n'
    ;;
  -p)
    printf 'twenty-four\n'
    ;;
  *)
    printf 'unexpected fake node invocation: %s\n' "$*" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$fake_bin_dir/node"

stderr_path="$tmp_dir/stderr.log"
if PATH="$fake_bin_dir:$PATH" bash -lc "source '$ROOT_DIR/install-amesh-node.sh'; require_node_major 22" \
  >"$tmp_dir/stdout.log" 2>"$stderr_path"; then
  printf 'expected invalid fake node version parsing to fail\n' >&2
  exit 1
fi

assert_contains "could not determine Node.js major version" "$stderr_path"
assert_contains "$fake_bin_dir/node" "$stderr_path"

stdin_stub_dir="$tmp_dir/stdin-stub-bin"
mkdir -p "$stdin_stub_dir"

for cmd in curl npm systemctl; do
  cat <<'EOF' >"$stdin_stub_dir/$cmd"
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
  chmod +x "$stdin_stub_dir/$cmd"
done

cat <<'EOF' >"$stdin_stub_dir/uname"
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -m)
    printf 'x86_64\n'
    ;;
  *)
    printf 'Linux\n'
    ;;
esac
EOF
chmod +x "$stdin_stub_dir/uname"

cat <<'EOF' >"$stdin_stub_dir/mktemp"
#!/usr/bin/env bash
set -euo pipefail
dir="${TMPDIR:-/tmp}/amesh-test-stdin"
mkdir -p "$dir"
printf '%s\n' "$dir"
EOF
chmod +x "$stdin_stub_dir/mktemp"

cat <<'EOF' >"$stdin_stub_dir/tar"
#!/usr/bin/env bash
set -euo pipefail
target_dir=
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C)
      target_dir="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$target_dir"
cat <<'BIN' >"$target_dir/amesh-node"
#!/usr/bin/env bash
set -euo pipefail
exit 0
BIN
chmod +x "$target_dir/amesh-node"
cat <<'BIN' >"$target_dir/amesh"
#!/usr/bin/env bash
set -euo pipefail
exit 0
BIN
chmod +x "$target_dir/amesh"
EOF
chmod +x "$stdin_stub_dir/tar"

cat <<'EOF' >"$stdin_stub_dir/install"
#!/usr/bin/env bash
set -euo pipefail
src="${@: -2:1}"
dest="${@: -1}"
cp "$src" "$dest"
chmod 0755 "$dest"
EOF
chmod +x "$stdin_stub_dir/install"

cat <<'EOF' >"$stdin_stub_dir/node"
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -v)
    printf 'v24.13.1\n'
    ;;
  -p)
    printf '24\n'
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$stdin_stub_dir/node"

stdin_env_dir="$tmp_dir/stdin-env"
stdin_space_dir="$tmp_dir/stdin path with spaces"
mkdir -p "$stdin_env_dir"
mkdir -p "$stdin_space_dir"
printf '{}\n' >"$stdin_env_dir/agents.json"
printf '{}\n' >"$stdin_env_dir/node-state.json"

stdin_log="$tmp_dir/stdin.log"
if ! PATH="$stdin_stub_dir:$stdin_space_dir:$PATH" \
  AMESH_VERSION_TAG='test-tag' \
  INSTALL_DIR="$stdin_env_dir/bin" \
  AMESH_HOME="$stdin_env_dir/home" \
  ACPX_PREFIX="$stdin_env_dir/acpx" \
  ACPX_CONFIG_PATH="$stdin_env_dir/acpx-config.json" \
  CONFIG_PATH="$stdin_env_dir/agents.json" \
  STATE_PATH="$stdin_env_dir/node-state.json" \
  SERVICE_PATH="$stdin_env_dir/amesh-node.service" \
  NODE_ID='stdin-test-node' \
  SERVER_URL='wss://example.invalid/ws?role=node' \
  REGISTRATION_TOKEN='token' \
  bash <"$ROOT_DIR/install-amesh-node.sh" >"$stdin_log" 2>&1; then
  printf 'expected stdin installer execution to succeed\n' >&2
  cat "$stdin_log" >&2
  exit 1
fi

assert_contains 'Environment="AMESH_ACPX_PATH=' "$stdin_env_dir/amesh-node.service"
assert_contains 'Environment="AMESH_NODE_VERSION=test-tag"' "$stdin_env_dir/amesh-node.service"
assert_contains "$stdin_space_dir" "$stdin_env_dir/amesh-node.service"
test -x "$stdin_env_dir/bin/amesh"

self_stub_dir="$tmp_dir/self-update-bin"
mkdir -p "$self_stub_dir"

cat <<'EOF' >"$self_stub_dir/curl"
#!/usr/bin/env bash
set -euo pipefail
archive="${@: -1}"
printf 'stub archive' >"$archive"
EOF
chmod +x "$self_stub_dir/curl"

cat <<'EOF' >"$self_stub_dir/npm"
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
chmod +x "$self_stub_dir/npm"

cat <<'EOF' >"$self_stub_dir/systemctl"
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${SYSTEMCTL_LOG:?}"
verb=
for arg in "$@"; do
  case "$arg" in
    --user|--now|--quiet|--no-pager|--full)
      continue
      ;;
    *)
      verb="$arg"
      break
      ;;
  esac
done
case "$verb" in
  daemon-reload|enable)
    exit 0
    ;;
  *)
    exit 99
    ;;
esac
EOF
chmod +x "$self_stub_dir/systemctl"

cat <<'EOF' >"$self_stub_dir/uname"
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -m)
    printf 'x86_64\n'
    ;;
  *)
    printf 'Linux\n'
    ;;
esac
EOF
chmod +x "$self_stub_dir/uname"

cat <<'EOF' >"$self_stub_dir/mktemp"
#!/usr/bin/env bash
set -euo pipefail
dir="${TMPDIR:-/tmp}/amesh-test-self-update"
mkdir -p "$dir"
printf '%s\n' "$dir"
EOF
chmod +x "$self_stub_dir/mktemp"

cat <<'EOF' >"$self_stub_dir/tar"
#!/usr/bin/env bash
set -euo pipefail
target_dir=
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C)
      target_dir="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$target_dir"
cat <<'BIN' >"$target_dir/amesh-node"
#!/usr/bin/env bash
set -euo pipefail
exit 0
BIN
chmod +x "$target_dir/amesh-node"
EOF
chmod +x "$self_stub_dir/tar"

cat <<'EOF' >"$self_stub_dir/install"
#!/usr/bin/env bash
set -euo pipefail
src="${@: -2:1}"
dest="${@: -1}"
cp "$src" "$dest"
chmod 0755 "$dest"
EOF
chmod +x "$self_stub_dir/install"

cat <<'EOF' >"$self_stub_dir/node"
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -v)
    printf 'v24.13.1\n'
    ;;
  -p)
    printf '24\n'
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$self_stub_dir/node"

self_env_dir="$tmp_dir/self-update-env"
mkdir -p "$self_env_dir"
printf '{}\n' >"$self_env_dir/agents.json"
printf '{"nodeId":"node-a","reconnectToken":"token","serverUrl":"ws://saved.invalid/ws?role=node","configPath":"%s"}\n' "$self_env_dir/agents.json" >"$self_env_dir/node-state.json"

self_systemctl_log="$tmp_dir/self-update-systemctl.log"
self_log="$tmp_dir/self-update.log"
if ! PATH="$self_stub_dir:$PATH" \
  SYSTEMCTL_LOG="$self_systemctl_log" \
  AMESH_NODE_SELF_UPDATE='1' \
  AMESH_VERSION_TAG='test-tag' \
  INSTALL_DIR="$self_env_dir/bin" \
  AMESH_HOME="$self_env_dir/home" \
  ACPX_PREFIX="$self_env_dir/acpx" \
  ACPX_CONFIG_PATH="$self_env_dir/acpx-config.json" \
  CONFIG_PATH="$self_env_dir/agents.json" \
  STATE_PATH="$self_env_dir/node-state.json" \
  SERVICE_PATH="$self_env_dir/amesh-node.service" \
  NODE_ID='self-update-node' \
  bash <"$ROOT_DIR/install-amesh-node.sh" >"$self_log" 2>&1; then
  printf 'expected self-update installer execution without SERVER_URL to succeed\n' >&2
  cat "$self_log" >&2
  exit 1
fi

assert_contains 'daemon-reload' "$self_systemctl_log"
assert_contains 'enable amesh-node' "$self_systemctl_log"
if grep -F 'stop amesh-node' "$self_systemctl_log" >/dev/null 2>&1; then
  printf 'self-update must not stop its own service\n' >&2
  cat "$self_systemctl_log" >&2
  exit 1
fi
