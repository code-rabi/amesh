import { Handle, Position } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { AgentRecord, AgentStatus } from "@amesh/protocol";

import {
  agentCanBeControlled,
  agentCanLaunchSessions,
  agentCanOrchestrate,
  agentRoleBadges,
  agentSecondaryLabel
} from "../lib/agentRoles.js";

export type StandaloneAgentCardData = {
  agent: AgentRecord;
  connectionSourceAgentId: string | null;
  connectionSourceAgentName: string | null;
  onConnectionPick: (agent: AgentRecord) => void;
};

type StandaloneAgentCardProps = {
  data: { data: StandaloneAgentCardData };
};

function agentStatusLabel(status: AgentStatus) {
  return status;
}

export function StandaloneAgentCard({ data }: StandaloneAgentCardProps) {
  const { agent, connectionSourceAgentId, connectionSourceAgentName, onConnectionPick } = data.data;
  const navigate = useNavigate();
  const connectionSelected = connectionSourceAgentId === agent.id;
  const secondaryLabel = agentSecondaryLabel(agent) ?? "orchestrator";
  const canPickAsSource = agentCanOrchestrate(agent) && agent.status === "online";
  const canPickAsTarget = agentCanBeControlled(agent) && agent.status === "online";
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
  const chatDisabled = !agentCanLaunchSessions(agent) || agent.status !== "online";
  const roleBadges = agentRoleBadges(agent);

  return (
    <div className="node-card standalone-agent-card" data-status={agent.status}>
      <div className="node-card__header">
        <div>
          <h3 className="node-card__name">{agent.name}</h3>
          <div className="node-card__host">{secondaryLabel}</div>
          <div className="node-card__role-row">
            {roleBadges.map((badge) => (
              <span key={badge} className="role-badge">
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="node-card__meta">
          <span className={`pill pill-${agent.status === "error" ? "error" : agent.status}`}>
            {agent.status}
          </span>
        </div>
      </div>

      <ul className="node-card__agents">
        <li className="node-card__agent">
          <div>
            <div className="node-card__agent-name">External orchestration endpoint</div>
            <div className="node-card__agent-id">{agent.id}</div>
            {typeof agent.capabilities.cwd === "string" ? (
              <div className="node-card__agent-cwd">{agent.capabilities.cwd}</div>
            ) : null}
          </div>
          <div className="node-card__agent-tail">
            <button
              type="button"
              className="node-card__connect"
              title={connectionDisabled ? "Agent cannot be used for this connection step" : connectionLabel}
              aria-label={connectionLabel}
              aria-pressed={connectionSelected}
              disabled={connectionDisabled}
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
              title={chatDisabled ? "Agent is not controllable from amesh" : "Open chat"}
              aria-label={`Open chat with ${agent.name}`}
              disabled={chatDisabled}
              onClick={(event) => {
                event.stopPropagation();
                if (chatDisabled) return;
                void navigate({
                  to: "/sessions",
                  search: {
                    node: undefined,
                    folder: undefined,
                    agent: agent.id,
                    session: undefined
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
            <span className="node-card__agent-status" data-status={agent.status}>
              {agentStatusLabel(agent.status)}
            </span>
          </div>

          <Handle
            type="target"
            position={Position.Left}
            id={agent.id}
            isConnectable={agentCanBeControlled(agent)}
          />
          <Handle
            type="source"
            position={Position.Right}
            id={agent.id}
            isConnectable={agentCanOrchestrate(agent)}
          />
        </li>
      </ul>
    </div>
  );
}
