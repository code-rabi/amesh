import { useState } from "react";

const TOKEN_PLACEHOLDER = "your-registration-token";

function snippet(serverUrl: string, token: string) {
  return `curl -fsSL https://raw.githubusercontent.com/NitayRabi/amesh/main/install-amesh-node.sh \\
  | SERVER_URL='${serverUrl}' \\
    REGISTRATION_TOKEN='${token}' \\
    bash`;
}

export function EmptyState() {
  const [copied, setCopied] = useState(false);
  const serverOrigin =
    typeof window !== "undefined"
      ? window.location.origin.replace(/^http/, "ws") + "/ws?role=node"
      : "";
  const command = snippet(serverOrigin, TOKEN_PLACEHOLDER);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="empty">
      <div className="empty-card">
        <p className="empty-eyebrow">The mesh is empty</p>
        <h2 className="empty-title">No nodes yet.</h2>
        <p className="empty-body">
          Generate a registration token on the server, run the command on any machine, and the node
          appears here on first heartbeat.
        </p>
        <div className="code-block" aria-label="install command">
          <button type="button" className="copy" data-copied={copied} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          {command}
        </div>
      </div>
    </div>
  );
}
