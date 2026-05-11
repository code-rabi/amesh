import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import type { TopologySnapshot } from "@amesh/protocol";
import { AddNodePanel } from "./AddNodePanel.js";

type Props = {
  topology: TopologySnapshot;
};

export function TopBar({ topology }: Props) {
  const { location } = useRouterState();
  const [addOpen, setAddOpen] = useState(false);

  const path = location.pathname;
  const isTopology = path === "/" || path.startsWith("/topology");
  const isSessions = path.startsWith("/sessions");

  return (
    <header className="topbar">
      <Link to="/" className="wordmark" aria-label="amesh home">
        amesh
      </Link>

      <nav className="routenav" aria-label="primary">
        <Link to="/" data-active={isTopology}>
          Topology
        </Link>
        <Link to="/sessions" data-active={isSessions}>
          Sessions
        </Link>
      </nav>

      <span />

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

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setAddOpen((open) => !open)}
        aria-expanded={addOpen}
      >
        {addOpen ? "Close" : "Add Node"}
      </button>

      {addOpen ? (
        <AddNodePanel
          waitingForNodes={topology.nodes.length === 0}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </header>
  );
}
