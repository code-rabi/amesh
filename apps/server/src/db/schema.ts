import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nodesTable = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  host: text("host").notNull(),
  labels: text("labels").notNull(),
  reconnectToken: text("reconnect_token").notNull(),
  registeredAt: text("registered_at").notNull(),
  lastSeenAt: text("last_seen_at")
});

export const agentsTable = sqliteTable("agents", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  backend: text("backend").notNull(),
  status: text("status").notNull(),
  capabilities: text("capabilities").notNull()
});

export const triggerRulesTable = sqliteTable("trigger_rules", {
  id: text("id").primaryKey(),
  sourceAgentId: text("source_agent_id").notNull(),
  targetAgentId: text("target_agent_id").notNull(),
  mode: text("mode").notNull()
});

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  entryAgentId: text("entry_agent_id").notNull(),
  initiator: text("initiator").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  parentSessionId: text("parent_session_id"),
  sourceAgentId: text("source_agent_id")
});

export const sessionEventsTable = sqliteTable("session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  sourceAgentId: text("source_agent_id"),
  targetAgentId: text("target_agent_id"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  sequence: integer("sequence").notNull()
});
