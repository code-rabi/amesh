# Agent control MCP

- `amesh` now exposes a real HTTP MCP endpoint at `/mcp` on the control-plane server.
- The transport is MCP Streamable HTTP with stateful sessions, because `initialize` must survive across later `tools/list` and `tools/call` requests.
- The current server enables JSON response mode instead of SSE streaming. That keeps the first agent-control surface simple and works cleanly for request-response tools like session start, session lookup, and cancellation.
- MCP auth accepts either the existing admin browser session cookie or `Authorization: Bearer <AUTH_ADMIN_PASSWORD>`. This keeps the first implementation aligned with the control plane's existing single-admin model instead of inventing a second credential system.
- A caller can scope the MCP session to an advertised mesh agent with `X-Amesh-Agent-Id` and optional `X-Amesh-Node-Id`. Scoped sessions only see that agent and its allowed downstream agents by default, and `start_session` becomes an agent-initiated launch instead of a user-initiated one.
- Scoped agent launches can include `parentSessionId`. When present, `amesh` records `session.invocation.requested` and `session.invocation.allowed` on the parent before starting the child session, so MCP-driven cross-agent work still shows up in normal session lineage.
- Per-agent secrets are intentionally not part of this first cut. The scope headers are trusted only after shared admin authentication. If we later need untrusted remote callers, the next step is dedicated issued credentials per node or per agent rather than widening the shared admin password further.
