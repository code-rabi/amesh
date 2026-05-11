# Local Development

## Toolchains

- Node.js `22.x`
- `pnpm` `11.x`
- Go `1.22+` for the node daemon

## Workspace commands

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm dev:daemon
corepack pnpm test
corepack pnpm typecheck
corepack pnpm --filter @amesh/server smoke
corepack pnpm check:knip
corepack pnpm check:sentrux
bash -n scripts/dev-daemon.sh
bash -n scripts/sentrux-check.sh
sh -n install-amesh-node.sh
sh -n scripts/install-amesh-node.sh
```

## Notes

- The control plane stores SQLite data under `apps/server/data/`.
- `corepack pnpm dev` starts both the control-plane server and the web app from the repo root.
- Example env files live at `apps/server/.env.example` and `apps/web/.env.example`. Copy them to `apps/server/.env` and `apps/web/.env` when you want package-local settings.
- In local development, the Vite app proxies `/api` and `/ws` to the control plane on `localhost:3001`, so the browser should be opened on the Vite origin instead of calling the server origin directly.
- The server can serve built dashboard assets directly from `apps/web/dist`, which is the deployment path used by the single-image Docker setup.
- Browser access now uses an admin password plus an HTTP-only session cookie. Set `AUTH_ADMIN_PASSWORD` for a stable local password; if it is missing, the server generates a one-process UUID password and writes it to the server log at startup.
- Set `AUTH_SESSION_SECRET` if you want browser sessions to survive a server restart. If it is missing, the server generates a random in-memory secret and all cookies are invalidated on restart.
- The server enforces `AMESH_REGISTRATION_TOKEN` when set. In local development, leaving it unset keeps registration open; in deployed environments it should be set explicitly.
- The Go daemon expects an `agents.json`-shaped capabilities file for local agent definitions, but `amesh-node detect --config <path>` can generate that file from live ACPX probing.
- Detection records locally installed ACPX-backed agent CLIs even if a given provider is slow to start or temporarily unhealthy; live topology health is still decided by the separate daemon-side ACPX health probe loop.
- `corepack pnpm dev:daemon` installs a managed ACPX sidecar under `~/.local/share/amesh/acpx` if needed, writes `.amesh-agents.json` by detection on first run, saves `.amesh-node-state.json`, and then starts the long-lived daemon process against that generated config.
- The daemon now keeps running when the control plane goes away. It retries websocket connect, `node.resume`, and capability sync with backoff until the server returns.
- Agent topology status is derived from daemon-side ACPX health probes, not just from the node websocket being connected. Unhealthy local agents are omitted from capability sync and appear offline in the control plane.
- The dashboard can send a `Detect agents` action to an online node. The daemon rewrites its config from live detection and immediately re-syncs capabilities back to the control plane.
- The server smoke script authenticates through `/api/auth/login` before it exercises operator APIs, so local smoke usage matches production browser auth instead of relying on anonymous access.
- `corepack pnpm check:knip` runs unused dependency and export checks against the TypeScript workspaces only; it intentionally ignores repo-local agent skill folders and the Go tree.
- `corepack pnpm check:sentrux` installs a pinned user-space `sentrux` binary under `.tools/` on first run and enforces the repo rules from `.sentrux/rules.toml`.
- `install-amesh-node.sh` downloads the released `amesh-node` binary for the current platform, installs a managed ACPX sidecar under `~/.local/share/amesh/acpx`, and exports `AMESH_ACPX_PATH` for the service.
- ACP aliases for external clients can be served locally with `go run ./cmd/amesh acp <alias>`. The default alias registry is `~/.config/amesh/acp.json`:

```json
{
  "aliases": {
    "mesh-reviewer": {
      "serverUrl": "http://127.0.0.1:3001",
      "agentId": "agent-codex",
      "passwordEnv": "AMESH_PASSWORD"
    }
  }
}
```

- An `acpx` alias can then point at `amesh acp mesh-reviewer`, letting OpenClaw or another ACP client treat the mesh-exported agent like any other local harness id.
- Remote node install no longer requires `go`; it still requires `curl`, `tar`, `npm`, and the actual local agent CLIs you want ACPX to call.
- The server websocket tests bind a local port, so restricted sandboxes may require escalation for that package-level verification.
- `corepack pnpm --filter @amesh/server smoke` runs a scripted local proof for node registration, direct chat, denied routing, and allowed cross-node routing using websocket-backed fake nodes.
- If the workspace host does not have `go` preinstalled, install or point to a local Go `1.22+` toolchain before running daemon tests.
- A real end-to-end local proof should verify registration, capability sync, initial chat, follow-up chat, and streamed output against a running control plane.
- `scripts/install-amesh-node.sh` is the intended remote bootstrap path for the daemon: it builds `amesh-node`, registers once if needed, writes a user-level systemd unit, and starts `run --state ...`.

## Local demo flow

1. Start the control plane and web app:

```bash
corepack pnpm dev
```

2. In another shell, start the demo daemon:

```bash
corepack pnpm dev:daemon
```

3. If you want the manual flow instead, use quoted websocket URLs so zsh does not glob on `?`:

```bash
go run ./cmd/amesh-node detect --config .amesh-agents.json

go run ./cmd/amesh-node register \
  --server 'ws://localhost:3001/ws?role=node' \
  --token demo-token \
  --node-id node-a \
  --config .amesh-agents.json \
  --state .amesh-node-state.json

go run ./cmd/amesh-node run \
  --state .amesh-node-state.json
```

4. Open the dashboard, use `Detect agents` if you want to force a refresh on the running node, then create an allow rule and start a chat session against any detected online agent.

## Remote install

```bash
curl -fsSL https://raw.githubusercontent.com/code-rabi/amesh/main/install-amesh-node.sh \
  | SERVER_URL='ws://your-server:3001/ws?role=node' \
    REGISTRATION_TOKEN='demo-token' \
    CONFIG_PATH='/path/to/agents.json' \
    bash
```

The installer writes a durable state file after registration, installs a managed `acpx` sidecar, and later restarts only need the saved state and the installed binary.

## Remote update

```bash
amesh-node update
```

Authenticated admins can also trigger the same node-side updater from the dashboard. The control plane sends a `node.update` command over the existing node websocket, the daemon runs `amesh-node update`, and a managed systemd service should restart back into the new binary after the process exits.
- The dashboard only shows the update action when the node reports an installed release tag and that tag differs from the control plane's latest known GitHub release tag.
