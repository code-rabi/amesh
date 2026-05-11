# Local Development

## Toolchains

- Node.js `22.x`
- `pnpm` `11.x`
- Go `1.22+` for the node daemon

## Workspace commands

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm test
corepack pnpm typecheck
corepack pnpm --filter @amesh/server smoke
sh -n scripts/install-amesh-node.sh
```

## Notes

- The control plane stores SQLite data under `apps/server/data/`.
- The server can serve built dashboard assets directly from `apps/web/dist`, which is the deployment path used by the single-image Docker setup.
- The server enforces `AMESH_REGISTRATION_TOKEN` when set. In local development, leaving it unset keeps registration open; in deployed environments it should be set explicitly.
- The Go daemon expects an `agents.json` capabilities file for local agent definitions.
- A starter node config lives at `examples/agents.json` and uses real ACPX targets: `claude`, `codex`, and `openclaw`.
- The server websocket tests bind a local port, so restricted sandboxes may require escalation for that package-level verification.
- `corepack pnpm --filter @amesh/server smoke` runs a scripted local proof for node registration, direct chat, denied routing, and allowed cross-node routing using websocket-backed fake nodes.
- If the workspace host does not have `go` preinstalled, install or point to a local Go `1.22+` toolchain before running daemon tests.
- A real end-to-end local proof should verify registration, capability sync, initial chat, follow-up chat, and streamed output against a running control plane.
- `scripts/install-amesh-node.sh` is the intended remote bootstrap path for the daemon: it builds `amesh-node`, registers once if needed, writes a user-level systemd unit, and starts `run --state ...`.

## Local demo flow

1. Start the control plane:

```bash
corepack pnpm --filter @amesh/server dev
```

2. Start the dashboard in another shell:

```bash
corepack pnpm --filter @amesh/web dev
```

3. On a machine with Go installed, register a demo node against the server:

```bash
go run ./cmd/amesh-node register \
  --server ws://localhost:3001/ws?role=node \
  --token demo-token \
  --node-id node-a \
  --config examples/agents.json \
  --state .amesh-node-state.json
```

4. Run the long-lived daemon for that node:

```bash
go run ./cmd/amesh-node run \
  --state .amesh-node-state.json
```

5. Open the dashboard, confirm that `Claude`, `Codex`, and `OpenClaw` appear, create an allow rule, and start a chat session.

## Remote install

```bash
SERVER_URL=ws://your-server:3001/ws?role=node \
REGISTRATION_TOKEN=demo-token \
CONFIG_PATH=/path/to/agents.json \
scripts/install-amesh-node.sh
```

The script writes a durable state file after registration, so later restarts only need the saved state and the installed binary.
