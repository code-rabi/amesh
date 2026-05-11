import type { AgentRecord } from "@amesh/protocol";

import { relativeTime } from "../lib/time.js";
import type { SessionSummary } from "../types.js";

type Props = {
  sessions: SessionSummary[];
  selectedAgent: AgentRecord | null;
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "pending",
  running: "live",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled"
};

function statusPillClass(status: string): string {
  switch (status) {
    case "running":
    case "pending":
      return "pill pill-pending";
    case "completed":
      return "pill pill-online";
    case "failed":
      return "pill pill-error";
    case "cancelled":
      return "pill pill-offline";
    default:
      return "pill pill-offline";
  }
}

export function SessionList({ sessions, selectedAgent, selectedId, loading, onSelect, onNew }: Props) {
  const filtered = selectedAgent
    ? sessions.filter((session) => session.entryAgentId === selectedAgent.id)
    : sessions;

  const sorted = [...filtered].sort((a, b) => {
    const ad = Date.parse(a.createdAt) || 0;
    const bd = Date.parse(b.createdAt) || 0;
    return bd - ad;
  });

  return (
    <aside className="sessions-rail" aria-label="Sessions">
      <header className="sessions-rail__header">
        <div className="sessions-rail__title">
          <h2>{selectedAgent ? selectedAgent.name : "All sessions"}</h2>
          {selectedAgent ? (
            <span className="sessions-rail__sub font-mono">{selectedAgent.id}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onNew}
          disabled={!selectedAgent}
          title={selectedAgent ? `New session with ${selectedAgent.name}` : "Pick an agent first"}
        >
          New
        </button>
      </header>

      {loading && sessions.length === 0 ? null : sorted.length === 0 ? (
        <div className="sessions-rail__empty">
          {selectedAgent
            ? `No sessions with ${selectedAgent.name} yet. Hit New to start one.`
            : "No sessions yet. Pick an agent on the left."}
        </div>
      ) : (
        <ul className="sessions-rail__list">
          {sorted.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className="session-row"
                data-selected={selectedId === session.id}
                onClick={() => onSelect(session.id)}
              >
                <div className="session-row__line">
                  <span className="session-row__time">{relativeTime(session.createdAt)}</span>
                  <span className={statusPillClass(session.status)}>
                    {STATUS_LABEL[session.status] ?? session.status}
                  </span>
                </div>
                <div className="session-row__meta">
                  <span className="session-row__id">{session.id}</span>
                  {session.initiator === "agent" ? (
                    <span className="session-row__tag">child</span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
