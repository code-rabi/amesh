# amesh

`amesh` is a control plane for running ACP-compatible agents across multiple machines.

The MVP focuses on three things:

1. Register remote nodes with a central server over WebSocket.
2. Attach one or more ACP-backed agents to each node.
3. Let users chat with any agent in a web UI and define which agents may trigger other agents across nodes.

Initial product and architecture details live in [docs/design/mvp-design.md](/home/nitayr/projects/amesh/docs/design/mvp-design.md).
