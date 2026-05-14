import { useEffect, useState } from "react";

import { EmptyState } from "../components/EmptyState.js";
import { NarrowFallback } from "../components/NarrowFallback.js";
import { TopologyCanvas } from "../components/TopologyCanvas.js";
import type { TopologySnapshot } from "@amesh/protocol";

const NARROW_BREAKPOINT = 1024;

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
    const handler = (event: MediaQueryListEvent | MediaQueryList) =>
      setIsNarrow("matches" in event ? event.matches : query.matches);
    handler(query);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return isNarrow;
}

type Props = {
  topology: TopologySnapshot;
};

export function TopologyRoute({ topology }: Props) {
  const isNarrow = useIsNarrow();

  if (topology.nodes.length === 0 && topology.agents.length === 0) {
    return (
      <section className="topology-route" aria-label="Topology">
        <EmptyState />
      </section>
    );
  }

  if (isNarrow) {
    return (
      <section className="topology-route" aria-label="Topology">
        <NarrowFallback topology={topology} />
      </section>
    );
  }

  return (
    <section className="topology-route" aria-label="Topology">
      <TopologyCanvas topology={topology} />
    </section>
  );
}
