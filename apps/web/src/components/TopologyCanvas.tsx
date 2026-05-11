import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type IsValidConnection
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TopologySnapshot, TriggerMode } from "@amesh/protocol";

import { createTriggerRule, deleteTriggerRule } from "../api.js";
import { layoutTopology } from "../lib/elkLayout.js";
import { NodeCard, type NodeCardData } from "./NodeCard.js";
import { TriggerEdge, type TriggerEdgeData } from "./TriggerEdge.js";

type Props = {
  topology: TopologySnapshot;
};

type NodeCardNode = Node<{ data: NodeCardData }, "nodeCard">;
type TriggerEdgeRecord = Edge<{ data: TriggerEdgeData }, "trigger">;

const nodeTypes = { nodeCard: NodeCard };
const edgeTypes = { trigger: TriggerEdge };

function edgeStyle(mode: TriggerMode) {
  if (mode === "deny") {
    return {
      stroke: "var(--c-denied)",
      strokeDasharray: "4 4"
    } as const;
  }
  return { stroke: "var(--c-accent)" } as const;
}

export function TopologyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ topology }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeCardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TriggerEdgeRecord>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const agentsById = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent])),
    [topology.agents]
  );

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const unknown = topology.nodes.filter((node) => !positionsRef.current.has(node.id));
      if (unknown.length > 0 || positionsRef.current.size === 0) {
        const computed = await layoutTopology(topology);
        if (cancelled) return;
        for (const [id, position] of computed) {
          if (!positionsRef.current.has(id)) {
            positionsRef.current.set(id, position);
          }
        }
      }

      const livingIds = new Set(topology.nodes.map((n) => n.id));
      for (const id of [...positionsRef.current.keys()]) {
        if (!livingIds.has(id)) positionsRef.current.delete(id);
      }

      const nextNodes: NodeCardNode[] = topology.nodes.map((node) => {
        const position = positionsRef.current.get(node.id) ?? { x: 0, y: 0 };
        const agents = topology.agents.filter((agent) => agent.nodeId === node.id);
        return {
          id: node.id,
          type: "nodeCard",
          position,
          data: { data: { node, agents } } as { data: NodeCardData },
          draggable: true
        };
      });

      setNodes((current) => {
        const indexed = new Map(current.map((n) => [n.id, n]));
        return nextNodes.map((next) => {
          const existing = indexed.get(next.id);
          if (!existing) return next;
          return { ...next, position: existing.position ?? next.position };
        });
      });
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [topology, setNodes]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }

  useEffect(() => {
    const flip = async (sourceAgent: string, targetAgent: string, current: TriggerMode) => {
      try {
        await createTriggerRule({
          sourceAgentId: sourceAgent,
          targetAgentId: targetAgent,
          mode: current === "allow" ? "deny" : "allow"
        });
      } catch {
        showToast("Could not update rule.");
      }
    };

    const remove = async (ruleId: string) => {
      try {
        await deleteTriggerRule(ruleId);
      } catch {
        showToast("Could not remove rule.");
      }
    };

    const next: TriggerEdgeRecord[] = topology.triggerRules
      .map((rule) => {
        const source = agentsById.get(rule.sourceAgentId);
        const target = agentsById.get(rule.targetAgentId);
        if (!source || !target) return null;

        const data: TriggerEdgeData = {
          mode: rule.mode,
          sourceAgentName: source.name,
          targetAgentName: target.name,
          onFlip: () => flip(rule.sourceAgentId, rule.targetAgentId, rule.mode),
          onRemove: () => remove(rule.id)
        };

        const edge: TriggerEdgeRecord = {
          id: rule.id,
          type: "trigger",
          source: source.nodeId,
          target: target.nodeId,
          sourceHandle: source.id,
          targetHandle: target.id,
          data: { data },
          style: edgeStyle(rule.mode),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: rule.mode === "allow" ? "var(--c-accent)" : "var(--c-denied)"
          }
        };
        return edge;
      })
      .filter((edge): edge is TriggerEdgeRecord => edge !== null);

    setEdges(next);
  }, [topology, agentsById, setEdges]);

  const onConnect: OnConnect = useCallback(
    async (params: Connection) => {
      const sourceAgentId = params.sourceHandle;
      const targetAgentId = params.targetHandle;
      if (!sourceAgentId || !targetAgentId) return;
      if (sourceAgentId === targetAgentId) {
        showToast("An agent cannot trigger itself.");
        return;
      }

      const existing = topology.triggerRules.find(
        (rule) =>
          rule.sourceAgentId === sourceAgentId && rule.targetAgentId === targetAgentId
      );
      if (existing && existing.mode === "allow") {
        showToast("Already connected. Click the edge to change.");
        return;
      }

      try {
        await createTriggerRule({
          sourceAgentId,
          targetAgentId,
          mode: "allow"
        });
      } catch {
        showToast("Could not create rule.");
      }
    },
    [topology.triggerRules]
  );

  const isValidConnection: IsValidConnection = useCallback((connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return false;
    return connection.sourceHandle !== connection.targetHandle;
  }, []);

  return (
    <>
      <ReactFlow
        className="topology-canvas"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{
          stroke: "var(--c-accent)",
          strokeWidth: 1.5,
          strokeDasharray: "4 4"
        }}
      >
        <Background gap={24} size={1} color="var(--c-line)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}
