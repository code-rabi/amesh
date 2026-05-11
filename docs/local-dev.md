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
bash -n scripts/dev-daemon.sh
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
- The Go daemon expects an `agents.json` capabilities file for local agent definitions.
- A starter node config lives at `examples/agents.json` and uses real ACPX targets: `claude`, `codex`, and `openclaw`.
- `corepack pnpm dev:daemon` installs a managed ACPX sidecar under `~/.local/share/amesh/acpx` if needed, registers `node-a` on first run, saves `.amesh-node-state.json`, and then starts the long-lived daemon process against `examples/agents.json`.
- `install-amesh-node.sh` downloads the released `amesh-node` binary for the current platform, installs a managed ACPX sidecar under `~/.local/share/amesh/acpx`, and exports `AMESH_ACPX_PATH` for the service.
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
go run ./cmd/amesh-node register \
  --server 'ws://localhost:3001/ws?role=node' \
  --token demo-token \
  --node-id node-a \
  --config examples/agents.json \
  --state .amesh-node-state.json

go run ./cmd/amesh-node run \
  --state .amesh-node-state.json
```

4. Open the dashboard, confirm that `Claude`, `Codex`, and `OpenClaw` appear, create an allow rule, and start a chat session.

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
