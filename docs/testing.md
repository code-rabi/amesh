# Testing

## Current gates

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @amesh/server smoke`
- `pnpm check:knip`
- `pnpm check:sentrux`
- `go test ./...`
- `bash -n scripts/dev-daemon.sh`
- `bash scripts/test-dev-daemon.sh`
- `bash -n scripts/sentrux-check.sh`
- `bash scripts/test-install-amesh-node.sh`
- `sh -n install-amesh-node.sh`
- `sh -n scripts/install-amesh-node.sh`

`corepack pnpm check` is the root JavaScript gate and now includes the server smoke flow so local verification matches CI.

## MVP coverage

- The shared protocol package has schema tests for the envelope and session start payload.
- The server owns integration tests for node registration, direct chat, continued chat via `session.input`, session cancel, and trigger allow or deny behavior over a real websocket port.
- The server also covers HTTP MCP initialize, tool discovery, scoped reachable-agent listing, and scoped agent-started sessions over the real `/mcp` endpoint.
- The server also covers authenticated node update dispatch, including rejection for offline nodes.
- The server also covers authenticated node detect dispatch, including rejection for offline nodes.
- The server also covers zero-agent node registration so a node still appears in topology before any local agent inventory is available.
- The server also covers authenticated exposed-path updates, including rejection for offline nodes.
- The server also covers zero-agent node registration so a node still appears in topology before any local agent inventory is available.
- The server also covers invalid registration-token rejection, resume via durable reconnect token, trigger-rule deletion, and static dashboard serving from the control-plane deployable.
- The server also covers resolving its default SQLite path independently of `process.cwd()`, which protects Docker deployments that start the server from the package directory.
- The server smoke command exercises node registration, direct chat, denied routing, and allowed cross-node routing in one local flow.
- The GitHub Actions `CI` workflow runs the root JavaScript gate, the server smoke flow through that gate, Go tests, and shell syntax checks on pull requests and on pushes to `main`.
- `scripts/test-install-amesh-node.sh` covers the installer's Node major parsing failure path and also executes the installer through stdin so the published `curl | bash` bootstrap shape stays working under `set -u`.
- The GitHub Actions `CI` workflow also publishes dedicated `Knip` and `Sentrux` jobs so unused-code and architecture-rule regressions show up as separate status checks.
- The web app owns UI coverage for topology rendering, session history recovery after refresh, and the dashboard `Detect agents`, `Update node`, and exposed-path actions.
- The web app also covers the top-bar MCP config panel so the copy-paste client snippets stay aligned with the server endpoint and scope headers.
- The Go daemon owns table-driven tests for config loading, reconnect logic, update, detect, exposed-path command dispatch, and `acpx` process lifecycle including streamed output and cancellation.
- The dev helper script also has a regression shell test for the stale local reconnect-token path, so local `pnpm dev:daemon` re-registers automatically after a fresh control-plane reset.
- The Go daemon also covers the shared `reinstall` subcommand and verifies that reinstall mode passes the destructive reset flag through to the installer.
- `scripts/test-install-amesh-node.sh` also covers remote self-update and full reinstall flows, including reinstall-time cleanup of stale node state, config, service, binaries, and managed amesh home.
