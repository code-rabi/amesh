import type { TopologySnapshot } from "@amesh/protocol";
import { useEffect, useState, startTransition, useDeferredValue, useRef } from "react";

import {
  appendSessionInput,
  connectRealtime,
  createSession,
  createTriggerRule,
  deleteTriggerRule,
  fetchSession,
  fetchSessions,
  fetchTopology
} from "./api.js";
import type { SessionSummary, SessionView } from "./types.js";
import "./styles.css";

const emptyTopology: TopologySnapshot = {
  nodes: [],
  agents: [],
  triggerRules: []
};

export function App() {
  const [topology, setTopology] = useState<TopologySnapshot>(emptyTopology);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [sourceAgentId, setSourceAgentId] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [triggerMode, setTriggerMode] = useState<"allow" | "deny">("allow");
  const [prompt, setPrompt] = useState("Hello from amesh");
  const [session, setSession] = useState<SessionView | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const deferredSession = useDeferredValue(session);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchTopology(), fetchSessions()]).then(async ([snapshot, sessionSummaries]) => {
      if (!mounted) {
        return;
      }
      setTopology(snapshot);
      setSessions(sessionSummaries);
      setSelectedAgentId(snapshot.agents[0]?.id ?? "");
      setSourceAgentId(snapshot.agents[0]?.id ?? "");
      setTargetAgentId(snapshot.agents[1]?.id ?? snapshot.agents[0]?.id ?? "");

      const latestSession = sessionSummaries.at(-1);
      if (latestSession) {
        setSelectedSessionId(latestSession.id);
        setSession(await fetchSession(latestSession.id));
      }
    });

    const socket = connectRealtime((event) => {
      startTransition(() => {
        if (event.type === "topology.snapshot" || event.type === "topology.updated") {
          setTopology(event.payload);
        }
        if (event.type === "session.updated") {
          setSessions((current) => upsertSessionSummary(current, event.payload.session));
          if (
            selectedSessionIdRef.current === null ||
            selectedSessionIdRef.current === event.payload.session.id
          ) {
            setSession(event.payload);
          }
        }
      });
    });

    return () => {
      mounted = false;
      socket.close();
    };
  }, []);

  const selectedSessionEvents = deferredSession?.events ?? [];

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Distributed ACP mesh</p>
        <h1>amesh control plane</h1>
        <p className="lede">
          Live topology, explicit trigger policy, and routed agent sessions across remote nodes.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Nodes</h2>
            <span>{topology.nodes.length}</span>
          </div>
          <ul className="stack-list">
            {topology.nodes.map((node) => (
              <li key={node.id} className="card-row">
                <div>
                  <strong>{node.name}</strong>
                  <p>{node.host}</p>
                </div>
                <span className={`status status-${node.status}`}>{node.status}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Agents</h2>
            <span>{topology.agents.length}</span>
          </div>
          <ul className="stack-list">
            {topology.agents.map((agent) => (
              <li key={agent.id} className="card-row">
                <div>
                  <strong>{agent.name}</strong>
                  <p>{agent.id}</p>
                </div>
                <span className={`status status-${agent.status}`}>{agent.status}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Trigger Rules</h2>
            <span>{topology.triggerRules.length}</span>
          </div>
          <form
            className="rule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createTriggerRule({
                sourceAgentId,
                targetAgentId,
                mode: triggerMode
              });
            }}
          >
            <select value={sourceAgentId} onChange={(event) => setSourceAgentId(event.target.value)}>
              {topology.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select value={targetAgentId} onChange={(event) => setTargetAgentId(event.target.value)}>
              {topology.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select value={triggerMode} onChange={(event) => setTriggerMode(event.target.value as "allow" | "deny")}>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
            <button type="submit">Save route</button>
          </form>
          <ul className="stack-list">
            {topology.triggerRules.map((rule) => (
              <li key={rule.id} className="rule-chip">
                <span>{rule.sourceAgentId}</span>
                <span>{rule.mode}</span>
                <span>{rule.targetAgentId}</span>
                <button
                  type="button"
                  className="inline-button"
                  onClick={() => {
                    void deleteTriggerRule(rule.id);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="chat-layout">
        <article className="panel">
          <div className="panel-header">
            <h2>Start Session</h2>
          </div>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createSession({
                agentId: selectedAgentId,
                prompt
              }).then((nextSession) => {
                setSelectedSessionId(nextSession.session.id);
                setSession(nextSession);
                setSessions((current) => upsertSessionSummary(current, nextSession.session));
              });
            }}
          >
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
              {topology.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
            <button type="submit">Send prompt</button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Sessions</h2>
            <span>{sessions.length}</span>
          </div>
          <ul className="stack-list">
            {[...sessions].reverse().map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`session-button ${selectedSessionId === item.id ? "session-button-active" : ""}`}
                  onClick={() => {
                    setSelectedSessionId(item.id);
                    void fetchSession(item.id).then((nextSession) => setSession(nextSession));
                  }}
                >
                  <strong>{item.entryAgentId}</strong>
                  <span>{item.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel transcript">
          <div className="panel-header">
            <h2>Transcript</h2>
            <span>{deferredSession?.session.status ?? "idle"}</span>
          </div>
          <ul className="event-list">
            {selectedSessionEvents.map((event) => (
              <li key={event.id} className="event-item">
                <strong>{event.eventType}</strong>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </li>
            ))}
          </ul>
          {deferredSession ? (
            <form
              className="followup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void appendSessionInput(deferredSession.session.id, prompt).then((nextSession) => {
                  setSelectedSessionId(nextSession.session.id);
                  setSession(nextSession);
                  setSessions((current) => upsertSessionSummary(current, nextSession.session));
                });
              }}
            >
              <button type="submit">Send follow-up</button>
            </form>
          ) : null}
        </article>
      </section>
    </main>
  );
}

function upsertSessionSummary(current: SessionSummary[], next: SessionSummary) {
  const remaining = current.filter((item) => item.id !== next.id);
  return [...remaining, next];
}
