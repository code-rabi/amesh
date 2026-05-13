import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AgentRecord, TopologySnapshot } from "@amesh/protocol";

import { AgentAvatar } from "./AgentAvatar.js";
import { useAmeshThreadRuntime } from "../lib/assistantRuntime.js";
import { relativeTime } from "../lib/time.js";
import type { SessionView } from "../types.js";

type Props = {
  session: SessionView | null;
  activeAgent: AgentRecord | null;
  topology: TopologySnapshot;
  launchAgents?: AgentRecord[];
  onSelectLaunchAgent?: (agentId: string) => void;
  scopeLabel?: string | null;
  sessionTarget?: { nodeId: string; cwd: string | null } | null;
};

const ShowAcpContext = createContext(false);

export function AssistantChat({
  session,
  activeAgent,
  topology,
  launchAgents = [],
  onSelectLaunchAgent,
  scopeLabel,
  sessionTarget = null
}: Props) {
  const { runtime, sendError, clearSendError } = useAmeshThreadRuntime(activeAgent, sessionTarget);
  const [showAcp, setShowAcp] = useState(false);
  const messageComponents = useMemo(
    () => ({
      UserMessage,
      AssistantMessage: makeAssistantMessage(activeAgent, topology),
      SystemMessage
    }),
    [activeAgent, topology]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ShowAcpContext.Provider value={showAcp}>
        <div className="chat">
          {session ? (
            <ChatHeader
              session={session}
              activeAgent={activeAgent}
              showAcp={showAcp}
              onToggleAcp={() => setShowAcp((v) => !v)}
            />
          ) : activeAgent ? (
            <NewSessionIntro
              agent={activeAgent}
              topology={topology}
              launchAgents={launchAgents}
              onSelectLaunchAgent={onSelectLaunchAgent}
              scopeLabel={scopeLabel ?? null}
              showAcp={showAcp}
              onToggleAcp={() => setShowAcp((v) => !v)}
            />
          ) : null}

          <ThreadPrimitive.Root className="chat__thread">
            <ThreadPrimitive.Viewport className="chat__viewport" autoScroll>
              <ThreadPrimitive.Messages components={messageComponents} />
            </ThreadPrimitive.Viewport>

            {sendError ? (
              <SendError message={sendError} onDismiss={clearSendError} />
            ) : null}
            <ChatComposer disabled={!activeAgent} />
          </ThreadPrimitive.Root>
        </div>
      </ShowAcpContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function SendError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="send-error" role="alert">
      <span className="send-error__label">Send failed</span>
      <span className="send-error__detail">{message}</span>
      <button type="button" className="send-error__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

function AcpToggle({
  showAcp,
  onToggle
}: {
  showAcp: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="acp-toggle"
      data-on={showAcp}
      onClick={onToggle}
      title={showAcp ? "Hide ACP debug events" : "Show ACP debug events"}
      aria-label={showAcp ? "Hide ACP debug events" : "Show ACP debug events"}
      aria-pressed={showAcp}
    >
      <span>ACP</span>
    </button>
  );
}

function ChatHeader({
  session,
  activeAgent,
  showAcp,
  onToggleAcp
}: {
  session: SessionView;
  activeAgent: AgentRecord | null;
  showAcp: boolean;
  onToggleAcp: () => void;
}) {
  const agent = activeAgent;
  const cwd =
    session.session.cwd ?? (typeof agent?.capabilities.cwd === "string" ? agent.capabilities.cwd : null);
  return (
    <header className="chat__header">
      <AcpToggle showAcp={showAcp} onToggle={onToggleAcp} />
      <div className="chat__header-main">
        <div className="chat__title">
          {agent ? <AgentAvatar id={agent.id} name={agent.name} size={28} /> : null}
          <div>
            <h2>{agent?.name ?? session.session.entryAgentId}</h2>
            <div className="chat__meta">
              <span className="font-mono">{session.session.id}</span>
              <span aria-hidden>·</span>
              <span>{relativeTime(session.session.createdAt)}</span>
              {cwd ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono">{cwd}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function NewSessionIntro({
  agent,
  topology,
  launchAgents,
  onSelectLaunchAgent,
  scopeLabel,
  showAcp,
  onToggleAcp
}: {
  agent: AgentRecord;
  topology: TopologySnapshot;
  launchAgents: AgentRecord[];
  onSelectLaunchAgent?: (agentId: string) => void;
  scopeLabel: string | null;
  showAcp: boolean;
  onToggleAcp: () => void;
}) {
  const host =
    topology.nodes.find((node) => node.id === agent.nodeId)?.name ?? agent.nodeId;
  const cwd = typeof agent.capabilities.cwd === "string" ? agent.capabilities.cwd : null;
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  return (
    <header className="chat__header">
      <AcpToggle showAcp={showAcp} onToggle={onToggleAcp} />
      <div className="chat__header-main">
        <div className="chat__title">
          <AgentAvatar id={agent.id} name={agent.name} size={28} />
          <div>
            <h2>{agent.name}</h2>
            <div className="chat__meta">
              <span>{host}</span>
              <span aria-hidden>·</span>
              <span>new session</span>
              {scopeLabel ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{scopeLabel}</span>
                </>
              ) : null}
              {cwd ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono">{cwd}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {launchAgents.length > 1 && onSelectLaunchAgent ? (
          <div
            className="chat__agent-select"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setAgentMenuOpen(false);
              }
            }}
          >
            <span className="chat__agent-select-label">Agent</span>
            <button
              type="button"
              className="chat__agent-trigger"
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              aria-label="Launch agent"
              onClick={() => setAgentMenuOpen((value) => !value)}
            >
              <span className="chat__agent-trigger-main">
                <AgentAvatar id={agent.id} name={agent.name} size={20} />
                <span className="chat__agent-trigger-copy">
                  <span className="chat__agent-trigger-name">{agent.name}</span>
                  <span className="chat__agent-trigger-meta">{launchAgents.length} available on this node</span>
                </span>
              </span>
              <span className="chat__agent-trigger-caret" aria-hidden>
                {agentMenuOpen ? "−" : "+"}
              </span>
            </button>
            {agentMenuOpen ? (
              <div className="chat__agent-menu" role="listbox" aria-label="Launch agent options">
                {launchAgents.map((option) => {
                  const selected = option.id === agent.id;
                  const disabled = option.status !== "online";
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      className="chat__agent-menu-option"
                      data-selected={selected}
                      aria-selected={selected}
                      disabled={disabled}
                      onClick={() => {
                        onSelectLaunchAgent(option.id);
                        setAgentMenuOpen(false);
                      }}
                      title={disabled ? `${option.name} is ${option.status}` : `Switch to ${option.name}`}
                    >
                      <span className="chat__agent-menu-option-main">
                        <AgentAvatar id={option.id} name={option.name} size={18} />
                        <span className="chat__agent-option-copy">
                          <span className="chat__agent-option-name">{option.name}</span>
                          <span className="chat__agent-option-status font-mono">{option.id}</span>
                        </span>
                      </span>
                      <span className={`pill pill-${option.status}`}>{option.status}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root asChild>
      <article className="msg msg--user">
        <div className="msg__bubble">
          <MessagePrimitive.Parts />
        </div>
      </article>
    </MessagePrimitive.Root>
  );
}

function SystemMessage() {
  return (
    <MessagePrimitive.Root asChild>
      <article className="msg msg--system">
        <MessagePrimitive.Parts />
      </article>
    </MessagePrimitive.Root>
  );
}

function makeAssistantMessage(activeAgent: AgentRecord | null, topology: TopologySnapshot) {
  const dataByName = {
    "invocation-requested": (props: { data: Record<string, unknown> }) =>
      InvocationRow({
        kind: "requested",
        data: props.data,
        topology
      }),
    "invocation-allowed": (props: { data: Record<string, unknown> }) =>
      InvocationRow({
        kind: "allowed",
        data: props.data,
        topology
      }),
    "invocation-denied": (props: { data: Record<string, unknown> }) =>
      InvocationRow({
        kind: "denied",
        data: props.data,
        topology
      }),
    "invocation-completed": (props: { data: Record<string, unknown> }) =>
      InvocationRow({
        kind: "completed",
        data: props.data,
        topology
      }),
    plan: (props: { data: { entries?: unknown } }) => <PlanCard entries={props.data.entries} />,
    "acp-update": (props: { data: Record<string, unknown> }) => (
      <AcpUpdateCard payload={props.data} />
    )
  };

  return function AssistantMessage() {
    const agent = activeAgent;
    return (
      <MessagePrimitive.Root asChild>
        <article className="msg msg--assistant">
          {agent ? (
            <header className="msg__byline">
              <AgentAvatar id={agent.id} name={agent.name} size={22} />
              <span className="msg__byline-name">{agent.name}</span>
            </header>
          ) : null}
          <div className="msg__body">
            <MessagePrimitive.Parts
              components={{
                Text: AssistantText,
                Reasoning: AssistantReasoning,
                tools: { Fallback: ToolCallCard },
                data: { by_name: dataByName }
              }}
            />
            <MessagePrimitive.Error>
              <AssistantError />
            </MessagePrimitive.Error>
          </div>
        </article>
      </MessagePrimitive.Root>
    );
  };
}

function AssistantError() {
  // MessagePrimitive.Error only renders this when status.error is defined.
  const message = useMessage();
  const status = message.status;
  const error =
    status && status.type === "incomplete" ? status.error : undefined;
  const text =
    typeof error === "string"
      ? error
      : error === null || error === undefined
        ? "The agent stopped without finishing."
        : JSON.stringify(error);
  return (
    <aside className="msg-error" role="status">
      <span className="msg-error__icon" aria-hidden>
        !
      </span>
      <div>
        <div className="msg-error__title">Agent error</div>
        <div className="msg-error__detail">{text}</div>
      </div>
    </aside>
  );
}

function AcpUpdateCard({ payload }: { payload: Record<string, unknown> }) {
  const showAcp = useContext(ShowAcpContext);
  if (!showAcp) return null;
  const kind =
    typeof payload.sessionUpdate === "string" ? payload.sessionUpdate : "acp";
  const title = "ACP update";
  return (
    <details className="card card--acp" data-kind={kind}>
      <summary className="card__head">
        <span className="card__chevron" aria-hidden>
          ▸
        </span>
        <span className="card__kind">{kind}</span>
        <span className="card__title">{title}</span>
      </summary>
      <div className="card__body">
        <pre className="toolcall__output">{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </details>
  );
}

function PlanCard({ entries }: { entries: unknown }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return (
    <section className="plan-card">
      <header className="plan-card__head">Plan</header>
      <ol className="plan-card__list">
        {entries.map((entry, idx) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const status = typeof e.status === "string" ? e.status : "pending";
          const content = typeof e.content === "string" ? e.content : JSON.stringify(e);
          return (
            <li key={idx} data-status={status}>
              <span className="plan-card__marker" aria-hidden />
              <span>{content}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function InvocationRow({
  kind,
  data,
  topology
}: {
  kind: "requested" | "allowed" | "denied" | "completed";
  data: Record<string, unknown>;
  topology: TopologySnapshot;
}) {
  const sourceId = typeof data.source === "string" ? data.source : "";
  const targetId = typeof data.target === "string" ? data.target : "";
  const sourceName =
    topology.agents.find((a) => a.id === sourceId)?.name ?? sourceId;
  const targetName =
    topology.agents.find((a) => a.id === targetId)?.name ?? targetId;

  const variants = {
    requested: { icon: "→", className: "event event--invoke", title: <>wants to invoke</> },
    allowed: { icon: "✓", className: "event event--allow", title: <>allowed</> },
    denied: { icon: "⊘", className: "event event--deny", title: <>denied</> },
    completed: { icon: "↩", className: "event event--complete", title: <>finished</> }
  } as const;
  const variant = variants[kind];

  const detail =
    kind === "requested"
      ? typeof data.prompt === "string"
        ? data.prompt
        : null
      : kind === "denied"
        ? typeof data.reason === "string"
          ? data.reason
          : null
        : kind === "allowed"
          ? typeof data.childSessionId === "string" && data.childSessionId
            ? `child session ${data.childSessionId}`
            : null
          : kind === "completed"
            ? typeof data.status === "string"
              ? data.status
              : null
            : null;

  return (
    <article className={variant.className}>
      <div className="event__icon">{variant.icon}</div>
      <div className="event__body">
        <span className="event__title">
          <strong>{sourceName}</strong> {variant.title} <strong>{targetName}</strong>
        </span>
        {detail ? <div className="event__detail">{detail}</div> : null}
      </div>
    </article>
  );
}

function AssistantText() {
  return (
    <div className="msg__markdown">
      <MarkdownTextPrimitive />
    </div>
  );
}

function AssistantReasoning() {
  return (
    <details className="card card--reasoning">
      <summary className="card__head">
        <span className="card__chevron" aria-hidden>
          ▸
        </span>
        <span className="card__kind">think</span>
        <span className="card__title">Reasoning</span>
      </summary>
      <div className="card__body msg__markdown">
        <MarkdownTextPrimitive />
      </div>
    </details>
  );
}

function ToolCallCard({
  toolName,
  args,
  result,
  isError
}: {
  toolName: string;
  args?: { kind?: string; status?: string; title?: string; rawInput?: unknown; content?: unknown };
  result?: unknown;
  isError?: boolean;
}) {
  const kind = args?.kind ?? "tool";
  const status = args?.status ?? "in_progress";
  const title = args?.title ?? toolName;
  const content = renderToolContent(args?.content);
  const hasResult = result !== undefined && result !== null;
  const hasBody = content !== null || hasResult;

  return (
    <details
      className="card card--tool"
      data-kind={kind}
      data-status={isError ? "failed" : status}
    >
      <summary className="card__head">
        <span className="card__chevron" aria-hidden>
          ▸
        </span>
        <span className="card__kind">{kind}</span>
        <span className="card__title">{title}</span>
        <span className={`pill card__status card__status--${isError ? "failed" : status}`}>
          {isError ? "failed" : status.replace("_", " ")}
        </span>
      </summary>
      {hasBody ? (
        <div className="card__body">
          {content}
          {hasResult ? (
            <pre className="toolcall__output">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function renderToolContent(content: unknown): ReactNode {
  if (!Array.isArray(content) || content.length === 0) return null;
  return (
    <div className="toolcall__content">
      {content.map((block: unknown, idx) => {
        if (!block || typeof block !== "object") return null;
        const b = block as Record<string, unknown>;
        if (b.type === "diff" && typeof b.path === "string") {
          return (
            <div key={idx} className="toolcall__diff">
              <span className="toolcall__diff-path font-mono">{b.path}</span>
              <pre className="toolcall__diff-body">
                {String(b.newText ?? "")}
              </pre>
            </div>
          );
        }
        if (b.type === "content" && b.content) {
          const inner = b.content as Record<string, unknown>;
          if (typeof inner.text === "string") {
            return (
              <pre key={idx} className="toolcall__output">
                {inner.text}
              </pre>
            );
          }
        }
        if (typeof b.text === "string") {
          return (
            <pre key={idx} className="toolcall__output">
              {b.text}
            </pre>
          );
        }
        return null;
      })}
    </div>
  );
}

function ChatComposer({ disabled }: { disabled: boolean }) {
  return (
    <ComposerPrimitive.Root className="chat__composer">
      <ComposerPrimitive.Input
        rows={2}
        className="composer__input"
        placeholder={disabled ? "Pick an agent to start." : "Message"}
        disabled={disabled}
        submitOnEnter
      />
      <div className="composer__actions">
        <span className="composer__hint">
          {disabled ? (
            <>Select an agent above</>
          ) : (
            <>
              <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
            </>
          )}
        </span>
        <ComposerPrimitive.Send asChild>
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
