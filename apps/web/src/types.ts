export type SessionView = {
  session: {
    id: string;
    entryAgentId: string;
    initiator: "user" | "agent";
    status: string;
    createdAt: string;
    parentSessionId: string | null;
    sourceAgentId: string | null;
  };
  events: Array<{
    id: string;
    eventType: string;
    sourceAgentId: string | null;
    targetAgentId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
};

export type SessionSummary = SessionView["session"];
