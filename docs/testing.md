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
- `bash -n scripts/sentrux-check.sh`
- `sh -n install-amesh-node.sh`
- `sh -n scripts/install-amesh-node.sh`

`corepack pnpm check` is the root JavaScript gate and now includes the server smoke flow so local verification matches CI.

## MVP coverage

- The shared protocol package has schema tests for the envelope and session start payload.
- The server owns integration tests for node registration, direct chat, continued chat via `session.input`, session cancel, and trigger allow or deny behavior over a real websocket port.
- The server also covers authenticated node update dispatch, including rejection for offline nodes.
- The server also covers authenticated node detect dispatch, including rejection for offline nodes.
- The server also covers zero-agent node registration so a node still appears in topology before any local agent inventory is available.
- The server also covers invalid registration-token rejection, resume via durable reconnect token, trigger-rule deletion, and static dashboard serving from the control-plane deployable.
- The server smoke command exercises node registration, direct chat, denied routing, and allowed cross-node routing in one local flow.
- The GitHub Actions `CI` workflow runs the root JavaScript gate, the server smoke flow through that gate, Go tests, and shell syntax checks on pull requests and on pushes to `main`.
- The GitHub Actions `CI` workflow also publishes dedicated `Knip` and `Sentrux` jobs so unused-code and architecture-rule regressions show up as separate status checks.
- The web app owns UI coverage for topology rendering, session history recovery after refresh, and the dashboard `Detect agents` action.
- The Go daemon owns table-driven tests for config loading, reconnect logic, update and detect command dispatch, and `acpx` process lifecycle including streamed output and cancellation.
