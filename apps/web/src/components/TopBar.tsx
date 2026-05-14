import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { TopologySnapshot } from "@amesh/protocol";
import { AddNodePanel } from "./AddNodePanel.js";
import { BrandWordmark } from "./BrandWordmark.js";

type Props = {
  topology: TopologySnapshot;
};

export function TopBar({ topology }: Props) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar__identity">
        <Link to="/" className="wordmark" aria-label="AMESH home">
          <BrandWordmark />
        </Link>
      </div>

      <div className="fleet-summary" aria-label="fleet summary">
        <b>{topology.nodes.length}</b>
        <span>{topology.nodes.length === 1 ? "node" : "nodes"}</span>
        <span className="dot" aria-hidden />
        <b>{topology.agents.length}</b>
        <span>{topology.agents.length === 1 ? "agent" : "agents"}</span>
        <span className="dot" aria-hidden />
        <b>{topology.triggerRules.length}</b>
        <span>{topology.triggerRules.length === 1 ? "rule" : "rules"}</span>
      </div>

      <div className="topbar__actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAddOpen((open) => !open)}
          aria-expanded={addOpen}
          aria-haspopup="dialog"
        >
          {addOpen ? "Close" : "Add Node"}
        </button>
      </div>

      {addOpen ? (
        <AddNodePanel waitingForNodes={topology.nodes.length === 0} onClose={() => setAddOpen(false)} />
      ) : null}
    </header>
  );
}
