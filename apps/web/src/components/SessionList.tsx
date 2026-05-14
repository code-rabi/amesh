import type { NodeRecord } from "@amesh/protocol";

import { relativeTime } from "../lib/time.js";
import type { SessionSummary } from "../types.js";

type Props = {
  sessions: SessionSummary[];
  selectedNode: NodeRecord | null;
  agentNames: Map<string, string>;
  currentFolderLabel: string | null;
  folderOptions: Array<{ value: string | null; label: string }>;
  selectedFolder: string | null;
  selectedId: string | null;
  loading: boolean;
  canCreateSession: boolean;
  onSelect: (id: string) => void;
  onSelectFolder: (folder: string | null) => void;
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

export function SessionList({
  sessions,
  selectedNode,
  agentNames,
  currentFolderLabel,
  folderOptions,
  selectedFolder,
  selectedId,
  loading,
  canCreateSession,
  onSelect,
  onSelectFolder,
  onNew
}: Props) {
  const sorted = [...sessions].sort((a, b) => {
    const ad = Date.parse(a.createdAt) || 0;
    const bd = Date.parse(b.createdAt) || 0;
    return bd - ad;
  });

  return (
    <aside className="sessions-rail" aria-label="Sessions">
      <header className="sessions-rail__header">
        <div className="sessions-rail__top">
          <div className="sessions-rail__title">
            <h2>{selectedNode ? selectedNode.name : "All sessions"}</h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onNew}
            disabled={!selectedNode || !canCreateSession}
            title={
              !selectedNode
                ? "Pick a node first"
                : canCreateSession
                  ? `New session on ${selectedNode.name}`
                  : "This node has no controllable agents"
            }
          >
            New
          </button>
        </div>
        {selectedNode ? (
          <div className="sessions-rail__scope">
            <span className="sessions-rail__scope-label">Folder</span>
            {folderOptions.length > 1 ? (
              <select
                className="sessions-rail__scope-select"
                aria-label="Session folder"
                value={selectedFolder ?? "__default__"}
                onChange={(event) =>
                  onSelectFolder(event.target.value === "__default__" ? null : event.target.value)
                }
              >
                {folderOptions.map((option) => (
                  <option key={option.value ?? "__default__"} value={option.value ?? "__default__"}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="sessions-rail__scope-value font-mono">
                {currentFolderLabel ?? "Default folder"}
              </span>
            )}
          </div>
        ) : null}
      </header>

      {loading && sessions.length === 0 ? null : sorted.length === 0 ? (
        <div className="sessions-rail__empty">
          {selectedNode
            ? canCreateSession
              ? `No sessions in this folder yet. Hit New to start one.`
              : "No controllable agents on this node yet."
            : "No sessions yet. Pick a node on the left."}
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
                  <span className="session-row__time">
                    {agentNames.get(session.entryAgentId) ?? session.entryAgentId}
                  </span>
                  <span className={statusPillClass(session.status)}>
                    {STATUS_LABEL[session.status] ?? session.status}
                  </span>
                </div>
                <div className="session-row__meta">
                  <span className="session-row__id">{relativeTime(session.createdAt)}</span>
                  <span className="session-row__tag font-mono">{session.id}</span>
                  {session.cwd ? <span className="session-row__cwd">{session.cwd}</span> : null}
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
