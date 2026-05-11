import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildApp } from "../src/app.js";

describe("server app", () => {
  let app: ReturnType<typeof buildApp>;
  let address = "";

  beforeEach(async () => {
    app = buildApp({ dbPath: ":memory:" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const serverAddress = app.server.address() as AddressInfo | null;
    if (!serverAddress) {
      throw new Error("server address missing");
    }
    address = `${serverAddress.address}:${serverAddress.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers a node and lists its advertised agent", async () => {
    const socket = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    await waitForOpen(socket);
    socket.send(
      JSON.stringify({
        type: "node.register",
        requestId: "req_1",
        sessionId: null,
        source: "node-1",
        target: "server",
        payload: {
          registrationToken: "token",
          nodeName: "node-a",
          host: "host-a",
          labels: ["demo"]
        }
      })
    );
    socket.send(
      JSON.stringify({
        type: "node.capabilities.sync",
        requestId: "req_2",
        sessionId: null,
        source: "node-1",
        target: "server",
        payload: {
          nodeId: "node-1",
          capabilities: [
            {
              id: "agent-1",
              name: "Planner",
              acpxAgent: "planner",
              command: "acpx",
              args: ["run"],
              env: {},
              labels: []
            }
          ]
        }
      })
    );

    const registered = (await readNodeMessage(socket)) as {
      type: string;
      payload: { nodeId: string; reconnectToken: string };
    };
    expect(registered.type).toBe("node.registered");
    expect(registered.payload).toMatchObject({
      nodeId: "node-1"
    });
    expect(typeof registered.payload.reconnectToken).toBe("string");

    await waitForIdle();

    const response = await app.inject({
      method: "GET",
      url: "/api/topology"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().agents).toHaveLength(1);

    const nodesResponse = await app.inject({
      method: "GET",
      url: "/api/nodes"
    });
    expect(nodesResponse.statusCode).toBe(200);
    expect(nodesResponse.json()).toHaveLength(1);

    const agentsResponse = await app.inject({
      method: "GET",
      url: "/api/agents"
    });
    expect(agentsResponse.statusCode).toBe(200);
    expect(agentsResponse.json()).toHaveLength(1);
    socket.close();
  });

  it("rejects registration with an invalid bootstrap token when one is configured", async () => {
    const guardedApp = buildApp({
      dbPath: ":memory:",
      registrationToken: "expected-token"
    });
    await guardedApp.listen({ port: 0, host: "127.0.0.1" });
    const guardedAddress = guardedApp.server.address() as AddressInfo | null;
    if (!guardedAddress) {
      throw new Error("server address missing");
    }

    const socket = new WebSocket(
      `ws://${guardedAddress.address}:${guardedAddress.port}/ws?role=node&nodeId=node-guarded`
    );
    await waitForOpen(socket);
    socket.send(
      JSON.stringify({
        type: "node.register",
        requestId: "req_invalid_token",
        sessionId: null,
        source: "node-guarded",
        target: "server",
        payload: {
          registrationToken: "wrong-token",
          nodeName: "guarded",
          host: "guarded-host",
          labels: []
        }
      })
    );

    const denied = await readNodeMessage(socket);
    expect(denied.type).toBe("node.registration.denied");
    await guardedApp.close();
  });

  it("resumes a registered node with a reconnect token and keeps routing sessions", async () => {
    const firstSocket = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    await waitForOpen(firstSocket);
    firstSocket.send(JSON.stringify(registerNode("node-1", "a")));
    const registered = (await readNodeMessage(firstSocket)) as {
      type: string;
      payload: { nodeId: string; reconnectToken: string };
    };
    const reconnectToken = String(registered.payload.reconnectToken);
    firstSocket.send(
      JSON.stringify(syncCapabilities("node-1", [{ id: "agent-a", name: "A", acpxAgent: "claude" }]))
    );
    await waitForIdle();
    firstSocket.close();
    await waitForIdle();

    const resumedSocket = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    await waitForOpen(resumedSocket);
    resumedSocket.send(
      JSON.stringify({
        type: "node.resume",
        requestId: "resume-node-1",
        sessionId: null,
        source: "node-1",
        target: "server",
        payload: {
          nodeId: "node-1",
          reconnectToken
        }
      })
    );
    const resumed = await readNodeMessage(resumedSocket);
    expect(resumed.type).toBe("node.resumed");

    const create = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        agentId: "agent-a",
        prompt: "resume still works"
      }
    });
    expect(create.statusCode).toBe(200);

    const startMessage = await readNodeMessage(resumedSocket);
    expect(startMessage.type).toBe("session.start");
    resumedSocket.close();
  });

  it("blocks cross-agent invocation without an allow rule and emits audit state", async () => {
    const node1 = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    const node2 = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-2`);
    await Promise.all([waitForOpen(node1), waitForOpen(node2)]);

    node1.send(JSON.stringify(registerNode("node-1", "a")));
    node2.send(JSON.stringify(registerNode("node-2", "b")));
    await readNodeMessage(node1);
    await readNodeMessage(node2);
    node1.send(
      JSON.stringify(syncCapabilities("node-1", [{ id: "agent-a", name: "A", acpxAgent: "a" }]))
    );
    node2.send(
      JSON.stringify(syncCapabilities("node-2", [{ id: "agent-b", name: "B", acpxAgent: "b" }]))
    );

    await waitForIdle();

    const create = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        agentId: "agent-a",
        prompt: "hi"
      }
    });
    const sessionId = create.json().session.id;

    node1.send(
      JSON.stringify({
        type: "session.event",
        requestId: "req_4",
        sessionId,
        source: "node-1",
        target: "server",
        payload: {
          id: "evt-1",
          sessionId,
          eventType: "session.invocation.requested",
          sourceAgentId: "agent-a",
          targetAgentId: "agent-b",
          payload: {
            parentSessionId: sessionId,
            sourceAgentId: "agent-a",
            targetAgentId: "agent-b",
            prompt: "call B"
          },
          createdAt: new Date().toISOString()
        }
      })
    );

    await waitForIdle();

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`
    });
    const eventTypes = state
      .json()
      .events.map((event: { eventType: string }) => event.eventType);

    expect(eventTypes).toContain("session.invocation.denied");
    expect(eventTypes).toContain("audit");

    node1.close();
    node2.close();
  });

  it("allows a configured cross-node invocation and records child completion on the parent session", async () => {
    const node1 = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    const node2 = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-2`);
    await Promise.all([waitForOpen(node1), waitForOpen(node2)]);

    node1.send(JSON.stringify(registerNode("node-1", "a")));
    node2.send(JSON.stringify(registerNode("node-2", "b")));
    await readNodeMessage(node1);
    await readNodeMessage(node2);
    node1.send(
      JSON.stringify(syncCapabilities("node-1", [{ id: "agent-a", name: "Claude", acpxAgent: "claude" }]))
    );
    node2.send(
      JSON.stringify(syncCapabilities("node-2", [{ id: "agent-b", name: "Codex", acpxAgent: "codex" }]))
    );

    await waitForIdle();

    const rule = await app.inject({
      method: "POST",
      url: "/api/trigger-rules",
      payload: {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        mode: "allow"
      }
    });
    expect(rule.statusCode).toBe(200);

    const create = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        agentId: "agent-a",
        prompt: "start"
      }
    });
    const parentSessionId = create.json().session.id;
    await readNodeMessage(node1);

    const childStartPromise = readNodeMessage(node2);
    node1.send(
      JSON.stringify({
        type: "session.event",
        requestId: "req_allow",
        sessionId: parentSessionId,
        source: "node-1",
        target: "server",
        payload: {
          id: "evt-allow-1",
          sessionId: parentSessionId,
          eventType: "session.invocation.requested",
          sourceAgentId: "agent-a",
          targetAgentId: "agent-b",
          payload: {
            parentSessionId,
            sourceAgentId: "agent-a",
            targetAgentId: "agent-b",
            prompt: "delegate"
          },
          createdAt: new Date().toISOString()
        }
      })
    );

    const childStart = await childStartPromise;
    expect(childStart.type).toBe("session.start");
    const childSessionId = String(childStart.sessionId);

    node2.send(
      JSON.stringify({
        type: "session.event",
        requestId: "req_allow_complete",
        sessionId: childSessionId,
        source: "node-2",
        target: "server",
        payload: {
          id: "evt-allow-2",
          sessionId: childSessionId,
          eventType: "session.output.completed",
          sourceAgentId: "agent-b",
          targetAgentId: null,
          payload: {
            text: "delegated result"
          },
          createdAt: new Date().toISOString()
        }
      })
    );

    await waitForIdle();

    const parentState = await app.inject({
      method: "GET",
      url: `/api/sessions/${parentSessionId}`
    });
    const parentEventTypes = parentState
      .json()
      .events.map((event: { eventType: string }) => event.eventType);
    expect(parentEventTypes).toContain("session.invocation.allowed");
    expect(parentEventTypes).toContain("session.invocation.completed");

    const childState = await app.inject({
      method: "GET",
      url: `/api/sessions/${childSessionId}`
    });
    expect(childState.json().session.parentSessionId).toBe(parentSessionId);
    expect(childState.json().session.sourceAgentId).toBe("agent-a");

    node1.close();
    node2.close();
  });

  it("cancels an active session and forwards the control message to the node", async () => {
    const node = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    await waitForOpen(node);
    node.send(JSON.stringify(registerNode("node-1", "a")));
    await readNodeMessage(node);
    node.send(
      JSON.stringify(syncCapabilities("node-1", [{ id: "agent-a", name: "A", acpxAgent: "claude" }]))
    );

    await waitForIdle();

    const create = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        agentId: "agent-a",
        prompt: "start"
      }
    });
    const sessionId = create.json().session.id;
    await readNodeMessage(node);

    const cancelPromise = readNodeMessage(node);
    const cancel = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/cancel`
    });
    expect(cancel.statusCode).toBe(200);

    const cancelMessage = await cancelPromise;
    expect(cancelMessage.type).toBe("session.cancel");

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`
    });
    expect(state.json().session.status).toBe("cancelled");

    node.close();
  });

  it("continues an existing chat session by routing session.input to the same node", async () => {
    const node = new WebSocket(`ws://${address}/ws?role=node&nodeId=node-1`);
    await waitForOpen(node);
    try {
      node.send(JSON.stringify(registerNode("node-1", "a")));
      await readNodeMessage(node);
      node.send(
        JSON.stringify(
          syncCapabilities("node-1", [{ id: "agent-a", name: "Claude", acpxAgent: "claude" }])
        )
      );

      await waitForIdle();

      const create = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {
          agentId: "agent-a",
          prompt: "hello"
        }
      });
      const sessionId = create.json().session.id;
      const startMessage = await readNodeMessage(node);
      expect(startMessage.type).toBe("session.start");

      node.send(
        JSON.stringify({
          type: "session.event",
          requestId: "req_complete_1",
          sessionId,
          source: "node-1",
          target: "server",
          payload: {
            id: "evt-complete-1",
            sessionId,
            eventType: "session.output.completed",
            sourceAgentId: "agent-a",
            targetAgentId: null,
            payload: {
              text: "hello back"
            },
            createdAt: new Date().toISOString()
          }
        })
      );
      await waitForIdle();

      const append = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/input`,
        payload: {
          prompt: "follow up"
        }
      });
      expect(append.statusCode).toBe(200);

      const inputMessage = await readNodeMessage(node);
      expect(inputMessage.type).toBe("session.input");
      expect(inputMessage.sessionId).toBe(sessionId);

      node.send(
        JSON.stringify({
          type: "session.event",
          requestId: "req_complete_2",
          sessionId,
          source: "node-1",
          target: "server",
          payload: {
            id: "evt-complete-2",
            sessionId,
            eventType: "session.output.completed",
            sourceAgentId: "agent-a",
            targetAgentId: null,
            payload: {
              text: "follow up back"
            },
            createdAt: new Date().toISOString()
          }
        })
      );
      await waitForIdle();

      const state = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}`
      });
      expect(state.json().session.status).toBe("completed");
      const promptedEvents = state
        .json()
        .events.filter((event: { eventType: string }) => event.eventType === "session.prompted");
      const completedEvents = state
        .json()
        .events.filter((event: { eventType: string }) => event.eventType === "session.output.completed");
      expect(promptedEvents).toHaveLength(1);
      expect(completedEvents).toHaveLength(2);
    } finally {
      node.close();
    }
  });

  it("serves the built dashboard from the control-plane deployable", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "amesh-web-"));
    await writeFile(join(staticRoot, "index.html"), "<html><body>amesh ui</body></html>");
    await writeFile(join(staticRoot, "app.js"), "console.log('amesh')");

    const staticApp = buildApp({ dbPath: ":memory:", staticRoot });
    const root = await staticApp.inject({
      method: "GET",
      url: "/"
    });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("amesh ui");

    const spaRoute = await staticApp.inject({
      method: "GET",
      url: "/sessions/abc"
    });
    expect(spaRoute.statusCode).toBe(200);
    expect(spaRoute.body).toContain("amesh ui");

    const asset = await staticApp.inject({
      method: "GET",
      url: "/app.js"
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("application/javascript");

    await staticApp.close();
  });

  it("deletes trigger rules through the control-plane API", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/trigger-rules",
      payload: {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        mode: "allow"
      }
    });
    const ruleId = create.json().id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/trigger-rules/${ruleId}`
    });
    expect(deleted.statusCode).toBe(200);

    const rules = await app.inject({
      method: "GET",
      url: "/api/trigger-rules"
    });
    expect(rules.json()).toEqual([]);
  });
});

function registerNode(nodeId: string, name: string) {
  return {
    type: "node.register",
    requestId: `register-${nodeId}`,
    sessionId: null,
    source: nodeId,
    target: "server",
    payload: {
      registrationToken: "token",
      nodeName: name,
      host: `${name}.example`,
      labels: []
    }
  };
}

function syncCapabilities(nodeId: string, capabilities: Array<{ id: string; name: string; acpxAgent: string }>) {
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
        labels: []
      }))
    }
  };
}

async function waitForOpen(socket: WebSocket) {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function waitForIdle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function readNodeMessage(socket: WebSocket) {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once("message", (data) => {
      resolve(JSON.parse(String(data)));
    });
    socket.once("error", reject);
  });
}
