import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { AgentPicker } from "../components/AgentPicker.js";
import { AssistantChat } from "../components/AssistantChat.js";
import { NodeRail } from "../components/NodeRail.js";
import { SessionList } from "../components/SessionList.js";
import { useSessions } from "../lib/sessionsContext.js";
import { useTopology } from "../lib/topologyContext.js";

const route = getRouteApi("/sessions");

function readAgentCwd(agent: { capabilities: Record<string, unknown> } | null) {
  return agent && typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
}

function readFolderLabel(folder: string | null) {
  return folder ?? "Default folder";
}

function collectNodeFolders(nodePaths: string[], agentCwds: string[]): Array<string | null> {
  const seen = new Set<string>();
  const folders: string[] = [];

  for (const path of [...nodePaths, ...agentCwds]) {
    const normalized = path.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    folders.push(normalized);
  }

  folders.sort((left, right) => left.localeCompare(right));
  return folders.length > 0 ? folders : [null];
}

export function SessionsRoute() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const sessions = useSessions();
  const { topology } = useTopology();

  const selectedSessionId = typeof search.session === "string" ? search.session : null;
  const focusedNodeId = typeof search.node === "string" ? search.node : null;
  const focusedFolder = typeof search.folder === "string" ? search.folder : null;
  const focusedAgentId = typeof search.agent === "string" ? search.agent : null;
  const focusedAgent = topology.agents.find((agent) => agent.id === focusedAgentId) ?? null;

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
  const selectedNodeId = sessionEntryAgent?.nodeId ?? focusedNodeId ?? focusedAgent?.nodeId ?? null;
  const selectedNode = topology.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const nodeAgents = useMemo(
    () => topology.agents.filter((agent) => agent.nodeId === selectedNodeId),
    [selectedNodeId, topology.agents]
  );
  const agentCwds = useMemo(
    () =>
      nodeAgents
        .map((agent) => readAgentCwd(agent))
        .filter((cwd): cwd is string => Boolean(cwd)),
    [nodeAgents]
  );
  const availableFolders = useMemo(
    () => (selectedNode ? collectNodeFolders(selectedNode.paths, agentCwds) : []),
    [agentCwds, selectedNode]
  );
  const selectedFolder =
    activeSession?.session.cwd ??
    focusedFolder ??
    readAgentCwd(sessionEntryAgent ?? focusedAgent) ??
    (availableFolders[0] ?? null);
  const selectedAgent =
    sessionEntryAgent ??
    focusedAgent ??
    nodeAgents.find((agent) => agent.status === "online") ??
    nodeAgents[0] ??
    null;
  const activeAgent = sessionEntryAgent ?? selectedAgent;
  const currentFolderLabel = readFolderLabel(selectedFolder);
  const folderOptions = useMemo(
    () =>
      availableFolders.map((folder) => ({
        value: folder,
        label: readFolderLabel(folder)
      })),
    [availableFolders]
  );
  const agentNames = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent.name])),
    [topology.agents]
  );
  const agentsById = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent])),
    [topology.agents]
  );
  const visibleSessions = useMemo(() => {
    if (!selectedNodeId) {
      return sessions.summaries;
    }
    return sessions.summaries.filter((session) => {
      const agent = agentsById.get(session.entryAgentId);
      return agent?.nodeId === selectedNodeId && (session.cwd ?? null) === selectedFolder;
    });
  }, [agentsById, selectedFolder, selectedNodeId, sessions.summaries]);

  function navigateToScope(input: {
    nodeId?: string | null;
    folder?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
  }) {
    void navigate({
      to: "/sessions",
      search: {
        node: input.nodeId ?? undefined,
        folder: input.folder ?? undefined,
        session: input.sessionId ?? undefined,
        agent: input.agentId ?? undefined
      }
    });
  }

  function navigateToSession(sessionId: string) {
    navigateToScope({ sessionId, nodeId: undefined, folder: undefined, agentId: undefined });
  }

  return (
    <section className="sessions-route--live" aria-label="Sessions">
      <NodeRail
        nodes={topology.nodes}
        selectedNodeId={selectedNodeId}
        onSelect={(nodeId) => {
          void sessions.selectSession(null);
          navigateToScope({ nodeId, folder: undefined, sessionId: undefined, agentId: undefined });
        }}
      />

      <SessionList
        sessions={visibleSessions}
        selectedNode={selectedNode}
        agentNames={agentNames}
        currentFolderLabel={currentFolderLabel}
        folderOptions={folderOptions}
        selectedFolder={selectedFolder}
        selectedId={activeSession?.session.id ?? null}
        loading={sessions.loading}
        onSelect={navigateToSession}
        onSelectFolder={(folder) => {
          void sessions.selectSession(null);
          navigateToScope({
            nodeId: selectedNodeId,
            folder,
            sessionId: undefined,
            agentId: selectedAgent?.id ?? null
          });
        }}
        onNew={() => {
          void sessions.selectSession(null);
          navigateToScope({
            nodeId: selectedNodeId,
            folder: selectedFolder,
            sessionId: undefined,
            agentId: selectedAgent?.id ?? null
          });
        }}
      />

      <main className="sessions-main">
        {!activeSession && !selectedNode ? (
          <AgentPicker
            agents={[]}
            nodeName={null}
            folderLabel={null}
            selectedAgentId={null}
            onSelect={() => undefined}
          />
        ) : !activeAgent && !activeSession ? (
          <AgentPicker
            agents={nodeAgents}
            nodeName={selectedNode?.name ?? null}
            folderLabel={currentFolderLabel}
            selectedAgentId={null}
            onSelect={(agentId) =>
              navigateToScope({
                nodeId: selectedNodeId,
                folder: selectedFolder,
                sessionId: undefined,
                agentId
              })
            }
          />
        ) : (
          <AssistantChat
            key={activeSession ? `session:${activeSession.session.id}` : `new:${activeAgent?.id ?? "none"}`}
            session={activeSession}
            activeAgent={activeAgent}
            topology={topology}
            launchAgents={nodeAgents}
            onSelectLaunchAgent={(agentId) =>
              navigateToScope({
                nodeId: selectedNodeId,
                folder: selectedFolder,
                sessionId: undefined,
                agentId
              })
            }
            scopeLabel={selectedNode ? `${selectedNode.name} · ${currentFolderLabel}` : currentFolderLabel}
            sessionTarget={selectedNodeId ? { nodeId: selectedNodeId, cwd: selectedFolder } : null}
          />
        )}
      </main>
    </section>
  );
}
