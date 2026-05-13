import { useMemo, useState } from "react";
import type { TopologySnapshot } from "@amesh/protocol";
import { ArrowRight } from "lucide-react";

import { createTriggerRule } from "../api.js";
import { relativeTime } from "../lib/time.js";
import { NodeSettingsButton } from "./NodeSettingsButton.js";

type Props = { topology: TopologySnapshot };

export function NarrowFallback({ topology }: Props) {
  const [connectionSourceAgentId, setConnectionSourceAgentId] = useState<string | null>(null);
  const agentsById = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent])),
    [topology.agents]
  );
  const connectionSourceAgentName =
    connectionSourceAgentId ? agentsById.get(connectionSourceAgentId)?.name ?? null : null;

  async function pickConnectionEndpoint(agentId: string) {
    if (!connectionSourceAgentId) {
      setConnectionSourceAgentId(agentId);
      return;
    }
    if (connectionSourceAgentId === agentId) {
      setConnectionSourceAgentId(null);
      return;
    }
    await createTriggerRule({
      sourceAgentId: connectionSourceAgentId,
      targetAgentId: agentId,
      mode: "allow"
    });
    setConnectionSourceAgentId(null);
  }

  return (
    <div className="narrow-fallback">
      <div className="note">
        Compact topology view. Use the arrow controls on online agents to create allow rules.
      </div>

      {topology.nodes.length === 0 ? (
        <div className="note">No nodes yet.</div>
      ) : null}

      {topology.nodes.map((node) => {
        const agents = topology.agents.filter((agent) => agent.nodeId === node.id);
        const rules = topology.triggerRules.filter((rule) =>
          agents.some((agent) => agent.id === rule.sourceAgentId)
        );

        return (
          <article key={node.id} className="narrow-card">
            <header>
              <div>
                <h3>{node.name}</h3>
                <div className="host">{node.host}</div>
              </div>
              <div className="narrow-card__meta">
                <span className={`pill pill-${node.status}`}>{node.status}</span>
                <NodeSettingsButton node={node} agents={agents} />
              </div>
            </header>

            {node.status === "offline" ? (
              <div className="host">Last seen {relativeTime(node.lastSeenAt)}</div>
            ) : null}

            {agents.length === 0 ? (
              <div className="host">No agents advertised yet.</div>
            ) : (
              <ul className="rules">
                {agents.map((agent) => (
                  <li
                    key={agent.id}
                    data-link-source={connectionSourceAgentId === agent.id ? "true" : undefined}
                  >
                    {agent.name} <span className="host">({agent.status})</span>
                    {" "}
                    <button
                      type="button"
                      className="narrow-card__connect"
                      aria-label={
                        connectionSourceAgentId
                          ? connectionSourceAgentId === agent.id
                            ? `Cancel connection from ${agent.name}`
                            : `Connect ${connectionSourceAgentName ?? "selected agent"} to ${agent.name}`
                          : `Start connection from ${agent.name}`
                      }
                      aria-pressed={connectionSourceAgentId === agent.id}
                      disabled={node.status !== "online" || agent.status !== "online"}
                      onClick={() => void pickConnectionEndpoint(agent.id)}
                    >
                      <ArrowRight size={13} aria-hidden />
                      <span>
                        {connectionSourceAgentId
                          ? connectionSourceAgentId === agent.id
                            ? "Cancel"
                            : "Target"
                          : "Link"}
                      </span>
                    </button>
                    {typeof agent.capabilities.cwd === "string" ? (
                      <>
                        {" "}
                        <span className="host">[{agent.capabilities.cwd}]</span>
                      </>
                    ) : null}
                    {agent.status === "error" ? (
                      <>
                        {" "}
                        <NodeSettingsButton
                          node={node}
                          agents={agents}
                          startTab="agents"
                          renderTrigger={({ open, openModal }) => (
                            <button
                              type="button"
                              className="narrow-card__error-link"
                              aria-label={`Open error details for ${agent.name} on ${node.name}`}
                              aria-haspopup="dialog"
                              aria-expanded={open}
                              onClick={openModal}
                            >
                              error
                            </button>
                          )}
                        />
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {rules.length > 0 ? (
              <ul className="rules">
                {rules.map((rule) => {
                  const target = agentsById.get(rule.targetAgentId);
                  const source = agentsById.get(rule.sourceAgentId);
                  return (
                    <li key={rule.id}>
                      {source?.name ?? rule.sourceAgentId}{" "}
                      <em data-mode={rule.mode}>{rule.mode === "allow" ? "→" : "⊘"}</em>{" "}
                      {target?.name ?? rule.targetAgentId}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
