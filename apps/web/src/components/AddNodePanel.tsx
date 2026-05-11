import { useEffect, useRef, useState } from "react";
import { fetchBootstrapConfig } from "../api.js";

type Props = {
  waitingForNodes: boolean;
  onClose: () => void;
};

function installCommand(serverUrl: string, token: string) {
  return `curl -fsSL https://raw.githubusercontent.com/code-rabi/amesh/main/install-amesh-node.sh \\
  | SERVER_URL='${serverUrl}' \\
    REGISTRATION_TOKEN='${token}' \\
    bash`;
}

export function AddNodePanel({ waitingForNodes, onClose }: Props) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const serverOrigin =
    typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") + "/ws?role=node" : "";
  const snippet = installCommand(serverOrigin, token);

  useEffect(() => {
    let active = true;

    void fetchBootstrapConfig()
      .then((config) => {
        if (!active) return;
        setToken(config.registrationToken);
      })
      .catch(() => {
        if (!active) return;
        setToken("");
      });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="addnode-panel" ref={ref} role="dialog" aria-label="Add node">
      <header>
        <h3>Add a node</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        Set <code>AMESH_REGISTRATION_TOKEN</code> on this server, then run the command below on any
        machine you want to register. The node appears here on first heartbeat.
      </p>

      <div className="field">
        <label htmlFor="amesh-token">Registration token</label>
        <input
          id="amesh-token"
          type="text"
          spellCheck={false}
          placeholder="registration token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>

      <div className="code-block">
        <button type="button" className="copy" data-copied={copied} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        {snippet}
      </div>

      {waitingForNodes ? <div className="waiting">Waiting for first heartbeat.</div> : null}
    </div>
  );
}
