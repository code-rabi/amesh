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
