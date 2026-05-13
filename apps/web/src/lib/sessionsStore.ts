import { useEffect, useRef, useState } from "react";
import type { BrowserRealtimeEvent } from "@amesh/protocol";

import {
  appendSessionInput,
  connectRealtime,
  createSession,
  fetchSession,
  fetchSessions
} from "../api.js";
import type { SessionSummary, SessionView } from "../types.js";

export type SessionsStore = {
  summaries: SessionSummary[];
  loading: boolean;
  error: string | null;
  selected: SessionView | null;
  selectedLoading: boolean;
  selectSession: (id: string | null) => Promise<void>;
  startSession: (input: {
    nodeId: string;
    agentId: string;
    cwd: string | null;
    prompt: string;
  }) => Promise<SessionView>;
  appendPrompt: (sessionId: string, prompt: string) => Promise<SessionView>;
  refresh: () => void;
};

export function sameSessionSummary(a: SessionSummary, b: SessionSummary): boolean {
  return (
    a.id === b.id &&
    a.entryAgentId === b.entryAgentId &&
    a.initiator === b.initiator &&
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    a.cwd === b.cwd &&
    a.parentSessionId === b.parentSessionId &&
    a.sourceAgentId === b.sourceAgentId
  );
}

export function sameSessionView(a: SessionView | null, b: SessionView): boolean {
  if (!a || !sameSessionSummary(a.session, b.session)) return false;
  if (a.events.length !== b.events.length) return false;
  for (let index = 0; index < a.events.length; index += 1) {
    const left = a.events[index]!;
    const right = b.events[index]!;
    if (
      left.id !== right.id ||
      left.eventType !== right.eventType ||
      left.sourceAgentId !== right.sourceAgentId ||
      left.targetAgentId !== right.targetAgentId ||
      left.createdAt !== right.createdAt
    ) {
      return false;
    }
  }
  return true;
}

export function useSessionsStore(): SessionsStore {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionView | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  function upsertSummary(list: SessionSummary[], next: SessionSummary): SessionSummary[] {
    const existingIndex = list.findIndex((item) => item.id === next.id);
    if (existingIndex < 0) return [...list, next];
    if (sameSessionSummary(list[existingIndex]!, next)) return list;
    const copy = [...list];
    copy[existingIndex] = next;
    return copy;
  }

  useEffect(() => {
    let active = true;

    fetchSessions()
      .then((list) => {
        if (!active) return;
        setSummaries(list);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Failed to load sessions");
        setLoading(false);
      });

    let socket: WebSocket | null = null;
    try {
      socket = connectRealtime((event: BrowserRealtimeEvent) => {
        if (!active) return;
        if (event.type === "session.updated") {
          setSummaries((current) => upsertSummary(current, event.payload.session));
          if (selectedIdRef.current === event.payload.session.id) {
            setSelected((current) =>
              sameSessionView(current, event.payload) ? current : event.payload
            );
          }
        }
      });
    } catch {
      /* socket not available, fine */
    }

    return () => {
      active = false;
      socket?.close();
    };
  }, []);

  async function selectSession(id: string | null) {
    selectedIdRef.current = id;
    if (!id) {
      setSelected(null);
      return;
    }
    setSelectedLoading(true);
    try {
      const view = await fetchSession(id);
      setSelected(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load session");
    } finally {
      setSelectedLoading(false);
    }
  }

  async function startSession(input: {
    nodeId: string;
    agentId: string;
    cwd: string | null;
    prompt: string;
  }) {
    const view = await createSession(input);
    selectedIdRef.current = view.session.id;
    setSelected(view);
    setSummaries((current) => upsertSummary(current, view.session));
    return view;
  }

  async function appendPrompt(sessionId: string, prompt: string) {
    const view = await appendSessionInput(sessionId, prompt);
    selectedIdRef.current = view.session.id;
    setSelected(view);
    setSummaries((current) => upsertSummary(current, view.session));
    return view;
  }

  function refresh() {
    void fetchSessions().then(setSummaries).catch(() => undefined);
    const id = selectedIdRef.current;
    if (id) {
      void fetchSession(id).then(setSelected).catch(() => undefined);
    }
  }

  return {
    summaries,
    loading,
    error,
    selected,
    selectedLoading,
    selectSession,
    startSession,
    appendPrompt,
    refresh
  };
}
