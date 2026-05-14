# MCP agent registration

## Decision

- `amesh` will treat MCP as the inbound orchestration surface for now.
- MCP entries register logical agents in `amesh`.
- Agent roles are properties on one agent record:
  - `orchestrator`: the agent can call `amesh`
  - `controlled`: `amesh` can send work to the agent through a node-backed ACP adapter
- A node remains the durable runtime boundary for controlled agents.
- Automatic local ACP discovery is removed from the default bootstrap path. Detection can return later as an explicit node action.

## Identity

- A logical agent is not keyed by transport alone.
- MCP and ACP endpoints may map to the same logical agent when they refer to the same runnable agent identity on the same node.
- Two MCP installs on the same node are still different logical agents when the host agent identity differs.
  - Example: the same `npx` command configured in Claude and Codex on one machine produces two agents on the same node.
- The canonical identity should include:
  - `nodeId` when a node exists
  - `hostKind`: `codex`, `claude`, `gemini`, `custom`
  - `executionName` when known: `codex`, `claude`, etc.
  - optional fingerprint for future hardening when config origin or executable path is available

## Registration rules

- `MCP URL`
  - register the agent as `orchestrator=true`
  - register the agent as `controlled=false`
  - leave `nodeId=null`
  - treat it as an external orchestrator that can talk to `amesh` but cannot be called back by `amesh`
- `MCP NPX`
  - register the agent as `orchestrator=true`
  - attempt to attach to or establish a durable local node service
  - if node attach succeeds and the execution is ACP-compatible, mark the same logical agent as `controlled=true`
  - if node attach fails, keep the agent as orchestrator-only instead of failing the MCP integration

## Control model

- MCP is the user-facing entrypoint.
- The durable node runtime remains an implementation detail behind MCP.
- The current Go daemon can stay behind that MCP entrypoint until there is a reason to replace it.
- `npx` launch does not imply controllability by itself.
- Control is granted only after successful node binding and ACP viability.

## MCP tools

- The MCP server should expose explicit tools even if it also performs a best-effort implicit registration flow.
- Initial tools:
  - `register_self`
  - `ensure_node`
  - `status`
  - `delegate`
- Implicit behavior is allowed for the happy path, but explicit tools remain the stable contract because host MCP environments do not expose identical metadata.

## Data model impact

- Nodes stay as first-class records.
- Agents need role fields instead of being treated as only ACP-backed node capabilities.
- A workable direction is:
  - `orchestrator` boolean
  - `controlled` boolean
  - nullable `nodeId`
  - identity fields for `hostKind` and `executionName`
- Transport-specific details should move out of the top-level agent identity and into endpoint metadata.
- An agent may have multiple endpoints over time:
  - `mcp-url`
  - `mcp-npx`
  - `acp`

## UI impact

- The UI should show one logical agent card with role badges or capability indicators.
- Do not split the same logical identity into separate "MCP agent" and "ACP agent" rows.
- A node page can show:
  - controlled agents bound to that node
  - orchestrator-capable agents bound to that node
- Agents without a node still appear in the global topology as orchestrator-only.

## Server impact

- The control plane needs an MCP registration handshake in addition to the current node websocket handshake.
- Registration logic must resolve whether an MCP caller:
  - creates a new orchestrator-only agent
  - upgrades an existing logical agent to `controlled=true`
  - binds to an existing node
- Session routing rules stay unchanged at the core:
  - inbound delegation comes from orchestrator-capable agents
  - outbound execution to a local agent still routes through a node and ACP

## Node and daemon impact

- Removing automatic discovery simplifies bootstrap:
  - the node no longer needs to scan the machine by default
  - controlled agents are registered intentionally through MCP-driven flows
- The durable runtime still has to keep:
  - reconnect token and node identity
  - websocket session
  - ACP execution path
  - health checks for controlled agents
  - path exposure and session `cwd` handling
- The current Go daemon can remain responsible for that without being user-visible.

## Protocol impact

- `@amesh/protocol` currently models agents as node-backed ACP capabilities.
- That shape needs to expand so agents can exist without a node and can carry independent role flags.
- Capability sync from nodes should update only the controlled side of an agent.
- MCP registration should update the orchestrator side of an agent.

## Risk

- Identity matching will drift if it relies only on display names.
- MCP host metadata is inconsistent across clients, so implicit matching must remain best-effort.
- Merging node-controlled and MCP-orchestrating views into one logical agent is correct for the UI, but it requires a stricter server-side identity model than the current `agent.id` equals node capability id approach.
- Keeping fallback behavior matters:
  - an `npx` MCP should still work as orchestrator-only when node establishment fails

## Result

- `amesh` gains a single user-facing MCP entrypoint without forcing every MCP-integrated agent to be controllable.
- URL-based MCP integrations become first-class orchestrators without nodes.
- `npx`-based MCP integrations can become both orchestrators and controlled agents when a node is available.
- The same machine can hold multiple logical agents on one node when they represent different host agents, such as Codex and Claude using the same `npx` package.
