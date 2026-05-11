import { Handle, Position } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";

import type { AgentRecord, AgentStatus, NodeRecord, NodeStatus } from "@amesh/protocol";
import { relativeTime } from "../lib/time.js";
import { NodeDetectButton } from "./NodeDetectButton.js";
import { NodeUpdateButton } from "./NodeUpdateButton.js";

export type NodeCardData = {
  node: NodeRecord;
  agents: AgentRecord[];
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
  const { node, agents } = data.data;
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
            <NodeDetectButton node={node} compact />
          </div>
          <div onPointerDown={(event) => event.stopPropagation()}>
            <NodeUpdateButton node={node} compact />
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="node-card__empty">No agents advertised yet.</div>
      ) : (
        <ul className="node-card__agents">
          {agents.map((agent) => {
            const chatDisabled = isOffline || agent.status !== "online";
            return (
              <li key={agent.id} className="node-card__agent">
                <div>
                  <div className="node-card__agent-name">{agent.name}</div>
                  <div className="node-card__agent-id">{agent.id}</div>
                </div>
                <div className="node-card__agent-tail">
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
                        search: { agent: agent.id, session: undefined }
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
                  <span
                    className="node-card__agent-status"
                    data-status={agent.status}
                  >
                    {agentStatusLabel(agent.status)}
                  </span>
                </div>

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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
