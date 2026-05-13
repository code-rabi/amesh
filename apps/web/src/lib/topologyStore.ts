import { useEffect, useRef, useState } from "react";
import type { NodeLogEntry, TopologySnapshot } from "@amesh/protocol";

import { connectRealtime, fetchTopology } from "../api.js";

const empty: TopologySnapshot = { nodes: [], agents: [], triggerRules: [] };

export type ConnectionState = "loading" | "connected" | "disconnected";

export function useTopologyStore() {
  const [topology, setTopology] = useState<TopologySnapshot>(empty);
  const [nodeLogs, setNodeLogs] = useState<Record<string, NodeLogEntry[]>>({});
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const refetchRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;

    const refetch = () => {
      fetchTopology()
        .then((snapshot) => {
          if (!active) return;
          setTopology(snapshot);
          setConnection((current) => (current === "disconnected" ? current : "connected"));
        })
        .catch(() => {
          if (!active) return;
          setConnection("disconnected");
        });
    };
    refetchRef.current = refetch;
    refetch();

    let socket: WebSocket | null = null;
    try {
      socket = connectRealtime((event) => {
        if (!active) return;
        if (event.type === "topology.snapshot" || event.type === "topology.updated") {
          setTopology(event.payload);
        }
        if (event.type === "node.logs.updated") {
          setNodeLogs((current) => ({
            ...current,
            [event.payload.nodeId]: event.payload.entries
          }));
        }
      });
      socket.onopen = () => active && setConnection("connected");
      socket.onerror = () => active && setConnection("disconnected");
      socket.onclose = () => active && setConnection("disconnected");
    } catch {
      setConnection("disconnected");
    }

    return () => {
      active = false;
      socket?.close();
    };
  }, []);

  return {
    topology,
    nodeLogs,
    setNodeLogs,
    connection,
    refresh: () => refetchRef.current()
  };
}
