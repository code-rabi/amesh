import { Handle, Position } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import type { AgentRecord, AgentStatus, NodeRecord, NodeStatus } from "@amesh/protocol";
import {
  agentCanBeControlled,
  agentCanLaunchSessions,
  agentCanOrchestrate,
  agentRoleBadges,
  getAgentNodeId
} from "../lib/agentRoles.js";
import { relativeTime } from "../lib/time.js";
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

function nodePillLabel(status: NodeStatus) {
  return status;
}

function agentStatusLabel(status: AgentStatus) {
  return status;
}

export function NodeCard({ data }: NodeCardProps) {
  const {
    node,
    agents,
    connectionSourceAgentId,
    connectionSourceAgentName,
    onConnectionPick
  } = data.data;
  const isOffline = node.status === "offline";
  const navigate = useNavigate();

  return (
    <div className="node-card" data-status={node.status}>
      <div className="node-card__header">
        <div>
          <h3 className="node-card__name">{node.name}</h3>
          <div className="node-card__host">{node.host}</div>
          {isOffline ? (
            <div className="node-card__lastseen">
              Last seen {relativeTime(node.lastSeenAt)}
            </div>
          ) : null}
          {node.status === "pending" ? (
            <div className="node-card__lastseen">Waiting for first heartbeat.</div>
          ) : null}
        </div>
        <div className="node-card__meta">
          <span className={nodePill(node.status)}>{nodePillLabel(node.status)}</span>
          <div onPointerDown={(event) => event.stopPropagation()}>
            <NodeSettingsButton node={node} agents={agents} />
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="node-card__empty">No agents advertised yet.</div>
      ) : (
        <ul className="node-card__agents">
          {agents.map((agent) => {
            const chatDisabled = isOffline || agent.status !== "online" || !agentCanLaunchSessions(agent);
            const connectionSelected = connectionSourceAgentId === agent.id;
            const canPickAsSource = agentCanOrchestrate(agent) && agent.status === "online" && !isOffline;
            const canPickAsTarget = agentCanBeControlled(agent) && agent.status === "online" && !isOffline;
            const connectionDisabled = connectionSourceAgentId
              ? connectionSelected
                ? false
                : !canPickAsTarget
              : !canPickAsSource;
            const connectionLabel = connectionSourceAgentId
              ? connectionSelected
                ? `Cancel connection from ${agent.name}`
                : `Connect ${connectionSourceAgentName ?? "selected agent"} to ${agent.name}`
              : `Start connection from ${agent.name}`;
            const roleBadges = agentRoleBadges(agent);
            return (
              <li key={agent.id} className="node-card__agent">
                <div>
                  <div className="node-card__agent-name">{agent.name}</div>
                  <div className="node-card__agent-id">{agent.id}</div>
                  {roleBadges.length > 0 ? (
                    <div className="node-card__role-row">
                      {roleBadges.map((badge) => (
                        <span key={badge} className="role-badge">
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {typeof agent.capabilities.cwd === "string" ? (
                    <div className="node-card__agent-cwd">{agent.capabilities.cwd}</div>
                  ) : null}
                </div>
                <div className="node-card__agent-tail">
                  <button
                    type="button"
                    className="node-card__connect"
                    title={connectionDisabled ? "Agent is not online" : connectionLabel}
                    aria-label={connectionLabel}
                    aria-pressed={connectionSelected}
                    disabled={connectionDisabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (connectionDisabled) return;
                      onConnectionPick(agent);
                    }}
                  >
                    <ArrowRight size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="node-card__chat"
                    title={chatDisabled ? "Agent is not online" : "Open chat"}
                    aria-label={`Open chat with ${agent.name}`}
                    disabled={chatDisabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (chatDisabled) return;
                      void navigate({
                        to: "/sessions",
                        search: {
                          node: getAgentNodeId(agent) ?? undefined,
                          folder: undefined,
                          agent: agent.id,
                          session: undefined,
                        }
                      });
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {agent.status === "error" ? (
                    <div onPointerDown={(event) => event.stopPropagation()}>
                      <NodeSettingsButton
                        node={node}
                        agents={agents}
                        startTab="agents"
                        renderTrigger={({ open, openModal }) => (
                          <button
                            type="button"
                            className="node-card__agent-status node-card__agent-status--button"
                            data-status={agent.status}
                            aria-label={`Open error details for ${agent.name} on ${node.name}`}
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            onClick={(event) => {
                              event.stopPropagation();
                              openModal();
                            }}
                          >
                            {agentStatusLabel(agent.status)}
                          </button>
                        )}
                      />
                    </div>
                  ) : (
                    <span
                      className="node-card__agent-status"
                      data-status={agent.status}
                    >
                      {agentStatusLabel(agent.status)}
                    </span>
                  )}
                </div>

                <Handle
                  type="target"
                  position={Position.Left}
                  id={agent.id}
                  isConnectable={!isOffline && agentCanBeControlled(agent)}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={agent.id}
                  isConnectable={!isOffline && agentCanOrchestrate(agent)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
