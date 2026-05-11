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
  registeredAt: z.string(),
  lastSeenAt: z.string().nullable()
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
  parentSessionId: z.string().nullable().default(null),
  sourceAgentId: z.string().nullable().default(null)
});
export type SessionRecord = z.infer<typeof sessionSchema>;

export const sessionEventTypeSchema = z.enum([
  "session.created",
  "session.prompted",
  "session.output.delta",
  "session.output.completed",
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
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  labels: z.array(z.string()).default([])
});
export type Capability = z.infer<typeof capabilitySchema>;

export const nodeRegistrationPayloadSchema = z.object({
  registrationToken: z.string(),
  nodeName: z.string(),
  host: z.string(),
  labels: z.array(z.string()).default([])
});
export type NodeRegistrationPayload = z.infer<
  typeof nodeRegistrationPayloadSchema
>;

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

export const sessionStartPayloadSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  prompt: z.string(),
  initiator: sessionInitiatorSchema,
  metadata: payloadSchema.default({})
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
  agentId: z.string(),
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
