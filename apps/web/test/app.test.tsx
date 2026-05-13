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
type TestAgent = {
  id: string;
  nodeId: string;
  name: string;
  backend: "acpx";
  status: string;
  capabilities: {
    acpxAgent: string;
    cwd?: string;
    error?: string;
  };
};
type TestSessionView = {
  session: {
    id: string;
    entryAgentId: string;
    initiator: "user" | "agent";
    status: string;
    createdAt: string;
    cwd: string | null;
    parentSessionId: string | null;
    sourceAgentId: string | null;
  };
  events: Array<{
    id: string;
    eventType: string;
    sourceAgentId: string | null;
    targetAgentId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
};
let authenticated = true;
let updateRequests = 0;
let detectRequests = 0;
let pathRequests = 0;
let directoryRequests = 0;
let narrowLayout = false;
let updateRequired = true;
let sessionViews: Record<string, TestSessionView> = {};
let topologyAgents: TestAgent[] = [
  {
    id: "agent-1",
    nodeId: "node-1",
    name: "Planner",
    backend: "acpx",
    status: "error",
    capabilities: {
      acpxAgent: "planner",
      cwd: "/srv/work/repo-a",
      error: "codex login required"
    }
  }
];
let topologyNodes = [
  {
    id: "node-1",
    name: "lab-01",
    host: "lab-01.local",
    status: "online",
    labels: [],
    paths: ["/srv/work/repo-a"],
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
      const parsed = new URL(url, "http://localhost");
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
      if (parsed.pathname.endsWith("/api/nodes/node-1/update")) {
        updateRequests += 1;
        return response({ ok: true });
      }
      if (parsed.pathname.endsWith("/api/nodes/node-1/detect")) {
        detectRequests += 1;
        return response({ ok: true });
      }
      if (parsed.pathname.endsWith("/api/nodes/node-1/paths")) {
        pathRequests += 1;
        const payload = JSON.parse(String(init?.body ?? "{}")) as { paths?: string[] };
        topologyNodes = topologyNodes.map((node) =>
          node.id === "node-1" ? { ...node, paths: payload.paths ?? [] } : node
        );
        return response({ ok: true });
      }
      if (parsed.pathname.endsWith("/api/nodes/node-1/directories")) {
        directoryRequests += 1;
        const path = parsed.searchParams.get("path") ?? "";
        if (path === "/srv/work/repo-a") {
          return response({
            path: "/srv/work/repo-a",
            entries: [{ name: "src", path: "/srv/work/repo-a/src", hasChildren: false }]
          });
        }
        return response({
          path: "/srv/work",
          entries: [
            { name: "repo-a", path: "/srv/work/repo-a", hasChildren: true },
            { name: "repo-b", path: "/srv/work/repo-b", hasChildren: true }
          ]
        });
      }
      if (parsed.pathname.endsWith("/api/sessions")) {
        if (init?.method === "POST") {
          const payload = JSON.parse(String(init.body ?? "{}")) as {
            agentId?: string;
            prompt?: string;
            cwd?: string | null;
          };
          const agent = topologyAgents.find((entry) => entry.id === payload.agentId);
          const view: TestSessionView = {
            session: {
              id: "ses-1",
              entryAgentId: payload.agentId ?? "agent-1",
              initiator: "user",
              status: "running",
              createdAt: "2026-05-12T10:00:00.000Z",
              cwd: payload.cwd ?? (typeof agent?.capabilities.cwd === "string" ? agent.capabilities.cwd : null),
              parentSessionId: null,
              sourceAgentId: null
            },
            events: [
              {
                id: "evt-1",
                eventType: "session.created",
                sourceAgentId: null,
                targetAgentId: payload.agentId ?? "agent-1",
                payload: {
                  prompt: payload.prompt ?? ""
                },
                createdAt: "2026-05-12T10:00:00.000Z"
              }
            ]
          };
          sessionViews[view.session.id] = view;
          return response(view);
        }
        return response(Object.values(sessionViews).map((view) => view.session));
      }
      if (parsed.pathname.includes("/api/sessions/")) {
        const sessionId = parsed.pathname.split("/").at(-1) ?? "";
        const view = sessionViews[sessionId];
        return response(view ?? {}, view ? 200 : 404);
      }
      if (parsed.pathname.endsWith("/api/topology")) {
        return response({
          nodes: topologyNodes.map((node) => ({ ...node, updateRequired })),
          agents: topologyAgents,
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
  directoryRequests = 0;
  narrowLayout = false;
  updateRequired = true;
  sessionViews = {};
  topologyAgents = [
    {
      id: "agent-1",
      nodeId: "node-1",
      name: "Planner",
      backend: "acpx",
      status: "error",
      capabilities: {
        acpxAgent: "planner",
        cwd: "/srv/work/repo-a",
        error: "codex login required"
      }
    }
  ];
  topologyNodes = [
    {
      id: "node-1",
      name: "lab-01",
      host: "lab-01.local",
      status: "online",
      labels: [],
      paths: ["/srv/work/repo-a"],
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open settings for lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /open settings for lab-01/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /node settings for lab-01/i })).toBeTruthy()
    );
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
      expect(screen.getByRole("button", { name: /open settings for lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /open settings for lab-01/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /node settings for lab-01/i })).toBeTruthy()
    );
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
      expect(screen.getByRole("button", { name: /open settings for lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /open settings for lab-01/i }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /node settings for lab-01/i })).toBeTruthy()
    );
    await waitFor(() => expect(directoryRequests).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /add \/srv\/work\/repo-b/i }));
    fireEvent.click(screen.getByRole("button", { name: /save folders/i }));

    await waitFor(() => expect(pathRequests).toBe(1));
    await waitFor(() => expect(screen.getByText(/exposed folders updated\./i)).toBeTruthy());
  });

  it("opens the node modal directly on the agents tab from an errored agent status button", async () => {
    narrowLayout = true;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open error details for planner on lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /open error details for planner on lab-01/i }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /node settings for lab-01/i })).toBeTruthy()
    );
    expect(screen.getByRole("tab", { name: /agents/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/codex login required/i)).toBeTruthy();
  });

  it("keeps the selected node modal tab during topology refreshes", async () => {
    narrowLayout = true;
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open settings for lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: /open settings for lab-01/i }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /node settings for lab-01/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("tab", { name: /agents/i }));
    expect(screen.getByRole("tab", { name: /agents/i }).getAttribute("aria-selected")).toBe("true");

    topologyNodes = topologyNodes.map((node) => ({
      ...node,
      paths: [...node.paths, "/srv/work/repo-b"]
    }));
    socket.onmessage?.({
      data: JSON.stringify({
        type: "topology.updated",
        payload: {
          nodes: topologyNodes,
          agents: topologyAgents,
          triggerRules: []
        }
      })
    });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /agents/i }).getAttribute("aria-selected")).toBe("true")
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

  it("lets the sessions rail switch between exposed folders on a node", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      }
    ];
    topologyNodes = [
      {
        ...topologyNodes[0]!,
        paths: ["/srv/work/repo-a", "/srv/work/repo-b"]
      }
    ];
    window.history.pushState({}, "", "/sessions?node=node-1&agent=agent-1");
    render(<App />);

    const select = (await screen.findByLabelText(/session folder/i)) as HTMLSelectElement;
    expect(select.value).toBe("/srv/work/repo-a");

    fireEvent.change(select, { target: { value: "/srv/work/repo-b" } });

    await waitFor(() =>
      expect(window.location.search).toContain("folder=%2Fsrv%2Fwork%2Frepo-b")
    );
  });

  it("shows the current cwd even when only one folder variant exists", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      }
    ];
    topologyNodes = [
      {
        ...topologyNodes[0]!,
        paths: ["/srv/work/repo-a"]
      }
    ];

    window.history.pushState({}, "", "/sessions?node=node-1&agent=agent-1");
    render(<App />);

    await waitFor(() => expect(screen.getByText("Folder")).toBeTruthy());
    expect(screen.getAllByText("/srv/work/repo-a").length).toBeGreaterThan(0);
  });

  it("shows past sessions across sibling cwd variants with their folders", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      }
    ];
    topologyNodes = [
      {
        ...topologyNodes[0]!,
        paths: ["/srv/work/repo-a", "/srv/work/repo-b"]
      }
    ];
    sessionViews = {
      "ses-a": {
        session: {
          id: "ses-a",
          entryAgentId: "agent-1",
          initiator: "user",
          status: "completed",
          createdAt: "2026-05-12T09:00:00.000Z",
          cwd: "/srv/work/repo-a",
          parentSessionId: null,
          sourceAgentId: null
        },
        events: []
      },
      "ses-b": {
        session: {
          id: "ses-b",
          entryAgentId: "agent-1",
          initiator: "user",
          status: "completed",
          createdAt: "2026-05-12T08:00:00.000Z",
          cwd: "/srv/work/repo-b",
          parentSessionId: null,
          sourceAgentId: null
        },
        events: []
      }
    };

    window.history.pushState({}, "", "/sessions?node=node-1&agent=agent-1");
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("/srv/work/repo-a").length).toBeGreaterThan(0));
    expect(screen.getAllByText("/srv/work/repo-b").length).toBeGreaterThan(0);
  });

  it("switches from an existing session into new-session mode when clicking New", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      }
    ];
    topologyNodes = [
      {
        ...topologyNodes[0]!,
        paths: ["/srv/work/repo-a"]
      }
    ];
    sessionViews = {
      "ses-old": {
        session: {
          id: "ses-old",
          entryAgentId: "agent-1",
          initiator: "user",
          status: "completed",
          createdAt: "2026-05-12T09:00:00.000Z",
          cwd: "/srv/work/repo-a",
          parentSessionId: null,
          sourceAgentId: null
        },
        events: [
          {
            id: "evt-old",
            eventType: "session.created",
            sourceAgentId: null,
            targetAgentId: "agent-1",
            payload: {
              prompt: "existing thread"
            },
            createdAt: "2026-05-12T09:00:00.000Z"
          }
        ]
      }
    };

    window.history.pushState({}, "", "/sessions?session=ses-old");
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("ses-old").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /^new$/i }));

    await waitFor(() => expect(window.location.search).toContain("agent=agent-1"));
    await waitFor(() => expect(screen.getByText(/new session/i)).toBeTruthy());
    expect(screen.queryByText("existing thread")).toBeNull();
  });

  it("renders the ACP debug toggle as an accessible control in the chat header", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      }
    ];
    sessionViews = {
      "ses-old": {
        session: {
          id: "ses-old",
          entryAgentId: "agent-1",
          initiator: "user",
          status: "completed",
          createdAt: "2026-05-12T09:00:00.000Z",
          cwd: "/srv/work/repo-a",
          parentSessionId: null,
          sourceAgentId: null
        },
        events: []
      }
    };

    window.history.pushState({}, "", "/sessions?session=ses-old");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /show acp debug events/i })).toBeTruthy()
    );
  });

  it("renders launch agent switching as a custom dropdown", async () => {
    topologyAgents = [
      {
        id: "agent-1",
        nodeId: "node-1",
        name: "Planner",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "planner"
        }
      },
      {
        id: "agent-2",
        nodeId: "node-1",
        name: "Reviewer",
        backend: "acpx",
        status: "online",
        capabilities: {
          acpxAgent: "reviewer"
        }
      }
    ];
    sessionViews = {
      "ses-old": {
        session: {
          id: "ses-old",
          entryAgentId: "agent-1",
          initiator: "user",
          status: "completed",
          createdAt: "2026-05-12T09:00:00.000Z",
          cwd: "/srv/work/repo-a",
          parentSessionId: null,
          sourceAgentId: null
        },
        events: []
      }
    };

    window.history.pushState({}, "", "/sessions?session=ses-old");
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("ses-old").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /^new$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /launch agent/i })).toBeTruthy());
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByRole("listbox", { name: /launch agent options/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /reviewer agent-2 online/i })).toBeTruthy();
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
