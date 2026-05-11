import { createContext, useContext, type ReactNode } from "react";

import { type SessionsStore, useSessionsStore } from "./sessionsStore.js";

const SessionsContext = createContext<SessionsStore | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const store = useSessionsStore();
  return <SessionsContext.Provider value={store}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsStore {
  const value = useContext(SessionsContext);
  if (!value) throw new Error("useSessions must be used inside <SessionsProvider>");
  return value;
}
