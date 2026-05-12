import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Logs,
  Settings2,
  X
} from "lucide-react";
import type { AgentRecord, DirectoryEntry, NodeRecord } from "@amesh/protocol";

import {
  fetchNodeDirectories,
  requestNodeDetect,
  requestNodeUpdate,
  updateNodePaths
} from "../api.js";
import { useTopology } from "../lib/topologyContext.js";

type Props = {
  node: NodeRecord;
  agents: AgentRecord[];
  startTab?: "folders" | "agents";
  renderTrigger?: (input: { open: boolean; openModal: () => void }) => ReactNode;
};

function extractPaths(agents: AgentRecord[]) {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const agent of agents) {
    const cwd = typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd.trim() : "";
    if (!cwd || seen.has(cwd)) {
      continue;
    }
    seen.add(cwd);
    paths.push(cwd);
  }
  return paths;
}

function dirname(path: string) {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return normalized || "/";
  }
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return normalized.slice(0, index);
}

function initialBrowsePath(paths: string[]) {
  if (paths.length === 0) {
    return "";
  }
  const value = paths[0]?.trim() ?? "";
  if (!value) {
    return "";
  }
  return dirname(value);
}

function pathLabel(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index === -1) {
    return normalized || path;
  }
  return normalized.slice(index + 1) || normalized;
}

export function NodeSettingsButton({
  node,
  agents,
  startTab = "folders",
  renderTrigger
}: Props) {
  const { refresh } = useTopology();
  const navigate = useNavigate();
  const currentPaths = useMemo(
    () => (node.paths.length > 0 ? [...node.paths] : extractPaths(agents)),
    [agents, node.paths]
  );
  const sortedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        const leftCwd = typeof left.capabilities.cwd === "string" ? left.capabilities.cwd : "";
        const rightCwd = typeof right.capabilities.cwd === "string" ? right.capabilities.cwd : "";
        if (leftCwd && !rightCwd) return -1;
        if (!leftCwd && rightCwd) return 1;
        return left.name.localeCompare(right.name);
      }),
    [agents]
  );
  const [open, setOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState<"folders" | "agents">(startTab);
  const [activeTab, setActiveTab] = useState<"folders" | "agents">("folders");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [loadedDirectories, setLoadedDirectories] = useState(false);
  const [busyAction, setBusyAction] = useState<"paths" | "detect" | "update" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const nodeOffline = node.status !== "online";

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextPaths = [...currentPaths];
    setSelectedPaths(nextPaths);
    setBrowsePath(initialBrowsePath(nextPaths));
    setActiveTab(requestedTab);
    setLoadedDirectories(false);
    setMessage(null);
  }, [open, currentPaths, requestedTab]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setLoadingDirectories(true);
    void fetchNodeDirectories(node.id, browsePath || undefined)
      .then((response) => {
        if (!active) {
          return;
        }
        setBrowsePath(response.path);
        setEntries(response.entries);
        setLoadedDirectories(true);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setMessage(error instanceof Error ? error.message : "Could not load directories.");
      })
      .finally(() => {
        if (active) {
          setLoadingDirectories(false);
        }
      });
    return () => {
      active = false;
    };
  }, [browsePath, node.id, open]);

  function toggleSelected(path: string) {
    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((value) => value !== path) : [...current, path]
    );
  }

  async function handleSavePaths() {
    if (nodeOffline) {
      return;
    }

    setBusyAction("paths");
    setMessage(null);
    try {
      await updateNodePaths(node.id, selectedPaths);
      setMessage("Exposed paths updated. The node will refresh its workspace-scoped agents.");
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update exposed paths.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDetectAgents() {
    if (nodeOffline) {
      return;
    }

    setBusyAction("detect");
    setMessage(null);
    try {
      await requestNodeDetect(node.id);
      setMessage("Detection requested. The node will refresh its agent inventory.");
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request detection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpdateNode() {
    if (nodeOffline || !node.updateRequired) {
      return;
    }

    setBusyAction("update");
    setMessage(null);
    try {
      await requestNodeUpdate(node.id);
      setMessage("Update requested. The node should reconnect after restart.");
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request update.");
    } finally {
      setBusyAction(null);
    }
  }

  function openModal() {
    setRequestedTab(startTab);
    setOpen(true);
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ open, openModal })
      ) : (
        <button
          type="button"
          className="node-settings__trigger"
          aria-label={
            startTab === "agents"
              ? `Open agent logs for ${node.name}`
              : `Open settings for ${node.name}`
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openModal}
        >
          {startTab === "agents" ? <Logs size={14} /> : <Settings2 size={14} />}
        </button>
      )}

      {open
        ? createPortal(
            <div className="node-settings__backdrop" onClick={() => setOpen(false)}>
              <div
                className="node-settings__dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Node settings for ${node.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="node-settings__header">
                  <div>
                    <div className="node-settings__eyebrow">Node settings</div>
                    <h3 className="node-settings__title">{node.name}</h3>
                    <div className="node-settings__subline">{node.host}</div>
                  </div>
                  <button
                    type="button"
                    className="node-settings__close"
                    aria-label={`Close settings for ${node.name}`}
                    onClick={() => setOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="node-settings__layout">
                  <div className="node-settings__tabs" role="tablist" aria-label="Node settings sections">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "folders"}
                      className="node-settings__tab"
                      data-active={activeTab === "folders"}
                      onClick={() => setActiveTab("folders")}
                    >
                      Folders
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "agents"}
                      className="node-settings__tab"
                      data-active={activeTab === "agents"}
                      onClick={() => setActiveTab("agents")}
                    >
                      Agents
                    </button>
                  </div>

                  {activeTab === "folders" ? (
                  <div className="node-settings__section">
                    <div className="node-settings__section-head">
                      <div>
                        <div className="node-settings__section-title">Workspace folders</div>
                        <p className="node-settings__copy">
                          Browse the node&apos;s filesystem, choose folders, then save the exposed set.
                        </p>
                      </div>
                      <div className="node-settings__stat">
                        {selectedPaths.length} selected
                      </div>
                    </div>

                    <div className="node-settings__pathbar">
                      <button
                        type="button"
                        className="node-settings__pathnav"
                        aria-label="Go to parent folder"
                        onClick={() => setBrowsePath(dirname(browsePath))}
                        disabled={loadingDirectories || !browsePath || browsePath === "/"}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <div className="node-settings__current-path">{browsePath || "Loading root..."}</div>
                    </div>

                    <div className="node-settings__browser" aria-label="Directory browser">
                      {!loadedDirectories && loadingDirectories ? (
                        <div className="node-settings__empty">Loading folders...</div>
                      ) : entries.length === 0 ? (
                        <div className="node-settings__empty">No child folders in this location.</div>
                      ) : (
                        <>
                          <ul className="node-settings__folder-list">
                            {entries.map((entry) => {
                              const selected = selectedPaths.includes(entry.path);
                              return (
                                <li key={entry.path} className="node-settings__folder-row">
                                  <button
                                    type="button"
                                    className="node-settings__folder-main"
                                    onClick={() => setBrowsePath(entry.path)}
                                  >
                                    {entry.hasChildren ? <FolderOpen size={16} /> : <Folder size={16} />}
                                    <span>{entry.name}</span>
                                    <ChevronRight size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`node-settings__folder-toggle ${
                                      selected ? "node-settings__folder-toggle--selected" : ""
                                    }`}
                                    aria-label={`${selected ? "Remove" : "Add"} ${entry.path}`}
                                    onClick={() => toggleSelected(entry.path)}
                                  >
                                    {selected ? <Check size={14} /> : null}
                                    <span>{selected ? "Selected" : "Add"}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                          {loadingDirectories ? (
                            <div className="node-settings__browser-loading">Loading…</div>
                          ) : null}
                        </>
                      )}
                    </div>

                    <div className="node-settings__selection">
                      {selectedPaths.length === 0 ? (
                        <div className="node-settings__empty">No folders selected.</div>
                      ) : (
                        selectedPaths.map((path) => (
                          <button
                            key={path}
                            type="button"
                            className="node-settings__chip"
                            onClick={() => toggleSelected(path)}
                          >
                            <span>{pathLabel(path)}</span>
                            <X size={12} />
                          </button>
                        ))
                      )}
                    </div>

                    <div className="node-settings__actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleSavePaths()}
                        disabled={busyAction !== null || nodeOffline}
                      >
                        {busyAction === "paths" ? "Saving..." : "Save folders"}
                      </button>
                    </div>
                  </div>
                  ) : (
                    <div className="node-settings__section">
                      <div className="node-settings__section-head">
                        <div>
                          <div className="node-settings__section-title">Advertised agents</div>
                          <p className="node-settings__copy">
                            Start sessions directly from the agents currently exposed by this node, including folder-scoped variants.
                          </p>
                        </div>
                        <div className="node-settings__stat">{sortedAgents.length} agents</div>
                      </div>

                      {sortedAgents.length === 0 ? (
                        <div className="node-settings__empty">No agents advertised yet.</div>
                      ) : (
                        <ul className="node-settings__agent-list">
                          {sortedAgents.map((agent) => {
                            const cwd =
                              typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
                            const errorDetail =
                              typeof agent.capabilities.error === "string"
                                ? agent.capabilities.error
                                : null;
                            const disabled = agent.status !== "online" || nodeOffline;
                            return (
                              <li key={agent.id} className="node-settings__agent-row">
                                <div className="node-settings__agent-body">
                                  <div className="node-settings__agent-name">{agent.name}</div>
                                  <div className="node-settings__agent-meta">
                                    <span>{agent.id}</span>
                                    {cwd ? (
                                      <>
                                        <span aria-hidden>·</span>
                                        <span>{cwd}</span>
                                      </>
                                    ) : null}
                                  </div>
                                  {errorDetail ? (
                                    <div className="node-settings__agent-error">{errorDetail}</div>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={disabled}
                                  onClick={() => {
                                    if (disabled) return;
                                    setOpen(false);
                                    const folder =
                                      typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : undefined;
                                    void navigate({
                                      to: "/sessions",
                                      search: {
                                        node: agent.nodeId,
                                        folder,
                                        launchAgent: agent.id,
                                        session: undefined,
                                        agent: undefined
                                      }
                                    });
                                  }}
                                >
                                  Open chat
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="node-settings__section">
                    <div className="node-settings__section-head">
                      <div>
                        <div className="node-settings__section-title">Maintenance</div>
                        <p className="node-settings__copy">
                          Refresh agent discovery or request a node update without leaving this surface.
                        </p>
                      </div>
                    </div>
                    <div className="node-settings__maintenance">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Detect agents on ${node.name}`}
                        onClick={() => void handleDetectAgents()}
                        disabled={busyAction !== null || nodeOffline}
                      >
                        {busyAction === "detect" ? "Detecting..." : "Detect agents"}
                      </button>
                      {node.updateRequired ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Update ${node.name}`}
                          onClick={() => void handleUpdateNode()}
                          disabled={busyAction !== null || nodeOffline}
                        >
                          {busyAction === "update" ? "Updating..." : "Update node"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {message ? <div className="node-settings__message">{message}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
