import type {
  AgentRecord,
  AgentStatus,
  BrowserRealtimeEvent,
  Capability,
  McpAgentRegistrationRequest,
  McpAgentRegistrationResponse,
  McpEnsureNodeRequest,
  NodeRecord,
  SessionEventRecord,
  SessionRecord,
  TopologySnapshot,
  TriggerRule,
  TriggerMode
} from "@amesh/protocol";
import {
  agentSchema,
  nodeSchema,
  sessionEventSchema,
  sessionSchema,
  triggerRuleSchema
} from "@amesh/protocol";
import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

import {
  agentsTable,
  nodesTable,
  sessionEventsTable,
  sessionsTable,
  triggerRulesTable
} from "./db/schema.js";

type Database = BetterSQLite3Database<Record<string, never>>;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeHostKind(value: string | null | undefined): AgentRecord["hostKind"] {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "codex" || normalized === "claude" || normalized === "gemini") {
    return normalized;
  }
  return "custom";
}

function canonicalAgentId(input: {
  nodeId: string | null;
  hostKind: AgentRecord["hostKind"];
  executionName: string | null;
  fingerprint: string | null;
}) {
  const identityTail =
    input.nodeId && input.executionName ? input.executionName : input.fingerprint ?? input.executionName ?? "";
  const raw = [
    input.nodeId ?? "global",
    input.hostKind,
    identityTail
  ].join("|");
  return `agent_${createHash("sha1").update(raw).digest("hex").slice(0, 16)}`;
}

function backendForRoles(orchestrator: boolean, controlled: boolean): AgentRecord["backend"] {
  if (orchestrator && controlled) {
    return "hybrid";
  }
  if (orchestrator) {
    return "mcp";
  }
  return "acpx";
}

export class Repository {
  constructor(private readonly db: Database) {}

  private parseNodeRow(row: typeof nodesTable.$inferSelect): NodeRecord {
    return nodeSchema.parse({
      id: row.id,
      name: row.name,
      status: row.status,
      host: row.host,
      labels: parseJson<string[]>(row.labels),
      paths: parseJson<string[]>(row.paths ?? "[]"),
      registeredAt: row.registeredAt,
      lastSeenAt: row.lastSeenAt ?? null
    });
  }

  private parseAgentRow(row: typeof agentsTable.$inferSelect): AgentRecord {
    return agentSchema.parse({
      id: row.id,
      nodeId: row.nodeId ?? null,
      name: row.name,
      backend: row.backend,
      hostKind: normalizeHostKind(row.hostKind),
      executionName: row.executionName ?? null,
      fingerprint: row.fingerprint ?? null,
      orchestrator: Boolean(row.orchestrator),
      controlled: Boolean(row.controlled),
      status: row.status,
      capabilities: parseJson<Record<string, unknown>>(row.capabilities),
      endpoints: parseJson<Array<{ transport: string; metadata?: Record<string, unknown> }>>(
        row.endpoints ?? "[]"
      )
    });
  }

  private upsertAgentRecord(agent: AgentRecord) {
    this.db
      .insert(agentsTable)
      .values({
        id: agent.id,
        nodeId: agent.nodeId,
        name: agent.name,
        backend: agent.backend,
        hostKind: agent.hostKind,
        executionName: agent.executionName,
        fingerprint: agent.fingerprint,
        orchestrator: agent.orchestrator,
        controlled: agent.controlled,
        status: agent.status,
        capabilities: JSON.stringify(agent.capabilities),
        endpoints: JSON.stringify(agent.endpoints)
      })
      .onConflictDoUpdate({
        target: agentsTable.id,
        set: {
          nodeId: agent.nodeId,
          name: agent.name,
          backend: agent.backend,
          hostKind: agent.hostKind,
          executionName: agent.executionName,
          fingerprint: agent.fingerprint,
          orchestrator: agent.orchestrator,
          controlled: agent.controlled,
          status: agent.status,
          capabilities: JSON.stringify(agent.capabilities),
          endpoints: JSON.stringify(agent.endpoints)
        }
      })
      .run();
  }

  private upsertNodeRow(node: NodeRecord, reconnectToken: string) {
    this.db
      .insert(nodesTable)
      .values({
        id: node.id,
        name: node.name,
        host: node.host,
        labels: JSON.stringify(node.labels),
        paths: JSON.stringify(node.paths),
        reconnectToken,
        status: node.status,
        registeredAt: node.registeredAt,
        lastSeenAt: node.lastSeenAt
      })
      .onConflictDoUpdate({
        target: nodesTable.id,
        set: {
          name: node.name,
          host: node.host,
          labels: JSON.stringify(node.labels),
          paths: JSON.stringify(node.paths),
          status: node.status,
          registeredAt: node.registeredAt,
          lastSeenAt: node.lastSeenAt
        }
      })
      .run();
  }

  registerNode(input: { id?: string; name: string; host: string; labels: string[] }) {
    const existing = input.id ? this.findNode(input.id) : null;
    const node: NodeRecord = {
      id: input.id ?? nanoid(10),
      name: input.name,
      host: input.host,
      labels: input.labels,
      paths: [],
      status: "online",
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      version: null,
      latestVersion: null,
      updateRequired: false
    };

    this.upsertNodeRow(node, this.getReconnectToken(node.id) ?? nanoid(24));

    return node;
  }

  getReconnectToken(nodeId: string) {
    const row = this.db
      .select({
        reconnectToken: nodesTable.reconnectToken
      })
      .from(nodesTable)
      .where(eq(nodesTable.id, nodeId))
      .get();
    return row?.reconnectToken ?? null;
  }

  findNode(nodeId: string) {
    const row = this.db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.id, nodeId))
      .get();
    if (!row) {
      return null;
    }

    return this.parseNodeRow(row);
  }

  resumeNode(nodeId: string, reconnectToken: string, observedAt: string) {
    const row = this.db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.id, nodeId))
      .get();

    if (!row || row.reconnectToken !== reconnectToken) {
      return null;
    }

    this.db
      .update(nodesTable)
      .set({
        status: "online",
        lastSeenAt: observedAt
      })
      .where(eq(nodesTable.id, nodeId))
      .run();

    return this.parseNodeRow({ ...row, status: "online", lastSeenAt: observedAt });
  }

  markNodeOffline(nodeId: string) {
    this.db
      .update(nodesTable)
      .set({ status: "offline" })
      .where(eq(nodesTable.id, nodeId))
      .run();
    for (const agent of this.listTopology().agents.filter((entry) => entry.nodeId === nodeId)) {
      this.upsertAgentRecord({
        ...agent,
        status: agent.orchestrator ? agent.status : "offline"
      });
    }
  }

  heartbeat(nodeId: string, observedAt: string) {
    this.db
      .update(nodesTable)
      .set({
        status: "online",
        lastSeenAt: observedAt
      })
      .where(eq(nodesTable.id, nodeId))
      .run();
  }

  setNodePaths(nodeId: string, paths: string[]) {
    this.db
      .update(nodesTable)
      .set({
        paths: JSON.stringify(paths)
      })
      .where(eq(nodesTable.id, nodeId))
      .run();
  }

  ensureNode(input: McpEnsureNodeRequest): { node: NodeRecord; reconnectToken: string } {
    const nodeId = input.id ?? nanoid(10);
    const existing = this.findNode(nodeId);
    const reconnectToken = this.getReconnectToken(nodeId) ?? nanoid(24);
    const node: NodeRecord = {
      id: nodeId,
      name: input.name,
      host: input.host,
      labels: input.labels,
      paths: existing?.paths ?? [],
      status: existing?.status ?? "pending",
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
      lastSeenAt: existing?.lastSeenAt ?? null,
      version: null,
      latestVersion: null,
      updateRequired: false
    };

    this.upsertNodeRow(node, reconnectToken);
    return { node, reconnectToken };
  }

  syncCapabilities(nodeId: string, capabilities: Capability[]) {
    const existing = this.listTopology().agents.filter((agent) => agent.nodeId === nodeId);
    const incomingControlledIds = new Set(capabilities.map((capability) => capability.id));

    for (const capability of capabilities) {
      const hostKind = normalizeHostKind(capability.acpxAgent);
      const executionName = capability.acpxAgent.trim() || capability.name.trim() || null;
      const canonicalId = canonicalAgentId({
        nodeId,
        hostKind,
        executionName,
        fingerprint: null
      });
      const previous = this.findAgent(canonicalId) ??
        existing.find(
          (agent) =>
            agent.hostKind === hostKind &&
            agent.executionName === executionName
        ) ??
        this.findAgent(capability.id);
      const agentId = previous?.id ?? capability.id;
      const endpoints = [
        ...(previous?.endpoints.filter((endpoint) => endpoint.transport !== "acp") ?? []),
        {
          transport: "acp" as const,
          metadata: {
            capabilityId: capability.id,
            acpxAgent: capability.acpxAgent,
            command: capability.command,
            args: capability.args,
            cwd: capability.cwd,
            labels: capability.labels,
            error: capability.error
          }
        }
      ];
      const orchestrator = previous?.orchestrator ?? false;
      const agent: AgentRecord = {
        id: agentId,
        nodeId,
        name: capability.name,
        backend: backendForRoles(orchestrator, true),
        hostKind,
        executionName,
        fingerprint: previous?.fingerprint ?? null,
        orchestrator,
        controlled: true,
        status: capability.status,
        capabilities: {
          acpxAgent: capability.acpxAgent,
          controlledAgentId: capability.id,
          error: capability.error,
          cwd: capability.cwd,
          labels: capability.labels
        },
        endpoints
      };
      this.upsertAgentRecord(agent);
    }

    for (const agent of existing) {
      const controlledAgentId =
        typeof agent.capabilities.controlledAgentId === "string"
          ? agent.capabilities.controlledAgentId
          : null;
      if (!controlledAgentId || incomingControlledIds.has(controlledAgentId)) {
        continue;
      }
      const endpoints = agent.endpoints.filter((endpoint) => endpoint.transport !== "acp");
      this.upsertAgentRecord({
        ...agent,
        backend: backendForRoles(agent.orchestrator, false),
        controlled: false,
        status: agent.orchestrator ? agent.status : "offline",
        endpoints
      });
    }
  }

  listTopology(): TopologySnapshot {
    const nodes = this.db.select().from(nodesTable).all().map((row) => this.parseNodeRow(row));
    const agents = this.db.select().from(agentsTable).all().map((row) => this.parseAgentRow(row));
    const triggerRules = this.db.select().from(triggerRulesTable).all().map((row) =>
      triggerRuleSchema.parse({
        id: row.id,
        sourceAgentId: row.sourceAgentId,
        targetAgentId: row.targetAgentId,
        mode: row.mode
      })
    );

    return {
      nodes,
      agents,
      triggerRules
    };
  }

  upsertTriggerRule(input: {
    sourceAgentId: string;
    targetAgentId: string;
    mode: TriggerMode;
  }): TriggerRule {
    const existing = this.db
      .select()
      .from(triggerRulesTable)
      .where(
        and(
          eq(triggerRulesTable.sourceAgentId, input.sourceAgentId),
          eq(triggerRulesTable.targetAgentId, input.targetAgentId)
        )
      )
      .get();

    const rule: TriggerRule = {
      id: existing?.id ?? nanoid(10),
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      mode: input.mode
    };

    this.db
      .insert(triggerRulesTable)
      .values(rule)
      .onConflictDoUpdate({
        target: triggerRulesTable.id,
        set: {
          sourceAgentId: rule.sourceAgentId,
          targetAgentId: rule.targetAgentId,
          mode: rule.mode
        }
      })
      .run();

    return triggerRuleSchema.parse(rule);
  }

  deleteTriggerRule(id: string) {
    const existing = this.db
      .select()
      .from(triggerRulesTable)
      .where(eq(triggerRulesTable.id, id))
      .get();
    if (!existing) {
      return false;
    }
    this.db.delete(triggerRulesTable).where(eq(triggerRulesTable.id, id)).run();
    return true;
  }

  createSession(input: {
    entryAgentId: string;
    initiator: "user" | "agent";
    cwd: string | null;
  }) {
    const session: SessionRecord = {
      id: nanoid(12),
      entryAgentId: input.entryAgentId,
      initiator: input.initiator,
      status: "pending",
      createdAt: new Date().toISOString(),
      cwd: input.cwd,
      parentSessionId: null,
      sourceAgentId: null
    };
    this.db.insert(sessionsTable).values(session).run();
    return sessionSchema.parse(session);
  }

  createLinkedSession(input: {
    entryAgentId: string;
    initiator: "user" | "agent";
    cwd: string | null;
    parentSessionId: string | null;
    sourceAgentId: string | null;
  }) {
    const session: SessionRecord = {
      id: nanoid(12),
      entryAgentId: input.entryAgentId,
      initiator: input.initiator,
      status: "pending",
      createdAt: new Date().toISOString(),
      cwd: input.cwd,
      parentSessionId: input.parentSessionId,
      sourceAgentId: input.sourceAgentId
    };
    this.db.insert(sessionsTable).values(session).run();
    return sessionSchema.parse(session);
  }

  updateSessionStatus(sessionId: string, status: SessionRecord["status"]) {
    this.db.update(sessionsTable).set({ status }).where(eq(sessionsTable.id, sessionId)).run();
  }

  getSession(sessionId: string) {
    const session = this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .get();

    if (!session) {
      return null;
    }

    const events = this.listSessionEvents(sessionId);
    return {
      session: sessionSchema.parse(session),
      events
    };
  }

  listSessions() {
    return this.db.select().from(sessionsTable).all().map((session) => sessionSchema.parse(session));
  }

  listSessionEvents(sessionId: string) {
    return this.db
      .select()
      .from(sessionEventsTable)
      .where(eq(sessionEventsTable.sessionId, sessionId))
      .orderBy(asc(sessionEventsTable.sequence))
      .all()
      .map((event) =>
        sessionEventSchema.parse({
          id: event.id,
          sessionId: event.sessionId,
          eventType: event.eventType,
          sourceAgentId: event.sourceAgentId ?? null,
          targetAgentId: event.targetAgentId ?? null,
          payload: parseJson<Record<string, unknown>>(event.payload),
          createdAt: event.createdAt
        })
      );
  }

  appendSessionEvent(input: Omit<SessionEventRecord, "id" | "createdAt">) {
    const sequence = this.listSessionEvents(input.sessionId).length + 1;
    const event: SessionEventRecord = {
      id: nanoid(14),
      createdAt: new Date().toISOString(),
      ...input
    };

    this.db.insert(sessionEventsTable).values({
      id: event.id,
      sessionId: event.sessionId,
      eventType: event.eventType,
      sourceAgentId: event.sourceAgentId,
      targetAgentId: event.targetAgentId,
      payload: JSON.stringify(event.payload),
      createdAt: event.createdAt,
      sequence
    }).run();

    return event;
  }

  canInvoke(sourceAgentId: string, targetAgentId: string) {
    const rule = this.db
      .select()
      .from(triggerRulesTable)
      .where(
        and(
          eq(triggerRulesTable.sourceAgentId, sourceAgentId),
          eq(triggerRulesTable.targetAgentId, targetAgentId)
        )
      )
      .get();

    return rule?.mode === "allow";
  }

  findAgent(agentId: string): AgentRecord | null {
    const row = this.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .get();

    if (!row) {
      return null;
    }

    return this.parseAgentRow(row);
  }

  findAgentByControlledAgentId(nodeId: string, controlledAgentId: string) {
    return (
      this.listTopology().agents.find(
        (agent) =>
          agent.nodeId === nodeId &&
          typeof agent.capabilities.controlledAgentId === "string" &&
          agent.capabilities.controlledAgentId === controlledAgentId
      ) ?? null
    );
  }

  upsertMcpAgent(
    input: McpAgentRegistrationRequest
  ): McpAgentRegistrationResponse {
    const ensured = input.node ? this.ensureNode(input.node) : null;
    const nodeId = ensured?.node.id ?? null;
    const hostKind = input.hostKind;
    const executionName = input.executionName?.trim() || null;
    const fingerprint = input.fingerprint?.trim() || null;
    const controlled = input.controlled && nodeId !== null;
    const canonicalId = canonicalAgentId({
      nodeId,
      hostKind,
      executionName,
      fingerprint
    });
    const previous =
      this.findAgent(canonicalId) ??
      this.listTopology().agents.find(
        (agent) =>
          agent.nodeId === nodeId &&
          agent.hostKind === hostKind &&
          agent.executionName === executionName
      ) ??
      null;
    const agentId = previous?.id ?? canonicalId;
    const endpointTransport: "mcp-url" | "mcp-npx" =
      input.transport === "url" ? "mcp-url" : "mcp-npx";
    const endpoints = [
      ...(previous?.endpoints.filter((endpoint) => endpoint.transport !== endpointTransport) ?? []),
      {
        transport: endpointTransport,
        metadata: input.metadata
      }
    ];
    const agent: AgentRecord = {
      id: agentId,
      nodeId,
      name: input.name,
      backend: backendForRoles(true, Boolean(previous?.controlled || controlled)),
      hostKind,
      executionName,
      fingerprint,
      orchestrator: true,
      controlled: Boolean(previous?.controlled || controlled),
      status: "online",
      capabilities: {
        ...(previous?.capabilities ?? {}),
        mcpTransport: input.transport
      },
      endpoints
    };

    this.upsertAgentRecord(agent);
    return {
      agent,
      node: ensured?.node ?? null,
      reconnectToken: ensured?.reconnectToken ?? null
    };
  }

  mcpStatus(agentId: string) {
    const agent = this.findAgent(agentId);
    if (!agent) {
      return null;
    }
    return {
      agent,
      node: agent.nodeId ? this.findNode(agent.nodeId) : null
    };
  }

  sessionUpdatedEvent(sessionId: string): BrowserRealtimeEvent {
    const state = this.getSession(sessionId);
    if (!state) {
      throw new Error(`session not found: ${sessionId}`);
    }

    return {
      type: "session.updated",
      payload: state
    };
  }
}
