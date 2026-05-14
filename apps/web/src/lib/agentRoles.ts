import type { AgentRecord } from "@amesh/protocol";

type AgentRoleKey = "orchestrator" | "controlled";

type AgentWithRoles = AgentRecord & Partial<Record<AgentRoleKey, boolean>> & {
  hostKind?: string;
  executionName?: string;
  nodeId?: string | null;
};

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function getAgentNodeId(agent: AgentRecord | null | undefined): string | null {
  if (!agent) return null;
  const nodeId = (agent as AgentWithRoles).nodeId;
  return typeof nodeId === "string" && nodeId.length > 0 ? nodeId : null;
}

export function agentCanOrchestrate(agent: AgentRecord | null | undefined): boolean {
  if (!agent) return false;
  const explicit = readBoolean((agent as AgentWithRoles).orchestrator);
  if (explicit !== null) return explicit;
  return true;
}

export function agentCanBeControlled(agent: AgentRecord | null | undefined): boolean {
  if (!agent) return false;
  const explicit = readBoolean((agent as AgentWithRoles).controlled);
  if (explicit !== null) return explicit;
  return getAgentNodeId(agent) !== null;
}

export function agentCanLaunchSessions(agent: AgentRecord | null | undefined): boolean {
  return agentCanBeControlled(agent) && getAgentNodeId(agent) !== null;
}

export function agentRoleBadges(agent: AgentRecord | null | undefined): string[] {
  if (!agent) return [];
  const badges: string[] = [];
  if (agentCanOrchestrate(agent)) badges.push("Orch");
  if (agentCanLaunchSessions(agent)) badges.push("Ctrl");
  return badges;
}

export function agentSecondaryLabel(agent: AgentRecord | null | undefined): string | null {
  if (!agent) return null;
  const withRoles = agent as AgentWithRoles;
  if (typeof withRoles.executionName === "string" && withRoles.executionName.length > 0) {
    return withRoles.executionName;
  }
  if (typeof withRoles.hostKind === "string" && withRoles.hostKind.length > 0) {
    return withRoles.hostKind;
  }
  return null;
}
