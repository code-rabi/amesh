import { Handle, Position } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { AgentRecord, AgentStatus, NodeRecord, NodeStatus } from "@amesh/protocol";
import { relativeTime } from "../lib/time.js";
import { McpPanel } from "./McpPanel.js";
import { NodeSettingsButton } from "./NodeSettingsButton.js";

export type NodeCardData = {
  node: NodeRecord;
  agents: AgentRecord[];
  connectionSourceAgentId: string | null;
  connectionSourceAgentName: string | null;
  onConnectionPick: (agent: AgentRecord) => void;
};

type NodeCardProps = {
  data: { data: NodeCardData };
};

function nodePill(status: NodeStatus) {
  if (status === "online") return "pill pill-online";
  if (status === "pending") return "pill pill-pending";
  return "pill pill-offline";
}

function agentPill(status: AgentStatus) {
  if (status === "online") return "pill pill-online";
  if (status === "error") return "pill pill-error";
  return "pill pill-offline";
}

function nodePillLabel(status: NodeStatus) {
  return status;
}

function agentStatusLabel(status: AgentStatus) {
  return status;
}

export function NodeCard({ data }: NodeCardProps) {
  const { node, agents } = data.data;
  const isOffline = node.status === "offline";
  const navigate = useNavigate();
  const [mcpAgent, setMcpAgent] = useState<AgentRecord | null>(null);

  return (
    <div className="node-card" data-status={node.status}>
      {/* Node header */}
      <div className="node-card__header">
        <div className="node-card__identity">
          <h3 className="node-card__name">{node.name}</h3>
          <div className="node-card__host">{node.host}</div>
          {isOffline ? (
            <div className="node-card__lastseen">Last seen {relativeTime(node.lastSeenAt)}</div>
          ) : null}
          {node.status === "pending" ? (
            <div className="node-card__lastseen">Waiting for first heartbeat.</div>
          ) : null}
        </div>
        <div className="node-card__header-actions">
          <span className={nodePill(node.status)}>{nodePillLabel(node.status)}</span>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <NodeSettingsButton node={node} agents={agents} />
          </div>
        </div>
      </div>

      {/* Agent cards */}
      {agents.length === 0 ? (
        <div className="node-card__empty">No agents advertised yet.</div>
      ) : (
        <ul className="node-card__agents">
          {agents.map((agent) => {
            const chatDisabled = isOffline || agent.status !== "online";
            const mcpOpen = mcpAgent?.id === agent.id;

            return (
              <li key={agent.id} className="node-card__agent" data-status={agent.status}>
                {/* Connection handles at physical edges */}
                <Handle
                  type="target"
                  position={Position.Left}
                  id={agent.id}
                  isConnectable={!isOffline}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={agent.id}
                  isConnectable={!isOffline}
                />

                {/* Agent info */}
                <div className="node-card__agent-head">
                  <span className="node-card__agent-name">{agent.name}</span>
                  {agent.status === "error" ? (
                    <div onPointerDown={(e) => e.stopPropagation()}>
                      <NodeSettingsButton
                        node={node}
                        agents={agents}
                        startTab="agents"
                        renderTrigger={({ open, openModal }) => (
                          <button
                            type="button"
                            className={`${agentPill(agent.status)} node-card__agent-status-btn`}
                            aria-label={`Error details for ${agent.name}`}
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            onClick={(e) => { e.stopPropagation(); openModal(); }}
                          >
                            {agentStatusLabel(agent.status)}
                          </button>
                        )}
                      />
                    </div>
                  ) : (
                    <span className={agentPill(agent.status)}>
                      {agentStatusLabel(agent.status)}
                    </span>
                  )}
                </div>

                <div className="node-card__agent-id">{agent.id}</div>

                {typeof agent.capabilities.cwd === "string" ? (
                  <div className="node-card__agent-cwd">{agent.capabilities.cwd}</div>
                ) : null}

                {/* Agent actions */}
                <div
                  className="node-card__agent-actions"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="node-card__action"
                    disabled={chatDisabled}
                    title={chatDisabled ? "Agent is not online" : "Open chat"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (chatDisabled) return;
                      void navigate({
                        to: "/sessions",
                        search: {
                          node: agent.nodeId,
                          folder: undefined,
                          agent: agent.id,
                          session: undefined
                        }
                      });
                    }}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    className="node-card__action"
                    aria-pressed={mcpOpen}
                    title="Get MCP config"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMcpAgent((prev) => (prev?.id === agent.id ? null : agent));
                    }}
                  >
                    MCP
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* MCP config modal — portal to body */}
      {mcpAgent ? (
        <McpPanel agent={mcpAgent} onClose={() => setMcpAgent(null)} />
      ) : null}
    </div>
  );
}
