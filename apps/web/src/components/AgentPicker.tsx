import type { TopologySnapshot } from "@amesh/protocol";
import { useState } from "react";

import { renameAgent } from "../api.js";

type Props = {
  topology: TopologySnapshot;
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
};

export function AgentPicker({ topology, selectedAgentId, onSelect }: Props) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const onlineAgents = topology.agents.filter((agent) => agent.status === "online");
  const others = topology.agents.filter((agent) => agent.status !== "online");

  return (
    <div className="agent-picker">
      <header className="agent-picker__header">
        <h2>Start a session</h2>
        <p>Pick an agent to message. Online agents accept new sessions immediately.</p>
      </header>
      {topology.agents.length === 0 ? (
        <div className="agent-picker__empty">
          No agents in the mesh yet. Register a node from the Topology view.
        </div>
      ) : (
        <ul className="agent-picker__list">
          {[...onlineAgents, ...others].map((agent) => {
            const node = topology.nodes.find((n) => n.id === agent.nodeId);
            const disabled = agent.status !== "online" || node?.status !== "online";
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className="agent-picker__row"
                  data-selected={selectedAgentId === agent.id}
                  disabled={disabled}
                  onClick={() => onSelect(agent.id)}
                  onDoubleClick={async () => {
                    if (savingId===agent.id) return;
                    const value = window.prompt("Set display name", agent.displayName ?? agent.name);
                    if (value===null) return;
                    setSavingId(agent.id);
                    try { await renameAgent(agent.id, value.trim() ? value.trim() : null); } finally { setSavingId(null);}
                  }}
                >
                  <div>
                    <div className="agent-picker__name">{agent.displayName ?? agent.name}</div>
                    <div className="agent-picker__sub">
                      <span>{node?.name ?? "unknown node"}</span>
                      <span>·</span>
                      <span className="font-mono">{agent.id}</span>
                    </div>
                  </div>
                  <span className={`pill pill-${agent.status}`}>{agent.status}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
