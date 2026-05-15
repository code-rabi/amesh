import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AgentRecord } from "@amesh/protocol";
import { fetchBootstrapConfig } from "../api.js";

type Props = {
  agent: AgentRecord;
  onClose: () => void;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="copy" data-copied={copied} onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function mcpConfig(endpoint: string, registrationToken: string, agentId: string) {
  return JSON.stringify(
    {
      mcpServers: {
        amesh: {
          url: endpoint,
          headers: {
            Authorization: `Bearer ${registrationToken}`,
            "x-amesh-agent-id": agentId
          }
        }
      }
    },
    null,
    2
  );
}

export function McpPanel({ agent, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [registrationToken, setRegistrationToken] = useState("");
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "";

  useEffect(() => {
    let active = true;
    void fetchBootstrapConfig()
      .then((config) => {
        if (!active) return;
        setRegistrationToken(config.registrationToken);
      })
      .catch(() => { /* silent */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOverlayMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const configJson = registrationToken ? mcpConfig(endpoint, registrationToken, agent.id) : "";

  return createPortal(
    <div className="mcp-overlay" onMouseDown={handleOverlayMouseDown}>
      <div
        className="mcp-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`MCP config for ${agent.name}`}
      >
        <header className="mcp-dialog__header">
          <div>
            <h3 className="mcp-dialog__title">MCP Config</h3>
            <div className="mcp-dialog__subtitle">{agent.name}</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="mcp-dialog__desc">
          Paste into your MCP client config. This token scopes the connection to{" "}
          <strong>{agent.name}</strong> only.
        </p>

        <div className="mcp-dialog__field">
          <span className="mcp-dialog__label">Agent ID</span>
          <code className="mcp-dialog__value">{agent.id}</code>
        </div>

        <div className="mcp-dialog__field">
          <span className="mcp-dialog__label">Config JSON</span>
          {registrationToken ? (
            <div className="code-block">
              <CopyButton text={configJson} />
              {configJson}
            </div>
          ) : (
            <span className="mcp-dialog__loading">Loading&hellip;</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
