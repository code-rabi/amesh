import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import type { AgentRecord } from "@amesh/protocol";

import { AgentPicker } from "../components/AgentPicker.js";
import { AssistantChat } from "../components/AssistantChat.js";
import { NodeRail } from "../components/NodeRail.js";
import { SessionList } from "../components/SessionList.js";
import { useSessions } from "../lib/sessionsContext.js";
import { useTopology } from "../lib/topologyContext.js";

const route = getRouteApi("/sessions");

function readAgentCwd(agent: { capabilities: Record<string, unknown> }) {
  return typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
}

function readFolderLabel(folder: string | null) {
  return folder ?? "Default folder";
}

function collectNodeFolders(nodePaths: string[], agents: AgentRecord[]) {
  const seen = new Set<string>();
  const folders: string[] = [];

  for (const path of nodePaths) {
    const normalized = path.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    folders.push(normalized);
  }

  let hasDefault = false;
  for (const agent of agents) {
    const cwd = readAgentCwd(agent)?.trim() ?? "";
    if (!cwd) {
      hasDefault = true;
      continue;
    }
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    folders.push(cwd);
  }

  folders.sort((left, right) => left.localeCompare(right));
  return hasDefault ? [null, ...folders] : folders.map((folder) => folder);
}

export function SessionsRoute() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const sessions = useSessions();
  const { topology } = useTopology();

  const legacyAgentId = typeof search.agent === "string" ? search.agent : null;
  const focusedNodeId = typeof search.node === "string" ? search.node : null;
  const focusedFolder = typeof search.folder === "string" ? search.folder : null;
  const launchAgentId = typeof search.launchAgent === "string" ? search.launchAgent : null;
  const selectedSessionId = typeof search.session === "string" ? search.session : null;
  const legacyAgent = useMemo(
    () => topology.agents.find((agent) => agent.id === legacyAgentId) ?? null,
    [legacyAgentId, topology.agents]
  );
  const agentsById = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent])),
    [topology.agents]
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
  const selectedNodeId =
    sessionEntryAgent?.nodeId ?? focusedNodeId ?? legacyAgent?.nodeId ?? null;
  const selectedNode = topology.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const nodeAgents = useMemo(
    () => topology.agents.filter((agent) => agent.nodeId === selectedNodeId),
    [selectedNodeId, topology.agents]
  );
  const availableFolders = useMemo(
    () => (selectedNode ? collectNodeFolders(selectedNode.paths, nodeAgents) : []),
    [nodeAgents, selectedNode]
  );
  const selectedFolder =
    activeSession?.session.cwd ??
    readAgentCwd(sessionEntryAgent ?? legacyAgent ?? { capabilities: {} }) ??
    focusedFolder ??
    (availableFolders[0] ?? null);
  const folderAgents = useMemo(
    () =>
      nodeAgents.filter((agent) => {
        const cwd = readAgentCwd(agent) ?? null;
        return cwd === selectedFolder;
      }),
    [nodeAgents, selectedFolder]
  );
  const selectedLaunchAgent =
    sessionEntryAgent ??
    folderAgents.find((agent) => agent.id === launchAgentId) ??
    folderAgents.find((agent) => agent.id === legacyAgentId) ??
    folderAgents.find((agent) => agent.status === "online") ??
    folderAgents[0] ??
    null;
  const activeAgent = sessionEntryAgent ?? selectedLaunchAgent;
  const currentFolderLabel = readFolderLabel(selectedFolder);
  const visibleSessions = useMemo(() => {
    if (!selectedNodeId) {
      return sessions.summaries;
    }
    return sessions.summaries.filter(
      (session) =>
        agentsById.get(session.entryAgentId)?.nodeId === selectedNodeId &&
        (session.cwd ?? null) === selectedFolder
    );
  }, [agentsById, selectedFolder, selectedNodeId, sessions.summaries]);
  const folderOptions = useMemo(() => {
    return availableFolders.map((folder) => ({
      value: folder,
      label: readFolderLabel(folder)
    }));
  }, [availableFolders]);
  const agentNames = useMemo(
    () => new Map(topology.agents.map((agent) => [agent.id, agent.name])),
    [topology.agents]
  );

  function navigateToScope(input: {
    nodeId?: string | null;
    folder?: string | null;
    sessionId?: string | null;
    launchAgent?: string | null;
  }) {
    void navigate({
      to: "/sessions",
      search: {
        node: input.nodeId ?? undefined,
        folder: input.folder ?? undefined,
        session: input.sessionId ?? undefined,
        launchAgent: input.launchAgent ?? undefined,
        agent: undefined
      }
    });
  }

  function navigateToSession(sessionId: string) {
    navigateToScope({ sessionId, nodeId: undefined, folder: undefined, launchAgent: undefined });
  }

  return (
    <section className="sessions-route--live" aria-label="Sessions">
      <NodeRail
        nodes={topology.nodes}
        selectedNodeId={selectedNodeId}
        onSelect={(nodeId) => {
          void sessions.selectSession(null);
          navigateToScope({ nodeId, folder: undefined, sessionId: undefined, launchAgent: undefined });
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
            launchAgent: undefined
          });
        }}
        onNew={() => {
          void sessions.selectSession(null);
          navigateToScope({
            nodeId: selectedNodeId,
            folder: selectedFolder,
            sessionId: undefined,
            launchAgent: selectedLaunchAgent?.id ?? null
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
            agents={folderAgents}
            nodeName={selectedNode?.name ?? null}
            folderLabel={currentFolderLabel}
            selectedAgentId={null}
            onSelect={(agentId) =>
              navigateToScope({
                nodeId: selectedNodeId,
                folder: selectedFolder,
                sessionId: undefined,
                launchAgent: agentId
              })
            }
          />
        ) : (
          <AssistantChat
            key={activeSession ? `session:${activeSession.session.id}` : `new:${activeAgent?.id ?? "none"}`}
            session={activeSession}
            activeAgent={activeAgent}
            topology={topology}
            launchAgents={folderAgents}
            onSelectLaunchAgent={(agentId) =>
              navigateToScope({
                nodeId: selectedNodeId,
                folder: selectedFolder,
                sessionId: undefined,
                launchAgent: agentId
              })
            }
            scopeLabel={selectedNode ? `${selectedNode.name} · ${currentFolderLabel}` : currentFolderLabel}
          />
        )}
      </main>
    </section>
  );
}
