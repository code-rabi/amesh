import { useState } from "react";
import type { NodeRecord } from "@amesh/protocol";

import { requestNodeUpdate } from "../api.js";
import { useTopology } from "../lib/topologyContext.js";

type Props = {
  node: NodeRecord;
  compact?: boolean;
};

export function NodeUpdateButton({ node, compact = false }: Props) {
  const { refresh } = useTopology();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!node.updateRequired) {
    return null;
  }

  const disabled = busy || node.status !== "online";

  async function handleClick() {
    if (disabled) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await requestNodeUpdate(node.id);
      setMessage("Update requested. The node should reconnect after restart.");
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`node-update ${compact ? "node-update--compact" : ""}`}>
      <button
        type="button"
        className="node-update__button"
        aria-label={`Update ${node.name}`}
        disabled={disabled}
        onClick={handleClick}
      >
        {busy ? "Updating..." : "Update node"}
      </button>
      {message ? <div className="node-update__message">{message}</div> : null}
    </div>
  );
}
