package acpbridge

import (
	"context"
	"testing"
	"time"

	"github.com/NitayRabi/amesh/internal/acpconfig"
)

func TestStartPromptTurnStartsRemoteSessionAndStreamsUpdates(t *testing.T) {
	t.Parallel()

	client := &fakeMeshClient{
		startSession: RemoteSession{
			ID: "remote-1",
			Events: []RemoteEvent{
				{
					Type: "session.acp.update",
					Payload: map[string]any{
						"update": map[string]any{
							"sessionUpdate": "agent_message_chunk",
							"content": map[string]any{
								"type": "text",
								"text": "hello",
							},
						},
					},
				},
				{
					Type:    "session.output.completed",
					Payload: map[string]any{},
				},
			},
			Status: "completed",
		},
	}

	bridge := &Bridge{
		alias:    acpconfig.Alias{Name: "mesh-reviewer", AgentID: "agent-reviewer"},
		client:   client,
		sessions: map[string]*sessionState{},
	}
	state := &sessionState{LocalID: "sess-local"}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := bridge.startPromptTurn(ctx, state, 1, "review this", ioDiscard{}); err != nil {
		t.Fatalf("startPromptTurn() error = %v", err)
	}
	if client.startedAgentID != "agent-reviewer" || client.startedPrompt != "review this" {
		t.Fatalf("startSession called with (%q, %q), want (%q, %q)", client.startedAgentID, client.startedPrompt, "agent-reviewer", "review this")
	}
	if state.RemoteID != "remote-1" {
		t.Fatalf("state.RemoteID = %q, want %q", state.RemoteID, "remote-1")
	}
}

type fakeMeshClient struct {
	startSession    RemoteSession
	continueSession RemoteSession
	startedAgentID  string
	startedPrompt   string
}

func (client *fakeMeshClient) StartSession(_ context.Context, agentID string, prompt string) (RemoteSession, error) {
	client.startedAgentID = agentID
	client.startedPrompt = prompt
	return client.startSession, nil
}

func (client *fakeMeshClient) ContinueSession(_ context.Context, _ string, _ string) (RemoteSession, error) {
	return client.continueSession, nil
}

func (client *fakeMeshClient) CancelSession(_ context.Context, _ string) error { return nil }

func (client *fakeMeshClient) Subscribe(_ string) (<-chan RemoteEvent, func()) {
	ch := make(chan RemoteEvent)
	return ch, func() { close(ch) }
}

func (client *fakeMeshClient) AcknowledgeSnapshot(_ string, _ int) {}

func (client *fakeMeshClient) Close() error { return nil }

type ioDiscard struct{}

func (ioDiscard) Write(bytes []byte) (int, error) {
	return len(bytes), nil
}
