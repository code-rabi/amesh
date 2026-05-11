import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { AgentPicker } from "../components/AgentPicker.js";
import { AgentRail } from "../components/AgentRail.js";
import { AssistantChat } from "../components/AssistantChat.js";
import { SessionList } from "../components/SessionList.js";
import { useSessions } from "../lib/sessionsContext.js";
import { useTopology } from "../lib/topologyContext.js";

const route = getRouteApi("/sessions");

export function SessionsRoute() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const sessions = useSessions();
  const { topology } = useTopology();

  const focusedAgentId = typeof search.agent === "string" ? search.agent : null;
  const selectedSessionId = typeof search.session === "string" ? search.session : null;

  const focusedAgent = useMemo(
    () => topology.agents.find((agent) => agent.id === focusedAgentId) ?? null,
    [topology.agents, focusedAgentId]
  );

  // Sync URL-driven selection into the store.
  useEffect(() => {
    if (selectedSessionId && sessions.selected?.session.id !== selectedSessionId) {
      void sessions.selectSession(selectedSessionId);
    }
    if (!selectedSessionId && sessions.selected) {
      void sessions.selectSession(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const activeSession = sessions.selected;
  const sessionEntryAgent = activeSession
    ? topology.agents.find((agent) => agent.id === activeSession.session.entryAgentId) ?? null
    : null;
  const activeAgent = sessionEntryAgent ?? focusedAgent;

  function navigateToAgent(agentId: string | null) {
    void navigate({
      to: "/sessions",
      search: { agent: agentId ?? undefined, session: undefined }
    });
  }

  function navigateToSession(sessionId: string) {
    void navigate({
      to: "/sessions",
      search: { session: sessionId, agent: undefined }
    });
  }

  return (
    <section className="sessions-route--live" aria-label="Sessions">
      <AgentRail
        topology={topology}
        selectedAgentId={activeAgent?.id ?? null}
        onSelect={navigateToAgent}
      />

      <SessionList
        sessions={sessions.summaries}
        selectedAgent={activeAgent}
        selectedId={activeSession?.session.id ?? null}
        loading={sessions.loading}
        onSelect={navigateToSession}
        onNew={() => navigateToAgent(activeAgent?.id ?? null)}
      />

      <main className="sessions-main">
        {!activeAgent && !activeSession ? (
          <AgentPicker
            topology={topology}
            selectedAgentId={null}
            onSelect={(agentId) => navigateToAgent(agentId)}
          />
        ) : (
          <AssistantChat
            session={activeSession}
            activeAgent={activeAgent}
            topology={topology}
          />
        )}
      </main>
    </section>
  );
}
