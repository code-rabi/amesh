import { Link, useRouterState } from "@tanstack/react-router";
import { GitBranch, MessagesSquare } from "lucide-react";

export function AppSidebar() {
  const { location } = useRouterState();

  const path = location.pathname;
  const isTopology = path === "/" || path.startsWith("/topology");
  const isSessions = path.startsWith("/sessions");

  return (
    <aside className="app-sidebar" aria-label="Application shell">
      <nav className="routenav routenav--rail" aria-label="primary">
        <Link to="/" data-active={isTopology} aria-label="Topology" title="Topology">
          <GitBranch />
          <span className="sr-only">Topology</span>
        </Link>
        <Link to="/sessions" data-active={isSessions} aria-label="Sessions" title="Sessions">
          <MessagesSquare />
          <span className="sr-only">Sessions</span>
        </Link>
      </nav>
    </aside>
  );
}
