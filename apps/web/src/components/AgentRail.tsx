import type { TopologySnapshot } from "@amesh/protocol";

import { agentColor } from "../lib/agentColor.js";
import { AgentAvatar } from "./AgentAvatar.js";

type Props = {
  topology: TopologySnapshot;
  selectedAgentId: string | null;
  onSelect: (agentId: string | null) => void;
};

export function AgentRail({ topology, selectedAgentId, onSelect }: Props) {
  return (
    <nav className="agent-rail" aria-label="Agents">
      <button
        type="button"
        className="agent-rail__all"
        data-selected={selectedAgentId === null}
        onClick={() => onSelect(null)}
        title="All agents"
        aria-label="All agents"
      >
        ◇
      </button>
      <div className="agent-rail__divider" aria-hidden />
      <ul className="agent-rail__list">
        {topology.agents.map((agent) => {
          const node = topology.nodes.find((n) => n.id === agent.nodeId);
          const palette = agentColor(agent.id);
          const isSelected = selectedAgentId === agent.id;
          return (
            <li key={agent.id}>
              <button
                type="button"
                className="agent-rail__btn"
                data-selected={isSelected}
                data-status={agent.status}
                style={isSelected ? { ["--ring" as string]: palette.ring } : undefined}
                onClick={() => onSelect(agent.id)}
                title={`${agent.name}${node ? ` · ${node.name}` : ""}`}
                aria-label={`Switch to ${agent.name}`}
              >
                <AgentAvatar id={agent.id} name={agent.name} size={36} />
                <span
                  className="agent-rail__dot"
                  data-status={agent.status}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
