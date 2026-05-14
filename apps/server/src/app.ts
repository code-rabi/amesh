import type {
  BrowserRealtimeEvent,
  BrowseNodeDirectoriesQuery,
  BrowseNodeDirectoriesResponse,
  CapabilitySyncPayload,
  CreateSessionRequest,
  InvocationRequestPayload,
  NodeDirectoryBrowsePayload,
  NodeDirectoryBrowseResultPayload,
  NodeHeartbeatPayload,
  NodeLogEntry,
  NodeLogPayload,
  NodePathsUpdatePayload,
  NodeRegistrationPayload,
  NodeResumePayload,
  ProtocolEnvelope,
  SessionEventRecord,
  SessionInputPayload,
  SessionStartPayload,
  TopologySnapshot,
  UpsertTriggerRuleRequest
} from "@amesh/protocol";
import {
  appendSessionInputRequestSchema,
  browseNodeDirectoriesQuerySchema,
  browseNodeDirectoriesResponseSchema,
  browserRealtimeEventSchema,
  capabilitySyncPayloadSchema,
  createSessionRequestSchema,
  invocationRequestPayloadSchema,
  nodeDirectoryBrowsePayloadSchema,
  nodeDirectoryBrowseResultPayloadSchema,
  nodeHeartbeatPayloadSchema,
  nodeLogPayloadSchema,
  nodeLogsResponseSchema,
  nodePathsUpdatePayloadSchema,
  nodeRegistrationPayloadSchema,
  nodeResumePayloadSchema,
  parseProtocolEnvelope,
  sessionEventSchema,
  sessionInputPayloadSchema,
  sessionStartPayloadSchema,
  topologySnapshotSchema,
  updateNodePathsRequestSchema,
  upsertTriggerRuleRequestSchema
} from "@amesh/protocol";
import cookie from "@fastify/cookie";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

import {
  constantTimeStringEqual,
  issueSession,
  readSessionCookieFromHeader,
  resolveAuthConfig,
  verifySession
} from "./auth.js";
import { createDatabase } from "./db/client.js";
import { buildAmeshMcpServer, type McpScope } from "./mcp.js";
import { Repository } from "./repository.js";

type Role = "browser" | "node";

type AppOptions = {
  dbPath?: string;
  registrationToken?: string;
  staticRoot?: string;
  authPassword?: string;
  authSecret?: string;
  nodeRepo?: string;
  latestNodeVersion?: string | null;
};

type NodeSocket = {
  nodeId: string;
  send: (message: ProtocolEnvelope) => void;
};

type McpSessionState = {
  scope: McpScope;
  transport: NodeStreamableHTTPServerTransport;
};

class NodeLogStore {
  private readonly entries = new Map<string, NodeLogEntry[]>();

  append(input: NodeLogPayload) {
    const entry: NodeLogEntry = {
      id: nanoid(14),
      ...input
    };
    const entries = [...(this.entries.get(input.nodeId) ?? []), entry].slice(-300);
    this.entries.set(input.nodeId, entries);
    return entry;
  }

  list(nodeId: string) {
    return [...(this.entries.get(nodeId) ?? [])];
  }
}

type AppRouteDeps = {
  app: ReturnType<typeof Fastify>;
  authConfig: ReturnType<typeof resolveAuthConfig>;
  registrationToken: string;
  repository: Repository;
  nodeSockets: Map<string, NodeSocket>;
  mcpSessions: Map<string, McpSessionState>;
  pendingDirectoryBrowses: Map<
    string,
    {
      resolve: (payload: BrowseNodeDirectoriesResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >;
  isAuthenticated: (cookieValue: string | undefined) => boolean;
  requireBrowserAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  topologySnapshot: () => Promise<TopologySnapshot>;
  broadcastTopology: () => Promise<void>;
  broadcastSession: (sessionId: string) => Promise<void>;
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void;
  nodeLogs: NodeLogStore;
};

function websocketSend(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload));
}

export function defaultDbPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../data/amesh.sqlite");
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  void app.register(cookie);
  const db = createDatabase(options.dbPath ?? defaultDbPath());
  const repository = new Repository(db);
  const registrationToken =
    options.registrationToken ?? process.env.AMESH_REGISTRATION_TOKEN ?? "";
  const nodeRepo = options.nodeRepo ?? process.env.AMESH_REPO ?? "code-rabi/amesh";
  const fixedLatestNodeVersion = options.latestNodeVersion;
  const authConfig = resolveAuthConfig({
    password: options.authPassword,
    secret: options.authSecret
  });
  const browserSockets = new Set<WebSocket>();
  const nodeSockets = new Map<string, NodeSocket>();
  const nodeVersions = new Map<string, string | null>();
  const nodeLogs = new NodeLogStore();
  const mcpSessions = new Map<string, McpSessionState>();
  const pendingDirectoryBrowses = new Map<
    string,
    {
      resolve: (payload: BrowseNodeDirectoriesResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const websocketServer = new WebSocketServer({ noServer: true });
  let latestVersionCache: { value: string | null; fetchedAt: number; pending: Promise<string | null> | null } =
    { value: null, fetchedAt: 0, pending: null };

  function isAuthenticated(cookieValue: string | undefined) {
    return verifySession(authConfig, cookieValue) !== null;
  }

  async function requireBrowserAuth(request: FastifyRequest, reply: FastifyReply) {
    if (isAuthenticated(request.cookies[authConfig.cookieName])) {
      return;
    }
    reply.code(401).send({ message: "authentication required" });
  }

  function updateRequired(version: string | null | undefined, latestVersion: string | null) {
    return Boolean(version && latestVersion && version !== latestVersion);
  }

  async function fetchLatestNodeVersion() {
    if (fixedLatestNodeVersion !== undefined) {
      return fixedLatestNodeVersion;
    }

    const now = Date.now();
    if (latestVersionCache.pending) {
      return latestVersionCache.pending;
    }
    if (latestVersionCache.fetchedAt !== 0 && now-latestVersionCache.fetchedAt < 5 * 60 * 1000) {
      return latestVersionCache.value;
    }

    latestVersionCache.pending = fetch(`https://api.github.com/repos/${nodeRepo}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json"
      }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`github release lookup failed: ${response.status}`);
        }
        const body = (await response.json()) as { tag_name?: unknown };
        const tag = typeof body.tag_name === "string" ? body.tag_name.trim() : "";
        return tag || null;
      })
      .catch(() => latestVersionCache.value)
      .finally(() => {
        latestVersionCache.pending = null;
        latestVersionCache.fetchedAt = Date.now();
      });

    const value = await latestVersionCache.pending;
    latestVersionCache.value = value;
    return value;
  }

  async function topologySnapshot() {
    const snapshot = repository.listTopology();
    const latestVersion = await fetchLatestNodeVersion();
    return topologySnapshotSchema.parse({
      ...snapshot,
      nodes: snapshot.nodes.map((node) => {
        const version = nodeVersions.get(node.id) ?? null;
        return {
          ...node,
          version,
          latestVersion,
          updateRequired: updateRequired(version, latestVersion)
        };
      })
    });
  }

  async function broadcastTopology() {
    const snapshot = await topologySnapshot();
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

  function broadcastNodeLogs(nodeId: string) {
    const message = browserRealtimeEventSchema.parse({
      type: "node.logs.updated",
      payload: nodeLogsResponseSchema.parse({
        nodeId,
        entries: nodeLogs.list(nodeId)
      })
    });
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
      void topologySnapshot().then((snapshot) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        websocketSend(socket, {
          type: "topology.snapshot",
          payload: snapshot
        } satisfies BrowserRealtimeEvent);
      });
      socket.on("close", () => {
        browserSockets.delete(socket);
      });
      return;
    }

    let boundNodeId = nodeId ?? "";
    socket.on("message", (data) => {
      try {
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
            nodeVersions.set(node.id, payload.version ?? null);
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
            const payload = nodeResumePayloadSchema.parse(
              envelope.payload
            ) as NodeResumePayload;
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
            nodeVersions.set(node.id, payload.version ?? null);
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
          case "node.log": {
            const payload = nodeLogPayloadSchema.parse(envelope.payload) as NodeLogPayload;
            nodeLogs.append(payload);
            broadcastNodeLogs(payload.nodeId);
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
          case "node.paths.browse.result": {
            const payload = nodeDirectoryBrowseResultPayloadSchema.parse(
              envelope.payload
            ) as NodeDirectoryBrowseResultPayload;
            const pending = pendingDirectoryBrowses.get(envelope.requestId);
            if (!pending) {
              break;
            }
            clearTimeout(pending.timeout);
            pendingDirectoryBrowses.delete(envelope.requestId);
            pending.resolve(
              browseNodeDirectoriesResponseSchema.parse({
                path: payload.path,
                entries: payload.entries
              }) as BrowseNodeDirectoriesResponse
            );
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
      } catch (error) {
        app.log.error({ error }, "invalid websocket message");
        websocketSend(socket, {
          type: "node.message.rejected",
          payload: {
            reason: "invalid_message"
          }
        });
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
      cwd: typeof targetAgent.capabilities.cwd === "string" ? targetAgent.capabilities.cwd : null,
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
        cwd: childSession.cwd,
        parentSessionId: payload.parentSessionId
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

  registerApiRoutes({
    app,
    authConfig,
    registrationToken,
    repository,
    nodeSockets,
    mcpSessions,
    pendingDirectoryBrowses,
    isAuthenticated,
    requireBrowserAuth,
    topologySnapshot,
    broadcastTopology,
    broadcastSession,
    sendToNode,
    nodeLogs
  });

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const role = url.searchParams.get("role") as Role | null;
    if (role === "browser") {
      const rawCookie = readSessionCookieFromHeader(request.headers.cookie, authConfig.cookieName);
      if (!isAuthenticated(rawCookie ?? undefined)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      bindSocket(client, role, url.searchParams.get("nodeId"));
    });
  });

  app.addHook("onClose", async () => {
    for (const state of mcpSessions.values()) {
      await state.transport.close();
    }
    mcpSessions.clear();
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

function registerApiRoutes({
  app,
  authConfig,
  registrationToken,
  repository,
  nodeSockets,
  mcpSessions,
  pendingDirectoryBrowses,
  isAuthenticated,
  requireBrowserAuth,
  topologySnapshot,
  broadcastTopology,
  broadcastSession,
  sendToNode,
  nodeLogs
}: AppRouteDeps) {
  async function authenticateMcpRequest(request: FastifyRequest, reply: FastifyReply) {
    const origin = request.headers.origin;
    if (origin) {
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        reply.code(400).send({ message: "invalid origin header" });
        return null;
      }
      if (parsedOrigin.host !== request.headers.host) {
        reply.code(403).send({ message: "origin not allowed" });
        return null;
      }
    }

    const cookieSession = verifySession(authConfig, request.cookies[authConfig.cookieName]);
    if (cookieSession) {
      return {
        authMode: "browser_session" as const
      };
    }

    const authorization = request.headers.authorization ?? "";
    const [scheme, token] = authorization.split(" ", 2);
    if (scheme === "Bearer" && typeof token === "string") {
      if (constantTimeStringEqual(token, authConfig.password)) {
        return { authMode: "admin_password" as const };
      }
      if (registrationToken && constantTimeStringEqual(token, registrationToken)) {
        return { authMode: "registration_token" as const };
      }
    }

    reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="amesh-mcp"')
      .send({ message: "authentication required" });
    return null;
  }

  function scopedMcpAgent(request: FastifyRequest, reply: FastifyReply, auth: { authMode: McpScope["authMode"] }) {
    const scopedAgentId = typeof request.headers["x-amesh-agent-id"] === "string"
      ? request.headers["x-amesh-agent-id"].trim()
      : "";
    const scopedNodeId = typeof request.headers["x-amesh-node-id"] === "string"
      ? request.headers["x-amesh-node-id"].trim()
      : "";

    if (!scopedAgentId) {
      return {
        authMode: auth.authMode,
        scopedAgentId: null,
        scopedNodeId: null
      } satisfies McpScope;
    }

    const agent = repository.findAgent(scopedAgentId);
    if (!agent) {
      reply.code(404).send({ message: `scoped agent not found: ${scopedAgentId}` });
      return null;
    }
    if (scopedNodeId && scopedNodeId !== agent.nodeId) {
      reply.code(400).send({ message: "scoped node does not match scoped agent" });
      return null;
    }

    return {
      authMode: auth.authMode,
      scopedAgentId: agent.id,
      scopedNodeId: agent.nodeId
    } satisfies McpScope;
  }

  function isInitializeRequest(body: unknown) {
    if (!body || typeof body !== "object") {
      return false;
    }
    const candidate = body as { method?: unknown };
    return candidate.method === "initialize";
  }

  async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply) {
    const auth = await authenticateMcpRequest(request, reply);
    if (!auth) {
      return;
    }

    const requestedSessionId = typeof request.headers["mcp-session-id"] === "string"
      ? request.headers["mcp-session-id"]
      : null;

    let sessionState = requestedSessionId ? mcpSessions.get(requestedSessionId) ?? null : null;
    if (requestedSessionId && !sessionState) {
      reply.code(404).send({ message: "unknown MCP session" });
      return;
    }

    if (!sessionState && request.method === "GET") {
      reply.code(405).send({ message: "GET SSE is not enabled for this MCP endpoint" });
      return;
    }

    if (!sessionState) {
      if (request.method === "DELETE") {
        reply.code(404).send({ message: "unknown MCP session" });
        return;
      }
      if (!isInitializeRequest(request.body)) {
        reply.code(400).send({ message: "MCP session must start with initialize" });
        return;
      }

      const scope = scopedMcpAgent(request, reply, auth);
      if (!scope) {
        return;
      }

      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          mcpSessions.delete(transport.sessionId);
        }
      };
      transport.onerror = (error) => {
        app.log.error({ error }, "mcp transport error");
      };

      const server = buildAmeshMcpServer(scope, {
        repository,
        nodeSockets,
        sendToNode
      });
      await server.connect(transport);
      sessionState = {
        scope,
        transport
      };
    }

    reply.hijack();
    try {
      await sessionState.transport.handleRequest(request.raw, reply.raw, request.body);
      const createdSessionId = sessionState.transport.sessionId;
      if (createdSessionId && !mcpSessions.has(createdSessionId)) {
        mcpSessions.set(createdSessionId, sessionState);
      }
    } catch (error) {
      if (sessionState.transport.sessionId) {
        mcpSessions.delete(sessionState.transport.sessionId);
      }
      throw error;
    }
  }

  app.get("/api/auth/session", async (request: FastifyRequest) => ({
    authenticated: isAuthenticated(request.cookies[authConfig.cookieName]),
    username: authConfig.username
  }));

  app.post("/api/auth/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { password?: unknown } | undefined;
    const password = typeof body?.password === "string" ? body.password : "";
    if (!constantTimeStringEqual(password, authConfig.password)) {
      reply.code(401).send({ message: "invalid password" });
      return;
    }

    reply.setCookie(authConfig.cookieName, issueSession(authConfig, authConfig.username), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(authConfig.sessionTtlMs / 1000)
    });
    return { authenticated: true, username: authConfig.username };
  });

  app.post("/api/auth/logout", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(authConfig.cookieName, { path: "/" });
    return { authenticated: false };
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: handleMcpRequest
  });

  app.get("/api/nodes", { preHandler: requireBrowserAuth }, async () => (await topologySnapshot()).nodes);
  app.get("/api/agents", { preHandler: requireBrowserAuth }, async () => repository.listTopology().agents);
  app.get("/api/bootstrap", { preHandler: requireBrowserAuth }, async () => ({ registrationToken }));
  app.get("/api/trigger-rules", { preHandler: requireBrowserAuth }, async () =>
    repository.listTopology().triggerRules
  );
  app.get("/api/topology", { preHandler: requireBrowserAuth }, async () => topologySnapshot());
  app.get("/api/nodes/:nodeId/logs", { preHandler: requireBrowserAuth }, async (request: FastifyRequest) => {
    const params = request.params as { nodeId: string };
    return nodeLogsResponseSchema.parse({
      nodeId: params.nodeId,
      entries: nodeLogs.list(params.nodeId)
    });
  });
  app.post("/api/nodes/:nodeId/update", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) =>
    triggerNodeAction(request, reply, repository, nodeSockets, sendToNode, "update")
  );
  app.post("/api/nodes/:nodeId/detect", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) =>
    triggerNodeAction(request, reply, repository, nodeSockets, sendToNode, "detect")
  );
  app.post("/api/nodes/:nodeId/paths", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { nodeId: string };
    const body = updateNodePathsRequestSchema.parse(request.body) as { paths: string[] };
    return triggerNodePathUpdate(params.nodeId, body.paths, reply, repository, nodeSockets, sendToNode);
  });
  app.get("/api/nodes/:nodeId/directories", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { nodeId: string };
    const query = browseNodeDirectoriesQuerySchema.parse(request.query) as BrowseNodeDirectoriesQuery;
    return triggerNodeDirectoryBrowse(
      params.nodeId,
      query.path,
      reply,
      repository,
      nodeSockets,
      sendToNode,
      pendingDirectoryBrowses
    );
  });
  app.get("/api/sessions", { preHandler: requireBrowserAuth }, async () => repository.listSessions());
  app.get("/api/sessions/:sessionId", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const state = repository.getSession((request.params as { sessionId: string }).sessionId);
    if (!state) {
      reply.code(404);
      return { message: "session not found" };
    }
    return state;
  });

  app.post("/api/trigger-rules", { preHandler: requireBrowserAuth }, async (request: FastifyRequest) => {
    const body = upsertTriggerRuleRequestSchema.parse(request.body) as UpsertTriggerRuleRequest;
    const rule = repository.upsertTriggerRule(body);
    await broadcastTopology();
    return rule;
  });
  app.delete("/api/trigger-rules/:id", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const deleted = repository.deleteTriggerRule(params.id);
    if (!deleted) {
      reply.code(404);
      return { message: "trigger rule not found" };
    }
    await broadcastTopology();
    return { ok: true };
  });

  app.post("/api/sessions", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSessionRequestSchema.parse(request.body) as CreateSessionRequest;
    const agent = repository.findAgent(body.agentId);
    if (!agent) {
      reply.code(404);
      return { message: "agent not found" };
    }
    if (agent.nodeId !== body.nodeId) {
      reply.code(400);
      return { message: "agent does not belong to node" };
    }
    const requestedCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const fixedCwd = typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
    const cwd = requestedCwd || fixedCwd;
    const node = repository.findNode(body.nodeId);
    if (!node) {
      reply.code(404);
      return { message: "node not found" };
    }
    if (requestedCwd && requestedCwd !== fixedCwd && !node.paths.includes(requestedCwd)) {
      reply.code(400);
      return { message: "folder is not exposed on node" };
    }
    const session = repository.createSession({
      entryAgentId: body.agentId,
      initiator: "user",
      cwd
    });
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
        initiator: "user",
        cwd,
        parentSessionId: null
      })
    });
    await broadcastSession(session.id);
    return repository.getSession(session.id);
  });

  app.post("/api/sessions/:sessionId/input", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
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

  app.post("/api/sessions/:sessionId/cancel", { preHandler: requireBrowserAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
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
}

function validateOnlineNodeAction(
  nodeId: string,
  action: string,
  reply: FastifyReply,
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>
) {
  const node = repository.findNode(nodeId);
  if (!node) {
    reply.code(404);
    return { ok: false as const, body: { message: "node not found" } };
  }
  if (node.status !== "online") {
    reply.code(409);
    return { ok: false as const, body: { message: `node must be online to ${action}` } };
  }
  if (!nodeSockets.has(node.id)) {
    reply.code(409);
    return { ok: false as const, body: { message: "node socket is not connected" } };
  }
  return { ok: true as const, node };
}

async function triggerNodeAction(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void,
  action: "update" | "detect"
) {
  const params = request.params as { nodeId: string };
  const validation = validateOnlineNodeAction(
    params.nodeId,
    action === "update" ? "update" : "detect agents",
    reply,
    repository,
    nodeSockets
  );
  if (!validation.ok) {
    return validation.body;
  }

  sendToNode(validation.node.id, {
    type: action === "update" ? "node.update" : "node.detect",
    requestId: nanoid(10),
    sessionId: null,
    source: "server",
    target: validation.node.id,
    payload: {
      nodeId: validation.node.id
    }
  });
  return { ok: true };
}

function triggerNodePathUpdate(
  nodeId: string,
  paths: string[],
  reply: FastifyReply,
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void
) {
  const validation = validateOnlineNodeAction(
    nodeId,
    "update exposed paths",
    reply,
    repository,
    nodeSockets
  );
  if (!validation.ok) {
    return validation.body;
  }

  repository.setNodePaths(validation.node.id, paths);

  sendToNode(validation.node.id, {
    type: "node.paths.update",
    requestId: nanoid(10),
    sessionId: null,
    source: "server",
    target: validation.node.id,
    payload: nodePathsUpdatePayloadSchema.parse({
      nodeId: validation.node.id,
      paths
    }) as NodePathsUpdatePayload
  });
  return { ok: true };
}

function triggerNodeDirectoryBrowse(
  nodeId: string,
  path: string | undefined,
  reply: FastifyReply,
  repository: Repository,
  nodeSockets: Map<string, NodeSocket>,
  sendToNode: (nodeId: string, envelope: ProtocolEnvelope) => void,
  pendingDirectoryBrowses: Map<
    string,
    {
      resolve: (payload: BrowseNodeDirectoriesResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >
) {
  const validation = validateOnlineNodeAction(
    nodeId,
    "browse directories",
    reply,
    repository,
    nodeSockets
  );
  if (!validation.ok) {
    return validation.body;
  }

  const requestId = nanoid(10);
  return new Promise<BrowseNodeDirectoriesResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingDirectoryBrowses.delete(requestId);
      reject(new Error("directory browse timed out"));
    }, 5000);

    pendingDirectoryBrowses.set(requestId, { resolve, reject, timeout });
    sendToNode(validation.node.id, {
      type: "node.paths.browse",
      requestId,
      sessionId: null,
      source: "server",
      target: validation.node.id,
      payload: nodeDirectoryBrowsePayloadSchema.parse({
        nodeId: validation.node.id,
        path: path ?? ""
      }) as NodeDirectoryBrowsePayload
    });
  });
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
