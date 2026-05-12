import { useEffect, useMemo, useState } from "react";
import type { AgentRecord, NodeRecord } from "@amesh/protocol";

import { updateNodePaths } from "../api.js";
import { useTopology } from "../lib/topologyContext.js";

type Props = {
  node: NodeRecord;
  agents: AgentRecord[];
  compact?: boolean;
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

export function NodePathsButton({ node, agents, compact = false }: Props) {
  const { refresh } = useTopology();
  const currentPaths = useMemo(() => extractPaths(agents), [agents]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const disabled = busy || node.status !== "online";

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(currentPaths.join("\n"));
    setMessage(null);
  }, [open, currentPaths]);

  async function handleSave() {
    if (disabled) {
      return;
    }

    const paths = draft
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);

    setBusy(true);
    setMessage(null);
    try {
      await updateNodePaths(node.id, paths);
      setMessage("Exposed folders updated.");
      setOpen(false);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update exposed paths.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`node-update ${compact ? "node-update--compact" : ""}`}>
      <button
        type="button"
        className="node-update__button"
        aria-label={`Manage exposed paths on ${node.name}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide paths" : currentPaths.length > 0 ? `Paths (${currentPaths.length})` : "Set paths"}
      </button>
      {open ? (
        <div className="node-paths__panel" role="dialog" aria-label={`Manage exposed paths for ${node.name}`}>
          <p className="node-paths__copy">
            Expose one directory per line. Sessions can start any advertised agent in one of these folders.
          </p>
          <label className="node-paths__label" htmlFor={`node-paths-${node.id}`}>
            Exposed directories
          </label>
          <textarea
            id={`node-paths-${node.id}`}
            className="node-paths__textarea"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={"/srv/work/repo-a\n/srv/work/repo-b"}
          />
          <div className="node-paths__actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy}>
              {busy ? "Saving..." : "Save paths"}
            </button>
          </div>
        </div>
      ) : null}
      {message ? <div className="node-update__message">{message}</div> : null}
    </div>
  );
}
