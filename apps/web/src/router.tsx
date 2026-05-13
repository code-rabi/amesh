import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter
} from "@tanstack/react-router";

import { AppSidebar } from "./components/AppSidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { TopBar } from "./components/TopBar.js";
import { useTopology } from "./lib/topologyContext.js";
import { LogsRoute } from "./routes/LogsRoute.js";
import { SessionsRoute } from "./routes/SessionsRoute.js";
import { TopologyRoute } from "./routes/TopologyRoute.js";

function Shell() {
  const { topology, connection } = useTopology();
  return (
    <div className="shell">
      <TopBar topology={topology} />
      {connection === "disconnected" ? (
        <ErrorBanner message="Lost connection to control plane. Retrying." />
      ) : null}
      <div className="shell__body">
        <AppSidebar />
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopologyRouteWrapper() {
  const { topology } = useTopology();
  return <TopologyRoute topology={topology} />;
}

type SessionsSearch = {
  session?: string;
  agent?: string;
  node?: string;
  folder?: string;
};

const rootRoute = createRootRoute({ component: Shell });

const topologyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TopologyRouteWrapper
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  validateSearch: (raw: Record<string, unknown>): SessionsSearch => ({
    session: typeof raw.session === "string" ? raw.session : undefined,
    agent: typeof raw.agent === "string" ? raw.agent : undefined,
    node: typeof raw.node === "string" ? raw.node : undefined,
    folder: typeof raw.folder === "string" ? raw.folder : undefined
  }),
  component: SessionsRoute
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  component: LogsRoute
});

const routeTree = rootRoute.addChildren([topologyRoute, sessionsRoute, logsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
