import type { BrowserRealtimeEvent, TopologySnapshot, TriggerRule } from "@amesh/protocol";

import type { SessionSummary, SessionView } from "./types.js";

const baseUrl = import.meta.env.VITE_SERVER_URL ?? "";

function serverUrl() {
  if (baseUrl) {
    return new URL(baseUrl);
  }
  return new URL(window.location.origin);
}

export async function fetchTopology(): Promise<TopologySnapshot> {
  const response = await fetch(`${serverUrl().origin}/api/topology`);
  return response.json();
}

export async function createTriggerRule(input: {
  sourceAgentId: string;
  targetAgentId: string;
  mode: "allow" | "deny";
}): Promise<TriggerRule> {
  const response = await fetch(`${serverUrl().origin}/api/trigger-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.json();
}

export async function deleteTriggerRule(id: string): Promise<void> {
  await fetch(`${serverUrl().origin}/api/trigger-rules/${id}`, {
    method: "DELETE"
  });
}

export async function createSession(input: { agentId: string; prompt: string }): Promise<SessionView> {
  const response = await fetch(`${serverUrl().origin}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.json();
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await fetch(`${serverUrl().origin}/api/sessions`);
  return response.json();
}

export async function fetchSession(sessionId: string): Promise<SessionView> {
  const response = await fetch(`${serverUrl().origin}/api/sessions/${sessionId}`);
  return response.json();
}

export async function appendSessionInput(sessionId: string, prompt: string): Promise<SessionView> {
  const response = await fetch(`${serverUrl().origin}/api/sessions/${sessionId}/input`, {
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
