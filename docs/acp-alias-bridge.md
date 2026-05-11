# ACP alias bridge

- `amesh` exports remote mesh agents to ACP clients as local alias names, not as raw `node_id + agent_id` pairs.
- The local machine keeps those alias names in `acpx`; each alias command runs `amesh acp <alias>`.
- `amesh acp <alias>` resolves the alias from local config, authenticates to the control plane, and routes to the configured remote `agentId`.
- The server remains the authority for session creation and authorization. Local alias presence is only convenience state.
