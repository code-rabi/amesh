import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

class MockSocket {
  onmessage: ((event: { data: string }) => void) | null = null;

  close() {}
}

const socket = new MockSocket();

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", vi.fn(() => socket));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/topology")) {
          return response({
            nodes: [{ id: "node-1", name: "Node", host: "host", status: "online", labels: [], registeredAt: "", lastSeenAt: "" }],
            agents: [{ id: "agent-1", nodeId: "node-1", name: "Planner", backend: "acpx", status: "online", capabilities: {} }],
            triggerRules: []
          });
        }
        if (url.endsWith("/api/sessions") && !init) {
          return response([
            {
              id: "session-existing",
              entryAgentId: "agent-1",
              initiator: "user",
              status: "completed",
              createdAt: "",
              parentSessionId: null,
              sourceAgentId: null
            }
          ]);
        }
        if (url.endsWith("/api/sessions/session-existing")) {
          return response({
            session: {
              id: "session-existing",
              entryAgentId: "agent-1",
              initiator: "user",
              status: "completed",
              createdAt: "",
              parentSessionId: null,
              sourceAgentId: null
            },
            events: [
              {
                id: "evt-existing",
                eventType: "session.output.completed",
                sourceAgentId: "agent-1",
                targetAgentId: null,
                payload: {
                  text: "saved transcript"
                },
                createdAt: ""
              }
            ]
          });
        }
        if (url.endsWith("/api/sessions") && init?.method === "POST") {
          return response({
            session: {
              id: "session-1",
              entryAgentId: "agent-1",
              initiator: "user",
              status: "running",
              createdAt: "",
              parentSessionId: null,
              sourceAgentId: null
            },
            events: []
          });
        }
        if (url.includes("/input")) {
          return response({
            session: {
              id: "session-1",
              entryAgentId: "agent-1",
              initiator: "user",
              status: "running",
              createdAt: "",
              parentSessionId: null,
              sourceAgentId: null
            },
            events: []
          });
        }
        return response({
          id: "rule-1",
          sourceAgentId: "agent-1",
          targetAgentId: "agent-1",
          mode: "allow"
        });
      })
    );
  });

  it("loads prior session history and starts a new chat session", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("Start Session")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/saved transcript/)).toBeTruthy());
    fireEvent.click(screen.getByText("Send prompt"));

    await waitFor(() => expect(screen.getByText("running")).toBeTruthy());
  });
});

function response(payload: unknown) {
  return {
    async json() {
      return payload;
    }
  } as Response;
}
