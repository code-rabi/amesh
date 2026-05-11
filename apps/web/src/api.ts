import type { BrowserRealtimeEvent, TopologySnapshot, TriggerRule } from "@amesh/protocol";

import type { SessionSummary, SessionView } from "./types.js";

const baseUrl = import.meta.env.VITE_SERVER_URL ?? "";
const unauthorizedEvent = "amesh:unauthorized";

export class ApiUnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
  }
}

function serverUrl() {
  if (baseUrl) {
    return new URL(baseUrl);
  }
  return new URL(window.location.origin);
}

async function apiFetch(input: string, init?: RequestInit) {
  const response = await fetch(`${serverUrl().origin}${input}`, {
    ...init,
    credentials: "include"
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event(unauthorizedEvent));
    throw new ApiUnauthorizedError();
  }
  return response;
}

export function onUnauthorized(listener: () => void) {
  window.addEventListener(unauthorizedEvent, listener);
  return () => window.removeEventListener(unauthorizedEvent, listener);
}

export async function fetchAuthSession(): Promise<{ authenticated: boolean; username: string }> {
  const response = await apiFetch("/api/auth/session");
  return response.json();
}

export async function login(password: string): Promise<void> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    throw new Error("Login failed");
  }
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function fetchTopology(): Promise<TopologySnapshot> {
  const response = await apiFetch("/api/topology");
  return response.json();
}

export async function fetchBootstrapConfig(): Promise<{ registrationToken: string }> {
  const response = await apiFetch("/api/bootstrap");
  return response.json();
}

export async function createTriggerRule(input: {
  sourceAgentId: string;
  targetAgentId: string;
  mode: "allow" | "deny";
}): Promise<TriggerRule> {
  const response = await apiFetch("/api/trigger-rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.json();
}

export async function deleteTriggerRule(id: string): Promise<void> {
  await apiFetch(`/api/trigger-rules/${id}`, {
    method: "DELETE"
  });
}

export async function createSession(input: { agentId: string; prompt: string }): Promise<SessionView> {
  const response = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.json();
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await apiFetch("/api/sessions");
  return response.json();
}

export async function fetchSession(sessionId: string): Promise<SessionView> {
  const response = await apiFetch(`/api/sessions/${sessionId}`);
  return response.json();
}

export async function appendSessionInput(sessionId: string, prompt: string): Promise<SessionView> {
  const response = await apiFetch(`/api/sessions/${sessionId}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  return response.json();
}

export function connectRealtime(onEvent: (event: BrowserRealtimeEvent) => void) {
  const target = serverUrl();
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = "/ws";
  target.searchParams.set("role", "browser");

  const socket = new WebSocket(target);
  socket.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as BrowserRealtimeEvent);
  };

  return socket;
}
