# amesh MVP Design

## Summary

`amesh` is a distributed control plane for ACP-compatible coding agents. A central server maintains node registration, agent inventory, routing policy, chat sessions, and live event streams. Remote node daemons connect to the server over WebSocket, advertise locally available agents, and execute ACP traffic against those agents. The web UI lets an operator chat with any registered agent and define which agents may trigger other agents.

This is inspired by `acp-ui`'s multi-agent ACP client model and remote WebSocket connectivity, but `amesh` is opinionated around orchestration across machines rather than acting primarily as a standalone ACP client. It should also remain easy to wrap inside a future `zero-native` shell by serving the frontend as static SPA assets.

## Product Goals

1. Register machines as nodes with a single bootstrap command.
2. Register multiple ACP-backed agents per node.
3. Let operators chat with any agent from a browser.
4. Allow one agent to invoke another agent, including across nodes.
5. Keep the runtime generic enough to support Claude, Codex, OpenClaw, Hermes, and any ACP-compatible agent command.

## Non-Goals For MVP

1. Multi-tenant auth and RBAC.
2. Complex scheduling, quotas, or load balancing.
3. End-to-end encrypted message relaying.
4. Durable workflow automation beyond direct agent-to-agent triggers.
5. Native desktop packaging.

## Architecture

### 1. Control Plane Server

Responsibilities:

- hosts the HTTP API and the web UI
- accepts persistent WebSocket connections from nodes and browsers
- stores nodes, agents, trigger rules, sessions, and message events
- validates whether agent A may invoke agent B
- routes chat and trigger traffic between connected nodes
- records enough event history to restore UI state and debug failures

Suggested stack:

- Node.js + TypeScript
- Fastify for HTTP APIs
- `ws` for WebSocket transport
- Drizzle ORM + SQLite for MVP persistence

Why this stack:

- Fastify keeps the control plane small and explicit.
- Native WebSocket semantics are a better fit than Socket.IO if nodes are long-lived infrastructure processes.
- SQLite keeps the first deployment simple while still allowing a clean later move to Postgres.

### 2. Node Daemon

Responsibilities:

- runs on any remote machine
- registers itself with the control plane using a bootstrap token or one-time registration secret
- maintains a persistent WebSocket connection
- advertises available local agents
- launches and manages ACP-compatible agents through configured commands
- forwards ACP requests and responses between the control plane and local agents

Suggested stack:

- Go
- `github.com/coder/websocket` or equivalent minimal WebSocket client
- local process management via `os/exec`
- `acpx` as the preferred external ACP adapter CLI

Why Go:

- a single static binary is a much better fit for remote node deployment than a Node runtime plus dependencies
- process supervision, reconnect logic, and long-lived socket handling are straightforward
- cross-compilation is simple, which matters if nodes run on mixed Linux hosts

Why keep `acpx`, but out of process:

- it already provides ACP-compatible agent access for Codex, Claude, OpenClaw, and others
- the daemon can invoke `acpx` as a subprocess and normalize its streamed output instead of embedding a JavaScript runtime
- this keeps the node runtime small while isolating upstream `acpx` changes behind one adapter boundary

### 3. Web UI

Responsibilities:

- list nodes and agent health
- create or inspect trigger edges between agents
- open direct chat sessions with any agent
- stream session events live
- inspect routed cross-agent invocations

Suggested stack:

- React + TypeScript
- Vite
- TanStack Router + TanStack Query
- native browser WebSocket client

Why this stack:

- the SPA output can later be served directly by `zero-native` using a static asset root
- there is no early dependency on Next.js server rendering
- TanStack keeps routing and async state explicit without locking the product to a hosted framework

## Core Domain Model

### Node

- `id`
- `name`
- `status` (`pending`, `online`, `offline`)
- `host`
- `labels`
- `last_seen_at`
- `registered_at`

### Agent

- `id`
- `node_id`
- `name`
- `provider` (`claude`, `codex`, `openclaw`, `hermes`, `custom`)
- `command`
- `args`
- `status` (`online`, `offline`, `error`)
- `capabilities` (JSON)

### Trigger Rule

- `id`
- `source_agent_id`
- `target_agent_id`
- `mode` (`allow`, `deny`)

The MVP should default to deny unless an explicit allow edge exists.

### Session

- `id`
- `entry_agent_id`
- `initiator` (`user`, `agent`)
- `status`
- `created_at`

### Session Event

- `id`
- `session_id`
- `event_type`
- `source_agent_id`
- `target_agent_id`
- `payload`
- `created_at`

## Communication Model

Two logical channels exist over WebSocket:

1. Control messages
   - register node
   - heartbeat
   - advertise agent inventory
   - update agent status
2. Session messages
   - start session
   - append user prompt
   - stream agent events
   - invoke downstream agent
   - return downstream result

All frames should use a shared envelope:

```json
{
  "type": "session.event",
  "requestId": "req_123",
  "sessionId": "ses_123",
  "source": "server",
  "target": "node_abc",
  "payload": {}
}
```

## MVP Flows

### Node Registration

1. Operator runs a single command on the remote machine.
2. Node daemon starts with a server URL and registration secret.
3. Daemon opens a WebSocket to the control plane.
4. Server validates the secret and creates the node record.
5. Daemon advertises installed agent definitions.
6. Server marks the node online and pushes the state to connected UIs.

Bootstrap UX target:

```bash
npx amesh-node register \
  --server https://amesh.example.com \
  --token <registration-token>
```

### Direct Chat

1. User opens the dashboard and selects an agent.
2. UI creates a session through the control plane.
3. Server routes the prompt to the node hosting that agent.
4. Node executes the request against the local ACP agent by spawning `acpx`.
5. Streamed ACP output is normalized into session events and pushed back to the UI.

### Cross-Agent Trigger

1. Agent A emits a structured request to invoke Agent B.
2. The node forwards that request to the control plane.
3. The control plane checks for an allow rule from Agent A to Agent B.
4. If allowed, the server creates a child session or routed invocation record.
5. The target node executes Agent B locally.
6. The target node streams results back through the server to Agent A and to the UI.

## Security Model For MVP

- Node registration uses a server-issued token.
- Each node gets a durable node ID and reconnect credential after registration.
- Browser users are treated as a single trusted operator for MVP.
- Trigger rules are enforced on the server, not only on nodes.
- Nodes may execute only their locally declared agent commands.

## Delivery Shape

Recommended monorepo layout:

```text
apps/
  server/
  web/
packages/
  protocol/
  node-daemon-go/
  agent-runtime/
docs/
  design/
```

## Key Technical Decisions

### Use a Central Broker

The server should broker every cross-node trigger instead of allowing direct node-to-node links. That gives one place for policy enforcement, observability, session lineage, and UI replay.

### Use WebSocket As The Long-Lived Transport

The nodes are infrastructure processes, not short-lived CLI calls. Persistent WebSockets allow heartbeats, presence, and streaming ACP traffic without polling.

### Normalize ACP Events

Different agents expose different event shapes. The node daemon should map `acpx` CLI output or other local ACP output into a stable internal event model before sending it to the server. That keeps the UI and routing logic provider-agnostic.

### Prefer SPA Assets Over Framework-Coupled SSR

The future `zero-native` target expects a local asset tree or URL. A Vite-built SPA is the least constraining option for that path.

## Risks

1. ACP event models differ enough that normalization may need provider-specific adapters.
2. `acpx` is still early, so version pinning and subprocess adapter isolation matter.
3. Agent-to-agent invocation semantics need a strict schema, or routing becomes hard to reason about.
4. SQLite is acceptable for MVP but not for high-volume event retention.

## Open Questions

1. Should cross-agent invocation be represented as a nested child session or as a step inside one parent session?
2. Do we want the first bootstrap token to be single-use or reusable per environment?
3. Should the UI expose raw ACP traffic from day one, or only normalized chat events?
4. Do we want agent definitions to be fully managed in the UI, or initially declared only on the node?
5. Should the Go daemon require `acpx` preinstalled, or should it manage downloading a pinned compatible binary?

## MVP Acceptance Criteria

1. A fresh machine can register as a node with one command.
2. A node can advertise at least two local ACP-backed agents.
3. The dashboard shows online nodes and their agents in real time.
4. A user can start and continue a chat session with any registered agent.
5. A configured allow edge lets one agent trigger another agent on a different node.
6. A denied edge blocks the invocation and produces a visible audit event.
