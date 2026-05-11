import { useState } from "react";
import type { NodeRecord } from "@amesh/protocol";

import { requestNodeDetect } from "../api.js";
import { useTopology } from "../lib/topologyContext.js";

type Props = {
  node: NodeRecord;
  compact?: boolean;
};

export function NodeDetectButton({ node, compact = false }: Props) {
  const { refresh } = useTopology();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const disabled = busy || node.status !== "online";

  async function handleClick() {
    if (disabled) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await requestNodeDetect(node.id);
      setMessage("Detection requested. The node will refresh its agent inventory.");
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request detection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`node-update ${compact ? "node-update--compact" : ""}`}>
      <button
        type="button"
        className="node-update__button"
        aria-label={`Detect agents on ${node.name}`}
        disabled={disabled}
        onClick={handleClick}
      >
        {busy ? "Detecting..." : "Detect agents"}
      </button>
      {message ? <div className="node-update__message">{message}</div> : null}
    </div>
  );
}
