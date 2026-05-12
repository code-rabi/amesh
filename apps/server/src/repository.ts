import type {
  AgentRecord,
  BrowserRealtimeEvent,
  Capability,
  NodeRecord,
  SessionEventRecord,
  SessionRecord,
  TopologySnapshot,
  TriggerRule,
  TriggerMode
} from "@amesh/protocol";
import { agentSchema, nodeSchema, sessionEventSchema, sessionSchema, triggerRuleSchema } from "@amesh/protocol";
import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";

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

export class Repository {
  constructor(private readonly db: Database) {}

  registerNode(input: { id?: string; name: string; host: string; labels: string[] }) {
    const node: NodeRecord = {
      id: input.id ?? nanoid(10),
      name: input.name,
      host: input.host,
      labels: input.labels,
      status: "online",
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      version: null,
      latestVersion: null,
      updateRequired: false
    };

    this.db
      .insert(nodesTable)
      .values({
        id: node.id,
        name: node.name,
        host: node.host,
        labels: JSON.stringify(node.labels),
        reconnectToken: nanoid(24),
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
          reconnectToken: nanoid(24),
          status: "online",
          lastSeenAt: node.lastSeenAt
        }
      })
      .run();

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

    return nodeSchema.parse({
      id: row.id,
      name: row.name,
      status: row.status,
      host: row.host,
      labels: parseJson<string[]>(row.labels),
      registeredAt: row.registeredAt,
      lastSeenAt: row.lastSeenAt ?? null
    });
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

    return nodeSchema.parse({
      id: row.id,
      name: row.name,
      status: "online",
      host: row.host,
      labels: parseJson<string[]>(row.labels),
      registeredAt: row.registeredAt,
      lastSeenAt: observedAt
    });
  }

  markNodeOffline(nodeId: string) {
    this.db
      .update(nodesTable)
      .set({ status: "offline" })
      .where(eq(nodesTable.id, nodeId))
      .run();
    this.db
      .update(agentsTable)
      .set({ status: "offline" })
      .where(eq(agentsTable.nodeId, nodeId))
      .run();
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

  syncCapabilities(nodeId: string, capabilities: Capability[]) {
    const existing = this.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.nodeId, nodeId))
      .all();
    const incomingIds = new Set(capabilities.map((capability) => capability.id));

    for (const capability of capabilities) {
      this.db
        .insert(agentsTable)
        .values({
          id: capability.id,
          nodeId,
          name: capability.name,
          displayName: null,
          backend: "acpx",
          status: "online",
          capabilities: JSON.stringify({
            acpxAgent: capability.acpxAgent,
            labels: capability.labels
          })
        })
        .onConflictDoUpdate({
          target: agentsTable.id,
          set: {
            name: capability.name,
            status: "online",
            capabilities: JSON.stringify({
              acpxAgent: capability.acpxAgent,
              labels: capability.labels
            })
          }
        })
        .run();
    }

    for (const row of existing) {
      if (!incomingIds.has(row.id)) {
        this.db
          .update(agentsTable)
          .set({ status: "offline" })
          .where(eq(agentsTable.id, row.id))
          .run();
      }
    }
  }

  listTopology(): TopologySnapshot {
    const nodes = this.db.select().from(nodesTable).all().map((row) =>
      nodeSchema.parse({
        id: row.id,
        name: row.name,
        status: row.status,
        host: row.host,
        labels: parseJson<string[]>(row.labels),
        registeredAt: row.registeredAt,
        lastSeenAt: row.lastSeenAt ?? null
      })
    );
    const agents = this.db.select().from(agentsTable).all().map((row) =>
      agentSchema.parse({
        id: row.id,
        nodeId: row.nodeId,
        name: row.name,
        displayName: row.displayName ?? null,
        backend: row.backend,
        status: row.status,
        capabilities: parseJson<Record<string, unknown>>(row.capabilities)
      })
    );
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


  renameAgent(agentId: string, displayName: string | null) {
    const changes = this.db
      .update(agentsTable)
      .set({ displayName })
      .where(eq(agentsTable.id, agentId))
      .run().changes;
    if (!changes) return null;
    return this.findAgent(agentId);
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

  createSession(entryAgentId: string, initiator: "user" | "agent") {
    const session: SessionRecord = {
      id: nanoid(12),
      entryAgentId,
      initiator,
      status: "pending",
      createdAt: new Date().toISOString(),
      parentSessionId: null,
      sourceAgentId: null
    };
    this.db.insert(sessionsTable).values(session).run();
    return sessionSchema.parse(session);
  }

  createLinkedSession(input: {
    entryAgentId: string;
    initiator: "user" | "agent";
    parentSessionId: string | null;
    sourceAgentId: string | null;
  }) {
    const session: SessionRecord = {
      id: nanoid(12),
      entryAgentId: input.entryAgentId,
      initiator: input.initiator,
      status: "pending",
      createdAt: new Date().toISOString(),
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

    return agentSchema.parse({
      id: row.id,
      nodeId: row.nodeId,
      name: row.name,
      displayName: row.displayName ?? null,
      backend: row.backend,
      status: row.status,
      capabilities: parseJson<Record<string, unknown>>(row.capabilities)
    });
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
