import {
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike
} from "@assistant-ui/react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { AgentRecord } from "@amesh/protocol";
import type { SessionView } from "../types.js";
import { useSessions } from "./sessionsContext.js";

type AssistantPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
    }
  | { type: `data-${string}`; data: Record<string, unknown> };

type RunningMessage = {
  id: string;
  parts: AssistantPart[];
  toolCallById: Map<string, number>;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function ensureRunning(
  state: { running: RunningMessage | null; messages: ThreadMessageLike[] },
  fallbackId: string
): RunningMessage {
  if (!state.running) {
    state.running = { id: fallbackId, parts: [], toolCallById: new Map() };
    state.messages.push({
      role: "assistant",
      id: state.running.id,
      content: state.running.parts as ThreadMessageLike["content"],
      status: { type: "running" }
    });
  }
  return state.running;
}

function commitRunning(state: {
  running: RunningMessage | null;
  messages: ThreadMessageLike[];
}, status: ThreadMessageLike["status"]) {
  if (!state.running) return;
  const idx = state.messages.findIndex((m) => m.id === state.running!.id);
  if (idx >= 0) {
    state.messages[idx] = {
      ...state.messages[idx]!,
      content: [...state.running.parts] as ThreadMessageLike["content"],
      status
    };
  }
  state.running = null;
}

function appendText(running: RunningMessage, text: string) {
  if (!text) return;
  const last = running.parts[running.parts.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    running.parts.push({ type: "text", text });
  }
}

function appendReasoning(running: RunningMessage, text: string) {
  if (!text) return;
  const last = running.parts[running.parts.length - 1];
  if (last && last.type === "reasoning") {
    last.text += text;
  } else {
    running.parts.push({ type: "reasoning", text });
  }
}

function chunkText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const text = (content as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  if (typeof payload.text === "string") return payload.text;
  return "";
}

function buildMessages(session: SessionView): ThreadMessageLike[] {
  const state: { running: RunningMessage | null; messages: ThreadMessageLike[] } = {
    running: null,
    messages: []
  };

  for (const event of session.events) {
    switch (event.eventType) {
      case "session.created":
      case "session.prompted": {
        commitRunning(state, { type: "complete", reason: "stop" });
        const text = readString(event.payload.prompt);
        if (text) {
          state.messages.push({
            role: "user",
            id: event.id,
            content: text
          });
        }
        break;
      }

      case "session.output.delta": {
        const running = ensureRunning(state, event.id);
        appendText(running, readString(event.payload.text));
        break;
      }

      case "session.output.completed": {
        if (state.running) {
          const finalText = readString(event.payload.text);
          if (finalText && state.running.parts.length === 0) {
            appendText(state.running, finalText);
          }
        }
        commitRunning(state, { type: "complete", reason: "stop" });
        break;
      }

      case "session.acp.update": {
        const update = readRecord(event.payload.update);
        const kind = readString(update.sessionUpdate);
        const running = ensureRunning(state, event.id);

        switch (kind) {
          case "agent_message_chunk":
            appendText(running, chunkText(update));
            break;

          case "agent_thought_chunk":
            appendReasoning(running, chunkText(update));
            break;

          case "user_message_chunk": {
            // Rare in our flow (server originates user prompts), but handle.
            commitRunning(state, { type: "complete", reason: "stop" });
            const text = chunkText(update);
            if (text) {
              state.messages.push({ role: "user", id: event.id, content: text });
            }
            break;
          }

          case "tool_call": {
            const id = readString(update.toolCallId) || event.id;
            const existing = running.toolCallById.get(id);
            const part: AssistantPart = {
              type: "tool-call",
              toolCallId: id,
              toolName: readString(update.title) || readString(update.kind) || "tool",
              args: {
                kind: readString(update.kind),
                status: readString(update.status) || "in_progress",
                title: readString(update.title),
                content: update.content,
                locations: update.locations,
                rawInput: update.rawInput
              }
            };
            if (existing !== undefined) {
              running.parts[existing] = part;
            } else {
              running.toolCallById.set(id, running.parts.length);
              running.parts.push(part);
            }
            break;
          }

          case "tool_call_update": {
            const id = readString(update.toolCallId);
            if (!id) break;
            const idx = running.toolCallById.get(id);
            if (idx === undefined) break;
            const prev = running.parts[idx];
            if (!prev || prev.type !== "tool-call") break;
            const mergedArgs = { ...(prev.args ?? {}) } as Record<string, unknown>;
            for (const key of [
              "kind",
              "status",
              "title",
              "content",
              "locations",
              "rawInput"
            ]) {
              if (key in update) mergedArgs[key] = update[key];
            }
            const isError =
              readString(update.status) === "failed"
                ? true
                : prev.isError;
            running.parts[idx] = {
              ...prev,
              toolName:
                readString(update.title) || prev.toolName,
              args: mergedArgs,
              result: update.rawOutput ?? prev.result,
              isError
            };
            break;
          }

          case "plan": {
            running.parts.push({
              type: "data-plan",
              data: { entries: update.entries }
            });
            break;
          }

          default: {
            // Carry every unrecognized ACP update through as a data part with
            // the original sessionUpdate kind preserved. The chat header has a
            // toggle to show / hide them; the renderer reads kind from the
            // payload so future ACP versions don't need code changes here.
            running.parts.push({
              type: "data-acp-update",
              data: { sessionUpdate: kind, ...update }
            });
            break;
          }
        }
        break;
      }

      case "session.invocation.requested":
        ensureRunning(state, event.id).parts.push({
          type: "data-invocation-requested",
          data: {
            source: event.sourceAgentId ?? "",
            target: event.targetAgentId ?? "",
            prompt: readString(event.payload.prompt)
          }
        });
        break;

      case "session.invocation.allowed":
        ensureRunning(state, event.id).parts.push({
          type: "data-invocation-allowed",
          data: {
            source: event.sourceAgentId ?? "",
            target: event.targetAgentId ?? "",
            childSessionId: readString(event.payload.childSessionId)
          }
        });
        break;

      case "session.invocation.denied":
        ensureRunning(state, event.id).parts.push({
          type: "data-invocation-denied",
          data: {
            source: event.sourceAgentId ?? "",
            target: event.targetAgentId ?? "",
            reason: readString(event.payload.reason) || "denied"
          }
        });
        break;

      case "session.invocation.completed":
        ensureRunning(state, event.id).parts.push({
          type: "data-invocation-completed",
          data: {
            source: event.sourceAgentId ?? "",
            target: event.targetAgentId ?? "",
            status: readString(event.payload.childStatus) || "unknown"
          }
        });
        break;

      case "session.failed": {
        commitRunning(state, {
          type: "incomplete",
          reason: "error",
          error: readString(event.payload.reason || event.payload.error) || "unknown"
        });
        break;
      }

      case "session.cancelled":
        commitRunning(state, { type: "incomplete", reason: "cancelled" });
        break;

      case "audit":
        // Drop audit out of the chat thread; topology has the audit lineage.
        break;
    }
  }

  // Leave the last running message in `running` status; assistant-ui will keep
  // showing the streaming indicator until a completion event arrives.
  return state.messages;
}

export function useAmeshThreadRuntime(
  activeAgent: AgentRecord | null,
  sessionTarget: { nodeId: string; cwd: string | null } | null
) {
  const sessions = useSessions();
  const sessionView = sessions.selected;
  const messagesRef = useRef<ThreadMessageLike[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  const messages = useMemo<ThreadMessageLike[]>(() => {
    const next = sessionView ? buildMessages(sessionView) : [];
    messagesRef.current = next;
    return next;
  }, [sessionView]);

  const isRunning =
    sessionView?.session.status === "pending" ||
    sessionView?.session.status === "running";

  const clearSendError = useCallback(() => setSendError(null), []);

  const onNew = useCallback<ExternalStoreAdapter<ThreadMessageLike>["onNew"]>(
    async ({ content }) => {
      const text = content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (!text) return;
      try {
        setSendError(null);
        if (sessionView) {
          await sessions.appendPrompt(sessionView.session.id, text);
        } else if (activeAgent && sessionTarget) {
          await sessions.startSession({
            nodeId: sessionTarget.nodeId,
            agentId: activeAgent.id,
            cwd: sessionTarget.cwd,
            prompt: text
          });
        } else {
          throw new Error("Pick an agent before sending.");
        }
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Failed to reach the control plane.";
        setSendError(message);
        throw cause;
      }
    },
    [activeAgent, sessionTarget, sessionView, sessions]
  );

  const adapter = useMemo<ExternalStoreAdapter<ThreadMessageLike>>(
    () => ({
      messages,
      isRunning,
      convertMessage: (msg) => msg,
      onNew
    }),
    [isRunning, messages, onNew]
  );

  const runtime = useExternalStoreRuntime(adapter);

  return { runtime, sendError, clearSendError };
}
