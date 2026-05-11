import type {
  BrowserRealtimeEvent,
  CapabilitySyncPayload,
  CreateSessionRequest,
  InvocationRequestPayload,
  NodeHeartbeatPayload,
  NodeRegistrationPayload,
  ProtocolEnvelope,
  SessionEventRecord,
  SessionInputPayload,
  SessionStartPayload,
  TopologySnapshot,
  UpsertTriggerRuleRequest
} from "@amesh/protocol";
import {
  appendSessionInputRequestSchema,
  browserRealtimeEventSchema,
  capabilitySyncPayloadSchema,
  createSessionRequestSchema,
  invocationRequestPayloadSchema,
  nodeHeartbeatPayloadSchema,
  nodeRegistrationPayloadSchema,
  parseProtocolEnvelope,
  sessionEventSchema,
  sessionInputPayloadSchema,
  sessionStartPayloadSchema,
  topologySnapshotSchema,
  upsertTriggerRuleRequestSchema
} from "@amesh/protocol";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import WebSocket, { WebSocketServer } from "ws";

import { createDatabase } from "./db/client.js";
import { Repository } from "./repository.js";

type Role = "browser" | "node";

type AppOptions = {
  dbPath?: string;
  registrationToken?: string;
  staticRoot?: string;
};

type NodeSocket = {
  nodeId: string;
  send: (message: ProtocolEnvelope) => void;
};

function websocketSend(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload));
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const db = createDatabase(options.dbPath ?? "apps/server/data/amesh.sqlite");
  const repository = new Repository(db);
  const registrationToken =
    options.registrationToken ?? process.env.AMESH_REGISTRATION_TOKEN ?? "";
  const browserSockets = new Set<WebSocket>();
  const nodeSockets = new Map<string, NodeSocket>();
  const websocketServer = new WebSocketServer({ noServer: true });

  async function broadcastTopology() {
    const snapshot = topologySnapshotSchema.parse(repository.listTopology());
    const message = browserRealtimeEventSchema.parse({
      type: "topology.updated",
      payload: snapshot
    });
    for (const socket of browserSockets) {
      websocketSend(socket, message);
    }
  }

  async function broadcastSession(sessionId: string) {
    const event = repository.sessionUpdatedEvent(sessionId);
    const message = browserRealtimeEventSchema.parse(event);
    for (const socket of browserSockets) {
      websocketSend(socket, message);
    }
  }

  function maybePropagateChildCompletion(payload: SessionEventRecord) {
    const state = repository.getSession(payload.sessionId);
    if (!state?.session.parentSessionId) {
      return;
    }

    if (
      payload.eventType !== "session.output.completed" &&
      payload.eventType !== "session.failed" &&
      payload.eventType !== "session.cancelled"
    ) {
      return;
    }

    repository.appendSessionEvent({
      sessionId: state.session.parentSessionId,
      eventType: "session.invocation.completed",
      sourceAgentId: state.session.sourceAgentId,
      targetAgentId: state.session.entryAgentId,
      payload: {
        childSessionId: state.session.id,
        childStatus: state.session.status,
        resultEventType: payload.eventType,
        result: payload.payload
      }
    });
    void broadcastSession(state.session.parentSessionId);
  }

  function sendToNode(nodeId: string, envelope: ProtocolEnvelope) {
    const nodeSocket = nodeSockets.get(nodeId);
    if (!nodeSocket) {
      throw new Error(`node is offline: ${nodeId}`);
    }
    nodeSocket.send(envelope);
  }

  function bindSocket(socket: WebSocket, role: Role | null, nodeId: string | null) {
    if (role === "browser") {
      browserSockets.add(socket);
      websocketSend(socket, {
        type: "topology.snapshot",
        payload: repository.listTopology()
      } satisfies BrowserRealtimeEvent);
      socket.on("close", () => {
        browserSockets.delete(socket);
      });
      return;
    }

    let boundNodeId = nodeId ?? "";
    socket.on("message", (data) => {
      const envelope = parseProtocolEnvelope(JSON.parse(String(data)));
      switch (envelope.type) {
        case "node.register": {
          const payload = nodeRegistrationPayloadSchema.parse(
            envelope.payload
          ) as NodeRegistrationPayload;
          if (registrationToken && payload.registrationToken !== registrationToken) {
            websocketSend(socket, {
              type: "node.registration.denied",
              payload: {
                reason: "invalid_registration_token"
              }
            });
            socket.close();
            break;
          }
          const node = repository.registerNode({
            id: envelope.source,
            name: payload.nodeName,
            host: payload.host,
            labels: payload.labels
          });
          boundNodeId = node.id;
          nodeSockets.set(node.id, {
            nodeId: node.id,
            send(message) {
              websocketSend(socket, message);
            }
          });
          websocketSend(socket, {
            type: "node.registered",
            payload: {
              nodeId: node.id,
              reconnectToken: repository.getReconnectToken(node.id)
            }
          });
          void broadcastTopology();
          break;
        }
        case "node.resume": {
          const payload = envelope.payload as {
            nodeId?: string;
            reconnectToken?: string;
          };
          if (!payload.nodeId || !payload.reconnectToken) {
            websocketSend(socket, {
              type: "node.resume.denied",
              payload: {
                reason: "missing_credentials"
              }
            });
            socket.close();
            break;
          }

          const node = repository.resumeNode(
            payload.nodeId,
            payload.reconnectToken,
            new Date().toISOString()
          );
          if (!node) {
            websocketSend(socket, {
              type: "node.resume.denied",
              payload: {
                reason: "invalid_reconnect_token"
              }
            });
            socket.close();
            break;
          }

          boundNodeId = node.id;
          nodeSockets.set(node.id, {
            nodeId: node.id,
            send(message) {
              websocketSend(socket, message);
            }
          });
          websocketSend(socket, {
            type: "node.resumed",
            payload: {
              nodeId: node.id
            }
          });
          void broadcastTopology();
          break;
        }
        case "node.heartbeat": {
          const payload = nodeHeartbeatPayloadSchema.parse(
            envelope.payload
          ) as NodeHeartbeatPayload;
          repository.heartbeat(payload.nodeId, payload.observedAt);
          void broadcastTopology();
          break;
        }
        case "node.capabilities.sync": {
          const payload = capabilitySyncPayloadSchema.parse(
            envelope.payload
          ) as CapabilitySyncPayload;
          repository.syncCapabilities(payload.nodeId, payload.capabilities);
          void broadcastTopology();
          break;
        }
        case "session.event": {
          const payload = sessionEventSchema.parse(envelope.payload) as SessionEventRecord;
          repository.appendSessionEvent({
            sessionId: payload.sessionId,
            eventType: payload.eventType,
            sourceAgentId: payload.sourceAgentId,
            targetAgentId: payload.targetAgentId,
            payload: payload.payload
          });
          if (payload.eventType === "session.output.completed") {
            repository.updateSessionStatus(payload.sessionId, "completed");
          }
          if (payload.eventType === "session.failed") {
            repository.updateSessionStatus(payload.sessionId, "failed");
          }
          if (payload.eventType === "session.cancelled") {
            repository.updateSessionStatus(payload.sessionId, "cancelled");
          }
          if (payload.eventType === "session.invocation.requested") {
            routeInvocation(
              invocationRequestPayloadSchema.parse(payload.payload),
              payload
            );
          }
          maybePropagateChildCompletion(payload);
          void broadcastSession(payload.sessionId);
          break;
        }
        default:
          break;
      }
    });
    socket.on("close", () => {
      if (boundNodeId) {
        nodeSockets.delete(boundNodeId);
        repository.markNodeOffline(boundNodeId);
        void broadcastTopology();
      }
    });
  }

  function routeInvocation(payload: InvocationRequestPayload, parentEvent: SessionEventRecord) {
    const allowed = repository.canInvoke(payload.sourceAgentId, payload.targetAgentId);
    if (!allowed) {
      const denied = repository.appendSessionEvent({
        sessionId: payload.parentSessionId,
        eventType: "session.invocation.denied",
        sourceAgentId: payload.sourceAgentId,
        targetAgentId: payload.targetAgentId,
        payload: {
          reason: "missing_allow_rule"
        }
      });
      repository.appendSessionEvent({
        sessionId: payload.parentSessionId,
        eventType: "audit",
        sourceAgentId: payload.sourceAgentId,
        targetAgentId: payload.targetAgentId,
        payload: {
          outcome: "denied",
          reason: "missing_allow_rule"
        }
      });
      void broadcastSession(denied.sessionId);
      return;
    }

    const targetAgent = repository.findAgent(payload.targetAgentId);
    if (!targetAgent) {
      repository.appendSessionEvent({
        sessionId: payload.parentSessionId,
        eventType: "session.failed",
        sourceAgentId: payload.sourceAgentId,
        targetAgentId: payload.targetAgentId,
        payload: {
          reason: "target_agent_missing"
        }
      });
      void broadcastSession(payload.parentSessionId);
      return;
    }

    const childSession = repository.createLinkedSession({
      entryAgentId: payload.targetAgentId,
      initiator: "agent",
      parentSessionId: payload.parentSessionId,
      sourceAgentId: payload.sourceAgentId
    });
    repository.updateSessionStatus(childSession.id, "running");
    repository.appendSessionEvent({
      sessionId: payload.parentSessionId,
      eventType: "session.invocation.allowed",
      sourceAgentId: payload.sourceAgentId,
      targetAgentId: payload.targetAgentId,
      payload: {
        childSessionId: childSession.id,
        parentEventId: parentEvent.id
      }
    });

    sendToNode(targetAgent.nodeId, {
      type: "session.start",
      requestId: nanoid(10),
      sessionId: childSession.id,
      source: "server",
      target: targetAgent.nodeId,
      payload: sessionStartPayloadSchema.parse({
        sessionId: childSession.id,
        agentId: payload.targetAgentId,
        prompt: payload.prompt,
        initiator: "agent",
        metadata: {
          parentSessionId: payload.parentSessionId
        }
      })
    });
    void broadcastSession(payload.parentSessionId);
    void broadcastSession(childSession.id);
  }

  app.setErrorHandler((error, _request, reply) => {
    console.error(error);
    reply.code(500).send({
      message: error instanceof Error ? error.message : "internal server error"
    });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/ws", async (_request, reply) => {
    reply.code(426);
    return { message: "upgrade required" };
  });

  app.get("/api/nodes", async () => repository.listTopology().nodes);
  app.get("/api/agents", async () => repository.listTopology().agents);
  app.get("/api/trigger-rules", async () => repository.listTopology().triggerRules);
  app.get("/api/topology", async () => topologySnapshotSchema.parse(repository.listTopology()));
  app.get("/api/sessions", async () => repository.listSessions());
  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const state = repository.getSession((request.params as { sessionId: string }).sessionId);
    if (!state) {
      reply.code(404);
      return { message: "session not found" };
    }
    return state;
  });

  app.post("/api/trigger-rules", async (request) => {
    const body = upsertTriggerRuleRequestSchema.parse(request.body) as UpsertTriggerRuleRequest;
    const rule = repository.upsertTriggerRule(body);
    await broadcastTopology();
    return rule;
  });
  app.delete("/api/trigger-rules/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const deleted = repository.deleteTriggerRule(params.id);
    if (!deleted) {
      reply.code(404);
      return { message: "trigger rule not found" };
    }
    await broadcastTopology();
    return { ok: true };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = createSessionRequestSchema.parse(request.body) as CreateSessionRequest;
    const agent = repository.findAgent(body.agentId);
    if (!agent) {
      reply.code(404);
      return { message: "agent not found" };
    }
    const session = repository.createSession(body.agentId, "user");
    repository.updateSessionStatus(session.id, "running");
    repository.appendSessionEvent({
      sessionId: session.id,
      eventType: "session.created",
      sourceAgentId: null,
      targetAgentId: body.agentId,
      payload: {
        prompt: body.prompt
      }
    });
    sendToNode(agent.nodeId, {
      type: "session.start",
      requestId: nanoid(10),
      sessionId: session.id,
      source: "server",
      target: agent.nodeId,
      payload: sessionStartPayloadSchema.parse({
        sessionId: session.id,
        agentId: body.agentId,
        prompt: body.prompt,
        initiator: "user"
      })
    });
    await broadcastSession(session.id);
    return repository.getSession(session.id);
  });

  app.post("/api/sessions/:sessionId/input", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const body = appendSessionInputRequestSchema.parse(request.body);
    const state = repository.getSession(params.sessionId);
    if (!state) {
      reply.code(404);
      return { message: "session not found" };
    }
    const agent = repository.findAgent(state.session.entryAgentId);
    if (!agent) {
      reply.code(404);
      return { message: "entry agent missing" };
    }

    repository.appendSessionEvent({
      sessionId: state.session.id,
      eventType: "session.prompted",
      sourceAgentId: null,
      targetAgentId: agent.id,
      payload: {
        prompt: body.prompt
      }
    });

    sendToNode(agent.nodeId, {
      type: "session.input",
      requestId: nanoid(10),
      sessionId: state.session.id,
      source: "server",
      target: agent.nodeId,
      payload: sessionInputPayloadSchema.parse({
        sessionId: state.session.id,
        agentId: agent.id,
        prompt: body.prompt
      })
    });
    await broadcastSession(state.session.id);
    return repository.getSession(state.session.id);
  });

  app.post("/api/sessions/:sessionId/cancel", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const state = repository.getSession(params.sessionId);
    if (!state) {
      reply.code(404);
      return { message: "session not found" };
    }
    const agent = repository.findAgent(state.session.entryAgentId);
    if (!agent) {
      reply.code(404);
      return { message: "entry agent missing" };
    }

    repository.updateSessionStatus(state.session.id, "cancelled");
    repository.appendSessionEvent({
      sessionId: state.session.id,
      eventType: "session.cancelled",
      sourceAgentId: null,
      targetAgentId: agent.id,
      payload: {
        reason: "user_cancelled"
      }
    });

    sendToNode(agent.nodeId, {
      type: "session.cancel",
      requestId: nanoid(10),
      sessionId: state.session.id,
      source: "server",
      target: agent.nodeId,
      payload: {
        sessionId: state.session.id,
        agentId: agent.id,
        reason: "user_cancelled"
      }
    });

    await broadcastSession(state.session.id);
    return repository.getSession(state.session.id);
  });

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      bindSocket(client, url.searchParams.get("role") as Role | null, url.searchParams.get("nodeId"));
    });
  });

  app.addHook("onClose", async () => {
    for (const socket of websocketServer.clients) {
      socket.close();
    }
    websocketServer.close();
  });

  const staticRoot = resolve(
    options.staticRoot ?? process.env.AMESH_WEB_DIST ?? resolve(process.cwd(), "apps/web/dist")
  );
  if (existsSync(staticRoot)) {
    app.get("/", async (_request, reply) => {
      await sendStaticFile(reply, staticRoot, "index.html");
    });

    app.get("/*", async (request, reply) => {
      const pathname = normalize((request.params as { "*": string })["*"] ?? "");
      if (pathname.startsWith("api/") || pathname === "ws") {
        reply.code(404);
        return { message: "not found" };
      }

      const assetPath = pathname === "" ? "index.html" : pathname;
      const candidate = resolve(staticRoot, assetPath);
      if (candidate.startsWith(`${staticRoot}${sep}`) && existsSync(candidate)) {
        await sendStaticFile(reply, staticRoot, assetPath);
        return;
      }

      await sendStaticFile(reply, staticRoot, "index.html");
    });
  }

  return app;
}

async function sendStaticFile(reply: { type: (contentType: string) => void; send: (payload: Buffer) => void }, staticRoot: string, assetPath: string) {
  const content = await readFile(join(staticRoot, assetPath));
  reply.type(contentTypeFor(assetPath));
  reply.send(content);
}

function contentTypeFor(pathname: string) {
  switch (extname(pathname)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
