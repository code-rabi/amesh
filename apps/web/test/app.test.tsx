import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let authenticated = true;
let updateRequests = 0;
let detectRequests = 0;
let pathRequests = 0;
let narrowLayout = false;
let updateRequired = true;
let topologyNodes = [
  {
    id: "node-1",
    name: "lab-01",
    host: "lab-01.local",
    status: "online",
    labels: [],
    registeredAt: "",
    lastSeenAt: null,
    version: "v0.1.0",
    latestVersion: "v0.1.1",
    updateRequired: true
  }
];

beforeEach(() => {
  vi.stubGlobal("WebSocket", vi.fn(() => socket));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return response({
          authenticated,
          username: "admin"
        });
      }
      if (url.endsWith("/api/auth/login")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { password?: string };
        if (payload.password === "secret-pass") {
          authenticated = true;
          return response({ authenticated: true });
        }
        return response({ message: "invalid password" }, 401);
      }
      if (url.endsWith("/api/bootstrap")) {
        return response({
          registrationToken: "server-registered-token"
        });
      }
      if (url.endsWith("/api/nodes/node-1/update")) {
        updateRequests += 1;
        return response({ ok: true });
      }
      if (url.endsWith("/api/nodes/node-1/detect")) {
        detectRequests += 1;
        return response({ ok: true });
      }
      if (url.endsWith("/api/nodes/node-1/paths")) {
        pathRequests += 1;
        return response({ ok: true });
      }
      if (url.endsWith("/api/sessions")) {
        return response([]);
      }
      if (url.endsWith("/api/topology")) {
        return response({
          nodes: topologyNodes.map((node) => ({ ...node, updateRequired })),
          agents: [
            {
              id: "agent-1",
              nodeId: "node-1",
              name: "Planner",
              backend: "acpx",
              status: "online",
              capabilities: {
                cwd: "/srv/work/repo-a"
              }
            }
          ],
          triggerRules: []
        });
      }
      return response({});
    })
  );
  authenticated = true;
  updateRequests = 0;
  detectRequests = 0;
  pathRequests = 0;
  narrowLayout = false;
  updateRequired = true;
  topologyNodes = [
    {
      id: "node-1",
      name: "lab-01",
      host: "lab-01.local",
      status: "online",
      labels: [],
      registeredAt: "",
      lastSeenAt: null,
      version: "v0.1.0",
      latestVersion: "v0.1.1",
      updateRequired: true
    }
  ];

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
      matches: narrowLayout,
      addEventListener() {},
      removeEventListener() {}
    }));
  } else {
    vi.stubGlobal("matchMedia", () => ({
      matches: narrowLayout,
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

  it("shows a password form before the dashboard and opens the app after login", async () => {
    authenticated = false;
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText(/admin password/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/admin password/i), {
      target: { value: "secret-pass" }
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByLabelText(/amesh home/i)).toBeTruthy());
  });

  it("loads the registration token from the server when opening the add node panel", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /add node/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add node/i }));

    await waitFor(() => {
      const input = screen.getByLabelText(/registration token/i) as HTMLInputElement;
      expect(input.value).toBe("server-registered-token");
    });
    await waitFor(() =>
      expect(screen.getByText(/REGISTRATION_TOKEN='server-registered-token'/i)).toBeTruthy()
    );
  });

  it("loads the registration token into the empty-state install command", async () => {
    topologyNodes = [];
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() => expect(screen.getByText(/the mesh is empty/i)).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByText(/REGISTRATION_TOKEN='server-registered-token'/i)).toBeTruthy()
    );
  });

  it("triggers a node update from the admin UI", async () => {
    narrowLayout = true;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /update lab-01/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /update lab-01/i }));

    await waitFor(() => expect(updateRequests).toBe(1));
    await waitFor(() =>
      expect(screen.getByText(/update requested\. the node should reconnect after restart\./i)).toBeTruthy()
    );
  });

  it("triggers agent detection from the admin UI", async () => {
    narrowLayout = true;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /detect agents on lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /detect agents on lab-01/i }));

    await waitFor(() => expect(detectRequests).toBe(1));
    await waitFor(() =>
      expect(screen.getByText(/detection requested\. the node will refresh its agent inventory\./i)).toBeTruthy()
    );
  });

  it("updates exposed paths from the admin UI", async () => {
    narrowLayout = true;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /manage exposed paths on lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /manage exposed paths on lab-01/i }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /manage exposed paths for lab-01/i })).toBeTruthy()
    );
    fireEvent.change(screen.getByLabelText(/exposed directories/i), {
      target: { value: "/srv/work/repo-a\n/srv/work/repo-b" }
    });
    fireEvent.click(screen.getByRole("button", { name: /save paths/i }));

    await waitFor(() => expect(pathRequests).toBe(1));
    await waitFor(() =>
      expect(screen.getByText(/exposed paths updated\. the node will refresh its workspace-scoped agents\./i)).toBeTruthy()
    );
  });

  it("hides the node update action when the node is already current", async () => {
    narrowLayout = true;
    updateRequired = false;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/drag-to-connect needs a wider screen/i)).toBeTruthy()
    );
    expect(screen.queryByRole("button", { name: /update lab-01/i })).toBeNull();
  });
});

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  } as Response;
}
