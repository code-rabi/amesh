# Testing

## Current gates

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @amesh/server smoke`

## MVP coverage

- The shared protocol package has schema tests for the envelope and session start payload.
- The server owns integration tests for node registration, direct chat, continued chat via `session.input`, session cancel, and trigger allow or deny behavior over a real websocket port.
- The server also covers authenticated node update dispatch, including rejection for offline nodes.
- The server also covers invalid registration-token rejection, resume via durable reconnect token, trigger-rule deletion, and static dashboard serving from the control-plane deployable.
- The server smoke command exercises node registration, direct chat, denied routing, and allowed cross-node routing in one local flow.
- The web app owns UI coverage for topology rendering and session history recovery after refresh.
- The Go daemon owns table-driven tests for config loading, reconnect logic, update command dispatch, and `acpx` process lifecycle including streamed output and cancellation.
