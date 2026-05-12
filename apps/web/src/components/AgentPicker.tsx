import type { AgentRecord } from "@amesh/protocol";

import { AgentAvatar } from "./AgentAvatar.js";

type Props = {
  agents: AgentRecord[];
  nodeName: string | null;
  folderLabel: string | null;
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
};

export function AgentPicker({ agents, nodeName, folderLabel, selectedAgentId, onSelect }: Props) {
  const ranked = [...agents].sort((left, right) => {
    const leftOnline = left.status === "online" ? 0 : 1;
    const rightOnline = right.status === "online" ? 0 : 1;
    if (leftOnline !== rightOnline) {
      return leftOnline - rightOnline;
    }
    return left.name.localeCompare(right.name);
  });

  return (
    <div className="agent-picker">
      <header className="agent-picker__header">
        <p className="agent-picker__eyebrow">Launch target</p>
        <h2>Start a session</h2>
        <div className="agent-picker__scope">
          {nodeName ? <span className="agent-picker__scope-chip">{nodeName}</span> : null}
          {folderLabel ? <span className="agent-picker__scope-chip font-mono">{folderLabel}</span> : null}
        </div>
        <p>
          {nodeName
            ? "Choose one of the exposed agents for this folder. Only online agents can start immediately."
            : "Pick a node and folder to choose a launch target."}
        </p>
      </header>
      {agents.length === 0 ? (
        <div className="agent-picker__empty">
          {nodeName
            ? "No agents are exposed for this folder yet."
            : "Pick a node and folder to start a session."}
        </div>
      ) : (
        <ul className="agent-picker__list">
          {ranked.map((agent) => {
            const disabled = agent.status !== "online";
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className="agent-picker__row"
                  data-selected={selectedAgentId === agent.id}
                  data-status={agent.status}
                  disabled={disabled}
                  onClick={() => onSelect(agent.id)}
                >
                  <div className="agent-picker__identity">
                    <AgentAvatar id={agent.id} name={agent.name} size={28} />
                    <div>
                      <div className="agent-picker__name">{agent.name}</div>
                      <div className="agent-picker__sub">
                        <span className="font-mono">{agent.id}</span>
                      </div>
                    </div>
                  </div>
                  <div className="agent-picker__aside">
                    <span className={`pill pill-${agent.status}`}>{agent.status}</span>
                    <div className="agent-picker__sub">
                      {disabled ? "Unavailable" : "Ready"}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
