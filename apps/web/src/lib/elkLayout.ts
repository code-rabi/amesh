import * as ElkModule from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { TopologySnapshot } from "@amesh/protocol";
import { agentCanOrchestrate, getAgentNodeId } from "./agentRoles.js";

type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
type ElkCtor = new () => ElkInstance;

const ElkConstructor = ((ElkModule as unknown as { default?: ElkCtor }).default ??
  (ElkModule as unknown as ElkCtor)) as ElkCtor;

const elk = new ElkConstructor();

const NODE_WIDTH = 240;
const HEADER_HEIGHT = 78;
const AGENT_ROW_HEIGHT = 56;
const MIN_HEIGHT = 120;

function nodeHeight(agentCount: number): number {
  if (agentCount === 0) return MIN_HEIGHT;
  return HEADER_HEIGHT + agentCount * AGENT_ROW_HEIGHT + 8;
}

export async function layoutTopology(
  snapshot: TopologySnapshot
): Promise<Map<string, { x: number; y: number }>> {
  const agentsByNode = new Map<string, number>();
  for (const agent of snapshot.agents) {
    const nodeId = getAgentNodeId(agent);
    if (!nodeId) continue;
    agentsByNode.set(nodeId, (agentsByNode.get(nodeId) ?? 0) + 1);
  }

  const agentToNode = new Map<string, string>();
  for (const agent of snapshot.agents) {
    const nodeId = getAgentNodeId(agent);
    if (nodeId) {
      agentToNode.set(agent.id, nodeId);
      continue;
    }
    if (agentCanOrchestrate(agent)) {
      agentToNode.set(agent.id, `agent:${agent.id}`);
    }
  }

  const elkNodes: ElkNode[] = [
    ...snapshot.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: nodeHeight(agentsByNode.get(node.id) ?? 0)
    })),
    ...snapshot.agents
      .filter((agent) => getAgentNodeId(agent) === null && agentCanOrchestrate(agent))
      .map((agent) => ({
        id: `agent:${agent.id}`,
        width: NODE_WIDTH,
        height: nodeHeight(1)
      }))
  ];

  const edges = snapshot.triggerRules
    .map((rule) => ({
      source: agentToNode.get(rule.sourceAgentId),
      target: agentToNode.get(rule.targetAgentId)
    }))
    .filter((edge): edge is { source: string; target: string } =>
      Boolean(edge.source && edge.target && edge.source !== edge.target)
    )
    .map((edge, index) => ({
      id: `e${index}`,
      sources: [edge.source],
      targets: [edge.target]
    }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "60",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]"
    },
    children: elkNodes,
    edges
  };

  try {
    const result = await elk.layout(graph);
    const positions = new Map<string, { x: number; y: number }>();
    for (const child of result.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }
    return positions;
  } catch {
    const positions = new Map<string, { x: number; y: number }>();
    elkNodes.forEach((node, index) => {
      positions.set(node.id, { x: (index % 3) * 320, y: Math.floor(index / 3) * 280 });
    });
    return positions;
  }
}
