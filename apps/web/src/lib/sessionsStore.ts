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
  startSession: (agentId: string, prompt: string) => Promise<SessionView>;
  appendPrompt: (sessionId: string, prompt: string) => Promise<SessionView>;
  refresh: () => void;
};

export function useSessionsStore(): SessionsStore {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionView | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  function upsertSummary(list: SessionSummary[], next: SessionSummary): SessionSummary[] {
    const without = list.filter((item) => item.id !== next.id);
    return [...without, next];
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
            setSelected(event.payload);
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

  async function startSession(agentId: string, prompt: string) {
    const view = await createSession({ agentId, prompt });
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
