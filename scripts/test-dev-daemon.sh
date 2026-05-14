#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mockbin="$tmpdir/mockbin"
mkdir -p "$mockbin"

cat >"$mockbin/go" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log_file="${TEST_LOG_FILE:?}"
state_path="${TEST_STATE_PATH:?}"
config_path="${TEST_CONFIG_PATH:?}"
counter_path="${TEST_RUN_COUNTER:?}"

printf '%s\n' "$*" >>"$log_file"

case "$*" in
  *"./cmd/amesh-node detect"* )
    cat >"$config_path" <<'JSON'
{"nodeName":"lab","paths":[],"agents":[]}
JSON
    ;;
  *"./cmd/amesh-node register"* )
    cat >"$state_path" <<JSON
{"nodeId":"node-a","reconnectToken":"fresh-token","serverUrl":"ws://localhost:3001/ws?role=node","configPath":"$config_path"}
JSON
    ;;
  *"./cmd/amesh-node run"* )
    count=0
    if [[ -f "$counter_path" ]]; then
      count="$(cat "$counter_path")"
    fi
    count=$((count + 1))
    printf '%s' "$count" >"$counter_path"
    if [[ "$count" -eq 1 ]]; then
      echo "amesh-node 2026-05-14T19:43:54Z session connected node=node-a" >&2
      echo "2026/05/14 21:43:54 resume denied: invalid_reconnect_token" >&2
      exit 1
    fi
    echo "amesh-node recovered" >&2
    ;;
esac
EOF
chmod +x "$mockbin/go"

cat >"$tmpdir/state.json" <<'JSON'
{"nodeId":"node-a","reconnectToken":"stale-token","serverUrl":"ws://localhost:3001/ws?role=node","configPath":".amesh-agents.json"}
JSON

touch "$tmpdir/acpx"
chmod +x "$tmpdir/acpx"

TEST_LOG_FILE="$tmpdir/go.log" \
TEST_STATE_PATH="$tmpdir/state.json" \
TEST_CONFIG_PATH="$tmpdir/config.json" \
TEST_RUN_COUNTER="$tmpdir/run-count" \
PATH="$mockbin:$PATH" \
CONFIG_PATH="$tmpdir/config.json" \
STATE_PATH="$tmpdir/state.json" \
AMESH_ACPX_PATH="$tmpdir/acpx" \
REGISTRATION_TOKEN="demo-token" \
NODE_ID="node-a" \
SERVER_URL="ws://localhost:3001/ws?role=node" \
bash "$repo_root/scripts/dev-daemon.sh"

grep -q "./cmd/amesh-node register" "$tmpdir/go.log"
grep -q "./cmd/amesh-node run --state $tmpdir/state.json" "$tmpdir/go.log"
if [[ "$(cat "$tmpdir/run-count")" != "2" ]]; then
  echo "expected dev daemon to retry run after stale reconnect token" >&2
  exit 1
fi

python_state="$(cat "$tmpdir/state.json")"
case "$python_state" in
  *'"reconnectToken":"fresh-token"'* ) ;;
  * )
    echo "expected re-register to replace stale reconnect token" >&2
    exit 1
    ;;
esac

echo "dev-daemon stale reconnect recovery passed"
