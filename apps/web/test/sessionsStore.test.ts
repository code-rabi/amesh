import { describe, expect, it } from "vitest";

import { sameSessionSummary, sameSessionView } from "../src/lib/sessionsStore.js";
import type { SessionView } from "../src/types.js";

function sessionView(overrides: Partial<SessionView> = {}): SessionView {
  return {
    session: {
      id: "ses-1",
      entryAgentId: "agent-1",
      initiator: "user",
      status: "running",
      createdAt: "2026-05-13T10:00:00.000Z",
      cwd: "/srv/work/repo-a",
      parentSessionId: null,
      sourceAgentId: null
    },
    events: [
      {
        id: "evt-1",
        eventType: "session.created",
        sourceAgentId: null,
        targetAgentId: "agent-1",
        payload: { prompt: "hello" },
        createdAt: "2026-05-13T10:00:00.000Z"
      }
    ],
    ...overrides
  };
}

describe("sessions store equality guards", () => {
  it("treats duplicate session snapshots as unchanged", () => {
    const first = sessionView();
    const duplicate = sessionView({
      session: { ...first.session },
      events: first.events.map((event) => ({
        ...event,
        payload: { ...event.payload }
      }))
    });

    expect(sameSessionSummary(first.session, duplicate.session)).toBe(true);
    expect(sameSessionView(first, duplicate)).toBe(true);
  });

  it("detects appended streaming events as changed", () => {
    const first = sessionView();
    const next = sessionView({
      events: [
        ...first.events,
        {
          id: "evt-2",
          eventType: "session.acp.update",
          sourceAgentId: null,
          targetAgentId: "agent-1",
          payload: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { text: "world" }
            }
          },
          createdAt: "2026-05-13T10:00:01.000Z"
        }
      ]
    });

    expect(sameSessionView(first, next)).toBe(false);
  });
});
