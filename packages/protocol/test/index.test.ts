import { describe, expect, it } from "vitest";

import {
  capabilitySchema,
  browseNodeDirectoriesResponseSchema,
  browserRealtimeEventSchema,
  nodeDirectoryBrowsePayloadSchema,
  parseProtocolEnvelope,
  protocolEnvelopeSchema,
  sessionSchema,
  sessionStartPayloadSchema
} from "../src/index.js";

describe("protocol schema", () => {
  it("accepts the shared envelope shape", () => {
    const envelope = parseProtocolEnvelope({
      type: "session.start",
      requestId: "req_1",
      sessionId: "ses_1",
      source: "server",
      target: "node_1",
      payload: {
        agentId: "agent_1"
      }
    });

    expect(envelope.type).toBe("session.start");
    expect(protocolEnvelopeSchema.parse(envelope).target).toBe("node_1");
  });

  it("validates session start payloads", () => {
    const payload = sessionStartPayloadSchema.parse({
      sessionId: "ses_1",
      agentId: "agent_1",
      prompt: "hello",
      initiator: "user"
    });

    expect(payload.metadata).toEqual({});
  });

  it("defaults omitted session cwd to null", () => {
    const session = sessionSchema.parse({
      id: "ses_1",
      entryAgentId: "agent_1",
      initiator: "user",
      status: "pending",
      createdAt: new Date().toISOString()
    });

    expect(session.cwd).toBeNull();
  });

  it("validates browser realtime events", () => {
    const event = browserRealtimeEventSchema.parse({
      type: "topology.snapshot",
      payload: {
        nodes: [],
        agents: [],
        triggerRules: []
      }
    });

    expect(event.type).toBe("topology.snapshot");
  });

  it("defaults omitted capability args to an empty array", () => {
    const capability = capabilitySchema.parse({
      id: "agent_1",
      name: "Claude",
      acpxAgent: "claude",
      command: "acpx"
    });

    expect(capability.args).toEqual([]);
  });

  it("validates node directory browse payloads and responses", () => {
    const payload = nodeDirectoryBrowsePayloadSchema.parse({
      nodeId: "node_1"
    });
    const response = browseNodeDirectoriesResponseSchema.parse({
      path: "/srv/work",
      entries: [
        {
          name: "repo-a",
          path: "/srv/work/repo-a",
          hasChildren: true
        }
      ]
    });

    expect(payload.path).toBe("");
    expect(response.entries[0]?.path).toBe("/srv/work/repo-a");
  });
});
