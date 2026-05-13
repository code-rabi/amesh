import { useEffect, useMemo, useState } from "react";
import type { NodeLogEntry } from "@amesh/protocol";

import { fetchNodeLogs } from "../api.js";
import { useTopology } from "../lib/topologyContext.js";

const timeFormatter = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function formatLogTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return timeFormatter.format(parsed);
}

function levelLabel(level: NodeLogEntry["level"]) {
  return level.toUpperCase();
}

function compactContext(context: Record<string, unknown>) {
  const entries = Object.entries(context).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return "";
  }
  return entries
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
}

export function LogsRoute() {
  const { topology, nodeLogs, setNodeLogs } = useTopology();
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const selectedNode = useMemo(() => {
    return topology.nodes.find((node) => node.id === selectedNodeId) ?? topology.nodes[0] ?? null;
  }, [selectedNodeId, topology.nodes]);
  const entries = selectedNode ? nodeLogs[selectedNode.id] ?? [] : [];

  useEffect(() => {
    if (!selectedNodeId && topology.nodes[0]) {
      setSelectedNodeId(topology.nodes[0].id);
    }
  }, [selectedNodeId, topology.nodes]);

  useEffect(() => {
    if (!selectedNode) {
      return;
    }
    let active = true;
    fetchNodeLogs(selectedNode.id)
      .then((payload) => {
        if (!active) return;
        setError(null);
        setNodeLogs((current) => ({
          ...current,
          [payload.nodeId]: payload.entries
        }));
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Log fetch failed");
      });
    return () => {
      active = false;
    };
  }, [selectedNode, setNodeLogs]);

  return (
    <section className="logs-route" aria-label="Node logs">
      <header className="logs-route__header">
        <div>
          <p className="logs-route__eyebrow">Logs</p>
          <h1>Node activity</h1>
        </div>
        <label className="logs-route__selector">
          <span>Node</span>
          <select
            value={selectedNode?.id ?? ""}
            onChange={(event) => setSelectedNodeId(event.target.value)}
            disabled={topology.nodes.length === 0}
          >
            {topology.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? <div className="logs-route__error">{error}</div> : null}

      <div className="logs-route__stream" role="log" aria-live="polite" aria-label="Node log stream">
        {selectedNode ? (
          entries.length > 0 ? (
            entries.map((entry) => {
              const context = compactContext(entry.context);
              return (
                <article className="log-row" data-level={entry.level} key={entry.id}>
                  <time dateTime={entry.observedAt}>{formatLogTime(entry.observedAt)}</time>
                  <span className="log-row__level">{levelLabel(entry.level)}</span>
                  <div className="log-row__body">
                    <strong>{entry.message}</strong>
                    {context ? <code>{context}</code> : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="logs-route__empty">No node log entries yet.</div>
          )
        ) : (
          <div className="logs-route__empty">No nodes are registered.</div>
        )}
      </div>
    </section>
  );
}
