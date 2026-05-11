import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

class MockSocket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

const socket = new MockSocket();

beforeEach(() => {
  vi.stubGlobal("WebSocket", vi.fn(() => socket));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/sessions")) {
        return response([]);
      }
      if (url.endsWith("/api/topology")) {
        return response({
          nodes: [
            {
              id: "node-1",
              name: "lab-01",
              host: "lab-01.local",
              status: "online",
              labels: [],
              registeredAt: "",
              lastSeenAt: null
            }
          ],
          agents: [
            {
              id: "agent-1",
              nodeId: "node-1",
              name: "Planner",
              backend: "acpx",
              status: "online",
              capabilities: {}
            }
          ],
          triggerRules: []
        });
      }
      return response({});
    })
  );

  // jsdom doesn't ship ResizeObserver, matchMedia by default.
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  }
  if (!window.matchMedia) {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    }));
  }
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
});

describe("App shell", () => {
  it("renders the amesh wordmark, route nav, and fleet summary from the topology snapshot", async () => {
    window.history.pushState({}, "", "/sessions");
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText(/amesh home/i)).toBeTruthy());
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeTruthy();

    await waitFor(() => {
      const summary = screen.getByLabelText(/fleet summary/i);
      expect(summary.textContent).toContain("1");
      expect(summary.textContent).toContain("node");
      expect(summary.textContent).toContain("agent");
    });
  });
});

function response(payload: unknown) {
  return {
    async json() {
      return payload;
    }
  } as Response;
}
