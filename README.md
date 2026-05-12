# amesh

`amesh` is a control plane for running ACP-compatible agents across multiple machines.

The MVP focuses on three things:

1. Register remote nodes with a central server over WebSocket.
2. Attach one or more ACP-backed agents to each node.
3. Let users chat with any agent in a web UI and define which agents may trigger other agents across nodes.

Initial product and architecture details live in [docs/design/mvp-design.md](/home/nitayr/projects/amesh/docs/design/mvp-design.md).

## Workspace

- `apps/server`: Fastify control plane, SQLite persistence, HTTP APIs, and websocket routing
- `apps/web`: Vite + React operator dashboard for topology, trigger rules, and chat
- `packages/protocol`: shared runtime schemas and envelope contracts
- `cmd/amesh-node` and `internal/*`: Go node daemon scaffold for register or run flows and local `acpx` execution against example `claude`, `codex`, and `openclaw` targets

## Deployment

- The control plane and dashboard are designed to ship as one deployable.
- The root [Dockerfile](/home/nitayr/projects/amesh/Dockerfile) builds the web assets and serves them from the Fastify server process.
- The remote node remains a separate daemon installed on target machines.
- The node installer manages an internal ACPX sidecar so remote hosts do not need a separate global `acpx` install.
- Remote node install does not require `go`, but it does require `node` `22.x`, `npm`, `curl`, and `tar`.
- That `node` requirement is runtime-critical, not just an installer detail: many ACPX-backed agent CLIs are Node programs, so the daemon must later see the same `PATH` and Node runtime that made those CLIs work during registration.

Install the remote node with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/code-rabi/amesh/main/install-amesh-node.sh \
  | SERVER_URL='ws://your-server:3001/ws?role=node' \
    REGISTRATION_TOKEN='demo-token' \
    bash
```

## Local commands

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
```
