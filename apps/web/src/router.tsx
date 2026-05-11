import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter
} from "@tanstack/react-router";

import { ErrorBanner } from "./components/ErrorBanner.js";
import { TopBar } from "./components/TopBar.js";
import { useTopology } from "./lib/topologyContext.js";
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
      <Outlet />
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
    agent: typeof raw.agent === "string" ? raw.agent : undefined
  }),
  component: SessionsRoute
});

const routeTree = rootRoute.addChildren([topologyRoute, sessionsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
