import { RouterProvider } from "@tanstack/react-router";

import { SessionsProvider } from "./lib/sessionsContext.js";
import { TopologyProvider } from "./lib/topologyContext.js";
import { router } from "./router.js";
import "./styles.css";

export function App() {
  return (
    <TopologyProvider>
      <SessionsProvider>
        <RouterProvider router={router} />
      </SessionsProvider>
    </TopologyProvider>
  );
}
