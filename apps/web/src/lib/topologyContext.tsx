import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { NodeLogEntry, TopologySnapshot } from "@amesh/protocol";

import { type ConnectionState, useTopologyStore } from "./topologyStore.js";

type TopologyContextValue = {
  topology: TopologySnapshot;
  nodeLogs: Record<string, NodeLogEntry[]>;
  setNodeLogs: Dispatch<SetStateAction<Record<string, NodeLogEntry[]>>>;
  connection: ConnectionState;
  refresh: () => void;
};

const TopologyContext = createContext<TopologyContextValue | null>(null);

export function TopologyProvider({ children }: { children: ReactNode }) {
  const store = useTopologyStore();
  return <TopologyContext.Provider value={store}>{children}</TopologyContext.Provider>;
}

export function useTopology(): TopologyContextValue {
  const value = useContext(TopologyContext);
  if (!value) {
    throw new Error("useTopology must be used inside <TopologyProvider>");
  }
  return value;
}
