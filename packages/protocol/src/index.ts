import { z } from "zod";

export const nodeStatusSchema = z.enum(["pending", "online", "offline"]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const agentStatusSchema = z.enum(["online", "offline", "error"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const triggerModeSchema = z.enum(["allow", "deny"]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;

export const sessionInitiatorSchema = z.enum(["user", "agent"]);
export type SessionInitiator = z.infer<typeof sessionInitiatorSchema>;

export const sessionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const payloadSchema = z.record(z.string(), z.unknown());
export type Payload = z.infer<typeof payloadSchema>;

export const nodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: nodeStatusSchema,
  host: z.string(),
  labels: z.array(z.string()),
  paths: z.array(z.string()).default([]),
  registeredAt: z.string(),
  lastSeenAt: z.string().nullable(),
  version: z.string().nullable().default(null),
  latestVersion: z.string().nullable().default(null),
  updateRequired: z.boolean().default(false)
});
export type NodeRecord = z.infer<typeof nodeSchema>;

export const agentSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  backend: z.literal("acpx"),
  status: agentStatusSchema,
  capabilities: payloadSchema
});
export type AgentRecord = z.infer<typeof agentSchema>;

export const triggerRuleSchema = z.object({
  id: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  mode: triggerModeSchema
});
export type TriggerRule = z.infer<typeof triggerRuleSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  entryAgentId: z.string(),
  initiator: sessionInitiatorSchema,
  status: sessionStatusSchema,
  createdAt: z.string(),
  cwd: z.string().nullable().default(null),
  parentSessionId: z.string().nullable().default(null),
  sourceAgentId: z.string().nullable().default(null)
});
export type SessionRecord = z.infer<typeof sessionSchema>;

export const sessionEventTypeSchema = z.enum([
  "session.created",
  "session.prompted",
  "session.output.delta",
  "session.output.completed",
  "session.acp.update",
  "session.invocation.requested",
  "session.invocation.allowed",
  "session.invocation.denied",
  "session.invocation.completed",
  "session.failed",
  "session.cancelled",
  "audit"
]);
export type SessionEventType = z.infer<typeof sessionEventTypeSchema>;

export const sessionEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventType: sessionEventTypeSchema,
  sourceAgentId: z.string().nullable(),
  targetAgentId: z.string().nullable(),
  payload: payloadSchema,
  createdAt: z.string()
});
export type SessionEventRecord = z.infer<typeof sessionEventSchema>;

export const capabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  acpxAgent: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  status: agentStatusSchema.default("online"),
  error: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  labels: z.array(z.string()).default([])
});
export type Capability = z.infer<typeof capabilitySchema>;

export const nodeRegistrationPayloadSchema = z.object({
  registrationToken: z.string(),
  nodeName: z.string(),
  host: z.string(),
  labels: z.array(z.string()).default([]),
  version: z.string().nullable().default(null)
});
export type NodeRegistrationPayload = z.infer<
  typeof nodeRegistrationPayloadSchema
>;

export const nodeResumePayloadSchema = z.object({
  nodeId: z.string(),
  reconnectToken: z.string(),
  version: z.string().nullable().default(null)
});
export type NodeResumePayload = z.infer<typeof nodeResumePayloadSchema>;

export const nodeHeartbeatPayloadSchema = z.object({
  nodeId: z.string(),
  observedAt: z.string()
});
export type NodeHeartbeatPayload = z.infer<typeof nodeHeartbeatPayloadSchema>;

export const capabilitySyncPayloadSchema = z.object({
  nodeId: z.string(),
  capabilities: z.array(capabilitySchema)
});
export type CapabilitySyncPayload = z.infer<typeof capabilitySyncPayloadSchema>;

export const updateNodePathsRequestSchema = z.object({
  paths: z.array(z.string())
});
export type UpdateNodePathsRequest = z.infer<typeof updateNodePathsRequestSchema>;

export const nodePathsUpdatePayloadSchema = z.object({
  nodeId: z.string(),
  paths: z.array(z.string())
});
export type NodePathsUpdatePayload = z.infer<typeof nodePathsUpdatePayloadSchema>;

export const browseNodeDirectoriesQuerySchema = z.object({
  path: z.string().optional()
});
export type BrowseNodeDirectoriesQuery = z.infer<
  typeof browseNodeDirectoriesQuerySchema
>;

export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hasChildren: z.boolean()
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const nodeDirectoryBrowsePayloadSchema = z.object({
  nodeId: z.string(),
  path: z.string().default("")
});
export type NodeDirectoryBrowsePayload = z.infer<
  typeof nodeDirectoryBrowsePayloadSchema
>;

export const nodeDirectoryBrowseResultPayloadSchema = z.object({
  nodeId: z.string(),
  path: z.string(),
  entries: z.array(directoryEntrySchema)
});
export type NodeDirectoryBrowseResultPayload = z.infer<
  typeof nodeDirectoryBrowseResultPayloadSchema
>;

export const browseNodeDirectoriesResponseSchema =
  nodeDirectoryBrowseResultPayloadSchema.omit({
    nodeId: true
  });
export type BrowseNodeDirectoriesResponse = z.infer<
  typeof browseNodeDirectoriesResponseSchema
>;

export const nodeLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type NodeLogLevel = z.infer<typeof nodeLogLevelSchema>;

export const nodeLogPayloadSchema = z.object({
  nodeId: z.string(),
  level: nodeLogLevelSchema.default("info"),
  message: z.string(),
  context: payloadSchema.default({}),
  observedAt: z.string()
});
export type NodeLogPayload = z.infer<typeof nodeLogPayloadSchema>;

export const nodeLogEntrySchema = nodeLogPayloadSchema.extend({
  id: z.string()
});
export type NodeLogEntry = z.infer<typeof nodeLogEntrySchema>;

export const nodeLogsResponseSchema = z.object({
  nodeId: z.string(),
  entries: z.array(nodeLogEntrySchema)
});
export type NodeLogsResponse = z.infer<typeof nodeLogsResponseSchema>;

export const sessionStartPayloadSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  prompt: z.string(),
  initiator: sessionInitiatorSchema,
  cwd: z.string().nullable().default(null),
  parentSessionId: z.string().nullable().default(null)
});
export type SessionStartPayload = z.infer<typeof sessionStartPayloadSchema>;

export const sessionInputPayloadSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  prompt: z.string()
});
export type SessionInputPayload = z.infer<typeof sessionInputPayloadSchema>;

export const sessionCancelPayloadSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  reason: z.string().optional()
});
export type SessionCancelPayload = z.infer<typeof sessionCancelPayloadSchema>;

export const invocationRequestPayloadSchema = z.object({
  parentSessionId: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  prompt: z.string()
});
export type InvocationRequestPayload = z.infer<
  typeof invocationRequestPayloadSchema
>;

export const protocolEnvelopeSchema = z.object({
  type: z.string(),
  requestId: z.string(),
  sessionId: z.string().nullable().default(null),
  source: z.string(),
  target: z.string(),
  payload: payloadSchema
});
export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;

export const topologySnapshotSchema = z.object({
  nodes: z.array(nodeSchema),
  agents: z.array(agentSchema),
  triggerRules: z.array(triggerRuleSchema)
});
export type TopologySnapshot = z.infer<typeof topologySnapshotSchema>;

export const createSessionRequestSchema = z.object({
  nodeId: z.string(),
  agentId: z.string(),
  cwd: z.string().nullable().default(null),
  prompt: z.string()
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const appendSessionInputRequestSchema = z.object({
  prompt: z.string()
});
export type AppendSessionInputRequest = z.infer<
  typeof appendSessionInputRequestSchema
>;

export const upsertTriggerRuleRequestSchema = z.object({
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  mode: triggerModeSchema
});
export type UpsertTriggerRuleRequest = z.infer<
  typeof upsertTriggerRuleRequestSchema
>;

export const browserRealtimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("topology.snapshot"),
    payload: topologySnapshotSchema
  }),
  z.object({
    type: z.literal("topology.updated"),
    payload: topologySnapshotSchema
  }),
  z.object({
    type: z.literal("node.logs.updated"),
    payload: nodeLogsResponseSchema
  }),
  z.object({
    type: z.literal("session.updated"),
    payload: z.object({
      session: sessionSchema,
      events: z.array(sessionEventSchema)
    })
  })
]);
export type BrowserRealtimeEvent = z.infer<typeof browserRealtimeEventSchema>;

export function parseProtocolEnvelope(input: unknown): ProtocolEnvelope {
  return protocolEnvelopeSchema.parse(input);
}
