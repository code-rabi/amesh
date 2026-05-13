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
