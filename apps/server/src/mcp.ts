import { McpServer } from "@modelcontextprotocol/server";
import { nanoid } from "nanoid";
import * as z from "zod";

import type { ProtocolEnvelope, SessionRecord } from "@amesh/protocol";

import type { Repository } from "./repository.js";

type NodeSocket = {
  nodeId: string;
  send: (message: ProtocolEnvelope) => void;
};

export type McpScope = {
  authMode: "admin_password" | "browser_session" | "registration_token";
  scopedAgentId: string | null;
  scopedNodeId: string | null;
};

type BuildAmeshMcpServerDeps = {
  repository: Repository;
  nodeSockets: Map<string, NodeSocket>;
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void;
};

const sessionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

const sessionFiltersSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  sourceAgentId: z.string().trim().min(1).optional(),
  parentSessionId: z.string().trim().min(1).optional(),
  status: sessionStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25)
});

const listAgentsSchema = z.object({
  nodeId: z.string().trim().min(1).optional(),
  status: z.enum(["online", "offline", "error"]).optional()
});

const listConnectedAgentsSchema = z.object({
  sourceAgentId: z.string().trim().min(1).optional()
});

const startSessionSchema = z.object({
  targetAgentId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  cwd: z.string().trim().min(1).optional(),
  sourceAgentId: z.string().trim().min(1).optional(),
  parentSessionId: z.string().trim().min(1).optional()
});

const sessionIdSchema = z.object({
  sessionId: z.string().trim().min(1)
});

function stableJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function toolResult(data: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: stableJson(data)
      }
    ],
    structuredContent: data
  };
}

function resolveSourceAgentId(scope: McpScope, requestedSourceAgentId?: string) {
  if (scope.scopedAgentId) {
    if (requestedSourceAgentId && requestedSourceAgentId !== scope.scopedAgentId) {
      throw new Error(`caller is scoped to ${scope.scopedAgentId}`);
    }
    return scope.scopedAgentId;
  }
  return requestedSourceAgentId ?? null;
}

function visibleSession(scope: McpScope, session: SessionRecord) {
  if (!scope.scopedAgentId) {
    return true;
  }
  return session.entryAgentId === scope.scopedAgentId || session.sourceAgentId === scope.scopedAgentId;
}

function filteredAgents(scope: McpScope, repository: Repository) {
  const topology = repository.listTopology();
  if (!scope.scopedAgentId) {
    return topology.agents;
  }

  const connectedIds = new Set<string>([scope.scopedAgentId]);
  for (const rule of topology.triggerRules) {
    if (rule.mode === "allow" && rule.sourceAgentId === scope.scopedAgentId) {
      connectedIds.add(rule.targetAgentId);
    }
  }
  return topology.agents.filter((agent) => connectedIds.has(agent.id));
}

function resolveTargetCwd(
  repository: Repository,
  targetAgentId: string,
  requestedCwd?: string
) {
  const agent = repository.findAgent(targetAgentId);
  if (!agent) {
    throw new Error(`agent not found: ${targetAgentId}`);
  }

  const fixedCwd = typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
  const cwd = requestedCwd ?? fixedCwd ?? null;
  const node = repository.findNode(agent.nodeId);
  if (!node) {
    throw new Error(`node not found for agent: ${targetAgentId}`);
  }
  if (requestedCwd && requestedCwd !== fixedCwd && !node.paths.includes(requestedCwd)) {
    throw new Error(`folder is not exposed on node: ${requestedCwd}`);
  }

  return { agent, node, cwd };
}

function ensureTargetNodeOnline(
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  targetAgentId: string
) {
  const agent = repository.findAgent(targetAgentId);
  if (!agent) {
    throw new Error(`agent not found: ${targetAgentId}`);
  }
  const node = repository.findNode(agent.nodeId);
  if (!node) {
    throw new Error(`node not found for agent: ${targetAgentId}`);
  }
  if (node.status !== "online" || !nodeSockets.has(node.id)) {
    throw new Error(`node is offline for agent: ${targetAgentId}`);
  }
  return agent;
}

function startUserSession(
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void,
  args: z.infer<typeof startSessionSchema>
) {
  const { agent, cwd } = resolveTargetCwd(repository, args.targetAgentId, args.cwd);
  ensureTargetNodeOnline(repository, nodeSockets, args.targetAgentId);

  const session = repository.createSession({
    entryAgentId: args.targetAgentId,
    initiator: "user",
    cwd
  });
  repository.updateSessionStatus(session.id, "running");
  repository.appendSessionEvent({
    sessionId: session.id,
    eventType: "session.created",
    sourceAgentId: null,
    targetAgentId: args.targetAgentId,
    payload: {
      prompt: args.prompt,
      via: "mcp"
    }
  });

  sendToNode(agent.nodeId, {
    type: "session.start",
    requestId: nanoid(10),
    sessionId: session.id,
    source: "server",
    target: agent.nodeId,
    payload: {
      sessionId: session.id,
      agentId: args.targetAgentId,
      prompt: args.prompt,
      initiator: "user",
      cwd,
      parentSessionId: null
    }
  });

  const state = repository.getSession(session.id);
  if (!state) {
    throw new Error(`session disappeared after creation: ${session.id}`);
  }
  return state;
}

function startAgentSession(
  scope: McpScope,
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void,
  args: z.infer<typeof startSessionSchema>
) {
  const sourceAgentId = resolveSourceAgentId(scope, args.sourceAgentId);
  if (!sourceAgentId) {
    throw new Error("sourceAgentId is required for agent-initiated sessions");
  }
  if (!repository.canInvoke(sourceAgentId, args.targetAgentId)) {
    if (args.parentSessionId) {
      repository.appendSessionEvent({
        sessionId: args.parentSessionId,
        eventType: "session.invocation.denied",
        sourceAgentId,
        targetAgentId: args.targetAgentId,
        payload: {
          reason: "missing_allow_rule",
          via: "mcp"
        }
      });
    }
    throw new Error(`missing allow rule from ${sourceAgentId} to ${args.targetAgentId}`);
  }

  const parent = args.parentSessionId ? repository.getSession(args.parentSessionId) : null;
  if (args.parentSessionId && !parent) {
    throw new Error(`parent session not found: ${args.parentSessionId}`);
  }
  if (
    parent &&
    parent.session.entryAgentId !== sourceAgentId &&
    parent.session.sourceAgentId !== sourceAgentId
  ) {
    throw new Error(`parent session ${args.parentSessionId} is not visible to ${sourceAgentId}`);
  }

  const { agent, cwd } = resolveTargetCwd(repository, args.targetAgentId, args.cwd);
  ensureTargetNodeOnline(repository, nodeSockets, args.targetAgentId);

  if (args.parentSessionId) {
    repository.appendSessionEvent({
      sessionId: args.parentSessionId,
      eventType: "session.invocation.requested",
      sourceAgentId,
      targetAgentId: args.targetAgentId,
      payload: {
        parentSessionId: args.parentSessionId,
        sourceAgentId,
        targetAgentId: args.targetAgentId,
        prompt: args.prompt,
        via: "mcp"
      }
    });
  }

  const childSession = repository.createLinkedSession({
    entryAgentId: args.targetAgentId,
    initiator: "agent",
    cwd,
    parentSessionId: args.parentSessionId ?? null,
    sourceAgentId
  });
  repository.updateSessionStatus(childSession.id, "running");

  if (args.parentSessionId) {
    repository.appendSessionEvent({
      sessionId: args.parentSessionId,
      eventType: "session.invocation.allowed",
      sourceAgentId,
      targetAgentId: args.targetAgentId,
      payload: {
        childSessionId: childSession.id,
        via: "mcp"
      }
    });
  }

  sendToNode(agent.nodeId, {
    type: "session.start",
    requestId: nanoid(10),
    sessionId: childSession.id,
    source: "server",
    target: agent.nodeId,
    payload: {
      sessionId: childSession.id,
      agentId: args.targetAgentId,
      prompt: args.prompt,
      initiator: "agent",
      cwd,
      parentSessionId: args.parentSessionId ?? null
    }
  });

  const state = repository.getSession(childSession.id);
  if (!state) {
    throw new Error(`session disappeared after creation: ${childSession.id}`);
  }
  return state;
}

export function buildAmeshMcpServer(scope: McpScope, deps: BuildAmeshMcpServerDeps) {
  const server = new McpServer({
    name: "amesh-control",
    version: "0.1.0"
  });

  server.registerTool(
    "get_scope",
    {
      description: "Return the MCP caller scope Amesh resolved for this session."
    },
    async () =>
      toolResult({
        authMode: scope.authMode,
        scopedAgentId: scope.scopedAgentId,
        scopedNodeId: scope.scopedNodeId
      })
  );

  server.registerTool(
    "list_agents",
    {
      description:
        "List Amesh agents visible to this caller. Scoped callers see themselves and their allowed downstream agents.",
      inputSchema: listAgentsSchema
    },
    async (rawArgs: unknown) => {
      const args = listAgentsSchema.parse(rawArgs);
      const agents = filteredAgents(scope, deps.repository).filter((agent) => {
        if (args.nodeId && agent.nodeId !== args.nodeId) {
          return false;
        }
        if (args.status && agent.status !== args.status) {
          return false;
        }
        return true;
      });
      return toolResult({ agents });
    }
  );

  server.registerTool(
    "list_connected_agents",
    {
      description:
        "List agents the source agent is explicitly allowed to invoke through Amesh trigger rules.",
      inputSchema: listConnectedAgentsSchema
    },
    async (rawArgs: unknown) => {
      const args = listConnectedAgentsSchema.parse(rawArgs);
      const sourceAgentId = resolveSourceAgentId(scope, args.sourceAgentId);
      if (!sourceAgentId) {
        throw new Error("sourceAgentId is required when the MCP session is not scoped to an agent");
      }

      const topology = deps.repository.listTopology();
      const targetIds = new Set(
        topology.triggerRules
          .filter((rule) => rule.mode === "allow" && rule.sourceAgentId === sourceAgentId)
          .map((rule) => rule.targetAgentId)
      );
      const agents = topology.agents.filter((agent) => targetIds.has(agent.id));
      return toolResult({ sourceAgentId, agents });
    }
  );

  server.registerTool(
    "start_session",
    {
      description:
        "Start a new Amesh session against a target agent. Scoped callers may start agent-initiated child sessions with optional parentSessionId lineage.",
      inputSchema: startSessionSchema
    },
    async (rawArgs: unknown) => {
      const args = startSessionSchema.parse(rawArgs);
      const state =
        scope.scopedAgentId || args.sourceAgentId
          ? startAgentSession(scope, deps.repository, deps.nodeSockets, deps.sendToNode, args)
          : startUserSession(deps.repository, deps.nodeSockets, deps.sendToNode, args);
      return toolResult(state as unknown as Record<string, unknown>);
    }
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "List recent Amesh sessions visible to this caller. Scoped callers only see sessions they entered or launched.",
      inputSchema: sessionFiltersSchema
    },
    async (rawArgs: unknown) => {
      const args = sessionFiltersSchema.parse(rawArgs);
      const sessions = deps.repository
        .listSessions()
        .filter((session) => visibleSession(scope, session))
        .filter((session) => {
          if (args.agentId && session.entryAgentId !== args.agentId) {
            return false;
          }
          if (args.sourceAgentId && session.sourceAgentId !== args.sourceAgentId) {
            return false;
          }
          if (args.parentSessionId && session.parentSessionId !== args.parentSessionId) {
            return false;
          }
          if (args.status && session.status !== args.status) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, args.limit);
      return toolResult({ sessions });
    }
  );

  server.registerTool(
    "get_session",
    {
      description: "Return one Amesh session with its event history.",
      inputSchema: sessionIdSchema
    },
    async (rawArgs: unknown) => {
      const args = sessionIdSchema.parse(rawArgs);
      const state = deps.repository.getSession(args.sessionId);
      if (!state) {
        throw new Error(`session not found: ${args.sessionId}`);
      }
      if (!visibleSession(scope, state.session)) {
        throw new Error(`session is not visible to this caller: ${args.sessionId}`);
      }
      return toolResult(state as unknown as Record<string, unknown>);
    }
  );

  server.registerTool(
    "cancel_session",
    {
      description: "Cancel a running Amesh session.",
      inputSchema: sessionIdSchema
    },
    async (rawArgs: unknown) => {
      const args = sessionIdSchema.parse(rawArgs);
      const state = deps.repository.getSession(args.sessionId);
      if (!state) {
        throw new Error(`session not found: ${args.sessionId}`);
      }
      if (!visibleSession(scope, state.session)) {
        throw new Error(`session is not visible to this caller: ${args.sessionId}`);
      }

      const agent = deps.repository.findAgent(state.session.entryAgentId);
      if (!agent) {
        throw new Error(`entry agent missing for session: ${args.sessionId}`);
      }
      ensureTargetNodeOnline(deps.repository, deps.nodeSockets, agent.id);

      deps.repository.updateSessionStatus(state.session.id, "cancelled");
      deps.repository.appendSessionEvent({
        sessionId: state.session.id,
        eventType: "session.cancelled",
        sourceAgentId: scope.scopedAgentId,
        targetAgentId: agent.id,
        payload: {
          reason: "mcp_cancelled",
          via: "mcp"
        }
      });

      deps.sendToNode(agent.nodeId, {
        type: "session.cancel",
        requestId: nanoid(10),
        sessionId: state.session.id,
        source: "server",
        target: agent.nodeId,
        payload: {
          sessionId: state.session.id,
          agentId: agent.id,
          reason: "mcp_cancelled"
        }
      });

      const next = deps.repository.getSession(state.session.id);
      if (!next) {
        throw new Error(`session disappeared after cancellation: ${state.session.id}`);
      }
      return toolResult(next as unknown as Record<string, unknown>);
    }
  );

  return server;
}
