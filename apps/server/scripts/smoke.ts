import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { buildApp } from "../src/app.js";
import { WebSocket } from "ws";

async function main() {
  const app = buildApp({
    dbPath: ":memory:",
    authPassword: "secret-pass",
    authSecret: "test-secret"
  });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("server address missing");
  }

  const base = `127.0.0.1:${address.port}`;
  const sourceNode = await connectNode(base, "node-source");
  const targetNode = await connectNode(base, "node-target");
  const authCookie = await loginCookie(app);

  try {
    sourceNode.socket.send(JSON.stringify(registerNode("node-source", "source-host")));
    targetNode.socket.send(JSON.stringify(registerNode("node-target", "target-host")));
    sourceNode.socket.send(
      JSON.stringify(
        syncCapabilities("node-source", [
          { id: "agent-claude", name: "Claude", acpxAgent: "claude" }
        ])
      )
    );
    targetNode.socket.send(
      JSON.stringify(
        syncCapabilities("node-target", [
          { id: "agent-codex", name: "Codex", acpxAgent: "codex" }
        ])
      )
    );

    await idle();

    const direct = await injectAuthed(app, authCookie, {
      method: "POST",
      url: "/api/sessions",
      payload: {
        nodeId: "node-source",
        agentId: "agent-claude",
        cwd: null,
        prompt: "say hello"
      }
    });
    const directSessionId = direct.json().session.id;
    const startMessage = await nextMessage(sourceNode.socket);
    assert(startMessage.type === "session.start", "expected direct session.start");
    sourceNode.socket.send(
      JSON.stringify(
        sessionEvent("node-source", directSessionId, "agent-claude", "session.output.completed", {
          text: "hello"
        })
      )
    );
    await idle();

    const directState = await injectAuthed(app, authCookie, {
      method: "GET",
      url: `/api/sessions/${directSessionId}`
    });
    assert(
      directState.json().session.status === "completed",
      "expected direct session to complete"
    );

    sourceNode.socket.send(
      JSON.stringify({
        type: "session.event",
        requestId: "invoke-denied",
        sessionId: directSessionId,
        source: "node-source",
        target: "server",
        payload: {
          id: "evt-denied",
          sessionId: directSessionId,
          eventType: "session.invocation.requested",
          sourceAgentId: "agent-claude",
          targetAgentId: "agent-codex",
          payload: {
            parentSessionId: directSessionId,
            sourceAgentId: "agent-claude",
            targetAgentId: "agent-codex",
            prompt: "deny this"
          },
          createdAt: new Date().toISOString()
        }
      })
    );
    await idle();

    const deniedState = await injectAuthed(app, authCookie, {
      method: "GET",
      url: `/api/sessions/${directSessionId}`
    });
    const deniedEventTypes = deniedState
      .json()
      .events.map((event: { eventType: string }) => event.eventType);
    assert(deniedEventTypes.includes("session.invocation.denied"), "expected denied invocation");
    assert(deniedEventTypes.includes("audit"), "expected audit event for denied invocation");

    await injectAuthed(app, authCookie, {
      method: "POST",
      url: "/api/trigger-rules",
      payload: {
        sourceAgentId: "agent-claude",
        targetAgentId: "agent-codex",
        mode: "allow"
      }
    });

    sourceNode.socket.send(
      JSON.stringify({
        type: "session.event",
        requestId: "invoke-allowed",
        sessionId: directSessionId,
        source: "node-source",
        target: "server",
        payload: {
          id: "evt-allowed",
          sessionId: directSessionId,
          eventType: "session.invocation.requested",
          sourceAgentId: "agent-claude",
          targetAgentId: "agent-codex",
          payload: {
            parentSessionId: directSessionId,
            sourceAgentId: "agent-claude",
            targetAgentId: "agent-codex",
            prompt: "delegate this"
          },
          createdAt: new Date().toISOString()
        }
      })
    );

    const childStart = await nextMessage(targetNode.socket);
    assert(childStart.type === "session.start", "expected routed child session.start");
    targetNode.socket.send(
      JSON.stringify(
        sessionEvent(
          "node-target",
          String(childStart.sessionId),
          "agent-codex",
          "session.output.completed",
          { text: "delegated result" }
        )
      )
    );
    await idle();

    const allowedState = await injectAuthed(app, authCookie, {
      method: "GET",
      url: `/api/sessions/${directSessionId}`
    });
    const allowedEventTypes = allowedState
      .json()
      .events.map((event: { eventType: string }) => event.eventType);
    assert(allowedEventTypes.includes("session.invocation.allowed"), "expected allowed invocation");
    assert(
      allowedEventTypes.includes("session.invocation.completed"),
      "expected invocation completion to flow back to parent session"
    );

    console.log("amesh smoke passed");
  } finally {
    sourceNode.socket.close();
    targetNode.socket.close();
    await app.close();
  }
}

type NodeConnection = {
  socket: WebSocket;
};

async function connectNode(base: string, nodeId: string): Promise<NodeConnection> {
  const socket = new WebSocket(`ws://${base}/ws?role=node&nodeId=${nodeId}`);
  await once(socket, "open");
  return { socket };
}

function registerNode(nodeId: string, host: string) {
  return {
    type: "node.register",
    requestId: `register-${nodeId}`,
    sessionId: null,
    source: nodeId,
    target: "server",
    payload: {
      registrationToken: "demo-token",
      nodeName: nodeId,
      host,
      labels: ["demo"]
    }
  };
}

function syncCapabilities(
  nodeId: string,
  capabilities: Array<{ id: string; name: string; acpxAgent: string }>
) {
  return {
    type: "node.capabilities.sync",
    requestId: `caps-${nodeId}`,
    sessionId: null,
    source: nodeId,
    target: "server",
    payload: {
      nodeId,
      capabilities: capabilities.map((capability) => ({
        ...capability,
        command: "acpx",
        args: ["run"],
        env: {},
        labels: ["demo"]
      }))
    }
  };
}

function sessionEvent(
  sourceNodeId: string,
  sessionId: string,
  sourceAgentId: string,
  eventType: "session.output.completed" | "session.failed" | "session.cancelled",
  payload: Record<string, unknown>
) {
  return {
    type: "session.event",
    requestId: `evt-${Date.now()}`,
    sessionId,
    source: sourceNodeId,
    target: "server",
    payload: {
      id: `evt-${Date.now()}`,
      sessionId,
      eventType,
      sourceAgentId,
      targetAgentId: null,
      payload,
      createdAt: new Date().toISOString()
    }
  };
}

async function nextMessage(socket: WebSocket) {
  const [message] = await once(socket, "message");
  return JSON.parse(String(message)) as Record<string, unknown>;
}

async function idle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function loginCookie(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      password: "secret-pass"
    }
  });
  const cookie = response.headers["set-cookie"];
  assert(cookie, "expected auth cookie from login");
  return String(cookie).split(";")[0];
}

async function injectAuthed(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  options: {
    method: "GET" | "POST";
    url: string;
    payload?: any;
    headers?: Record<string, string>;
  }
) : Promise<{
  json: () => any;
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return (await app.inject({
    ...options,
    headers: {
      ...(options.headers ?? {}),
      cookie
    }
  })) as any;
}

void main();
