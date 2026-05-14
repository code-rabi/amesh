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
import {
  agentCanBeControlled,
  agentCanOrchestrate,
  getAgentNodeId
} from "../lib/agentRoles.js";
import { layoutTopology } from "../lib/elkLayout.js";
import { NodeCard, type NodeCardData } from "./NodeCard.js";
import { StandaloneAgentCard, type StandaloneAgentCardData } from "./StandaloneAgentCard.js";
import { TriggerEdge, type TriggerEdgeData } from "./TriggerEdge.js";

type Props = {
  topology: TopologySnapshot;
};

type NodeCardNode = Node<{ data: NodeCardData }, "nodeCard">;
type StandaloneAgentNode = Node<{ data: StandaloneAgentCardData }, "standaloneAgentCard">;
type TopologyCanvasNode = NodeCardNode | StandaloneAgentNode;
type TriggerEdgeRecord = Edge<{ data: TriggerEdgeData }, "trigger">;

const nodeTypes = { nodeCard: NodeCard, standaloneAgentCard: StandaloneAgentCard };
const edgeTypes = { trigger: TriggerEdge };

function topologyCardIdForAgent(agent: TopologySnapshot["agents"][number]): string | null {
  const nodeId = getAgentNodeId(agent);
  if (nodeId) return nodeId;
  if (agentCanOrchestrate(agent)) return `agent:${agent.id}`;
  return null;
}

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
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyCanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TriggerEdgeRecord>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [connectionSourceAgentId, setConnectionSourceAgentId] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const agentsById = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent])),
    [topology.agents]
  );
  const connectionSourceAgentName =
    connectionSourceAgentId ? agentsById.get(connectionSourceAgentId)?.name ?? null : null;

  const createAllowRule = useCallback(
    async (sourceAgentId: string, targetAgentId: string) => {
      if (sourceAgentId === targetAgentId) {
        showToast("An agent cannot trigger itself.");
        return false;
      }

      const existing = topology.triggerRules.find(
        (rule) =>
          rule.sourceAgentId === sourceAgentId && rule.targetAgentId === targetAgentId
      );
      const source = agentsById.get(sourceAgentId);
      const target = agentsById.get(targetAgentId);
      if (!source || !target) {
        showToast("Agent is no longer available.");
        return false;
      }
      if (!agentCanOrchestrate(source)) {
        showToast(`${source.name} cannot originate trigger rules.`);
        return false;
      }
      if (!agentCanBeControlled(target)) {
        showToast(`${target.name} cannot receive delegated work.`);
        return false;
      }
      if (existing && existing.mode === "allow") {
        showToast("Already connected. Click the edge to change.");
        return false;
      }

      try {
        await createTriggerRule({
          sourceAgentId,
          targetAgentId,
          mode: "allow"
        });
        return true;
      } catch {
        showToast("Could not create rule.");
        return false;
      }
    },
    [agentsById, topology.triggerRules]
  );

  const pickConnectionEndpoint = useCallback(
    async (agent: TopologySnapshot["agents"][number]) => {
      if (!connectionSourceAgentId) {
        if (!agentCanOrchestrate(agent)) {
          showToast(`${agent.name} cannot originate trigger rules.`);
          return;
        }
        setConnectionSourceAgentId(agent.id);
        showToast(`Pick a target for ${agent.name}.`);
        return;
      }
      if (connectionSourceAgentId === agent.id) {
        setConnectionSourceAgentId(null);
        showToast("Connection cancelled.");
        return;
      }
      if (!agentCanBeControlled(agent)) {
        showToast(`${agent.name} cannot receive delegated work.`);
        return;
      }
      const created = await createAllowRule(connectionSourceAgentId, agent.id);
      if (created) {
        setConnectionSourceAgentId(null);
        showToast("Rule created.");
      }
    },
    [connectionSourceAgentId, createAllowRule]
  );

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const standaloneAgents = topology.agents.filter(
        (agent) => getAgentNodeId(agent) === null && agentCanOrchestrate(agent)
      );
      const livingCardIds = new Set<string>([
        ...topology.nodes.map((node) => node.id),
        ...standaloneAgents.map((agent) => `agent:${agent.id}`)
      ]);
      const unknown = [...livingCardIds].filter((id) => !positionsRef.current.has(id));
      if (unknown.length > 0 || positionsRef.current.size === 0) {
        const computed = await layoutTopology(topology);
        if (cancelled) return;
        for (const [id, position] of computed) {
          if (!positionsRef.current.has(id)) {
            positionsRef.current.set(id, position);
          }
        }
      }

      for (const id of [...positionsRef.current.keys()]) {
        if (!livingCardIds.has(id)) positionsRef.current.delete(id);
      }

      const nextNodes: NodeCardNode[] = topology.nodes.map((node) => {
        const position = positionsRef.current.get(node.id) ?? { x: 0, y: 0 };
        const agents = topology.agents.filter((agent) => getAgentNodeId(agent) === node.id);
        return {
          id: node.id,
          type: "nodeCard",
          position,
          data: {
            data: {
              node,
              agents,
              connectionSourceAgentId,
              connectionSourceAgentName,
              onConnectionPick: pickConnectionEndpoint
            }
          } as { data: NodeCardData },
          draggable: true
        };
      });

      const nextStandaloneNodes: StandaloneAgentNode[] = standaloneAgents.map((agent) => {
        const cardId = `agent:${agent.id}`;
        const position = positionsRef.current.get(cardId) ?? { x: 0, y: 0 };
        return {
          id: cardId,
          type: "standaloneAgentCard",
          position,
          data: {
            data: {
              agent,
              connectionSourceAgentId,
              connectionSourceAgentName,
              onConnectionPick: pickConnectionEndpoint
            }
          } as { data: StandaloneAgentCardData },
          draggable: true
        };
      });

      setNodes((current) => {
        const indexed = new Map(current.map((n) => [n.id, n]));
        return [...nextNodes, ...nextStandaloneNodes].map((next) => {
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
  }, [
    topology,
    setNodes,
    connectionSourceAgentId,
    connectionSourceAgentName,
    pickConnectionEndpoint
  ]);

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
        const sourceCardId = topologyCardIdForAgent(source);
        const targetCardId = topologyCardIdForAgent(target);
        if (!sourceCardId || !targetCardId) return null;

        const edge: TriggerEdgeRecord = {
          id: rule.id,
          type: "trigger",
          source: sourceCardId,
          target: targetCardId,
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
      await createAllowRule(sourceAgentId, targetAgentId);
    },
    [createAllowRule]
  );

  const isValidConnection: IsValidConnection = useCallback((connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return false;
    if (connection.sourceHandle === connection.targetHandle) return false;
    const source = agentsById.get(connection.sourceHandle);
    const target = agentsById.get(connection.targetHandle);
    if (!source || !target) return false;
    return agentCanOrchestrate(source) && agentCanBeControlled(target);
  }, [agentsById]);

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
