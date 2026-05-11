package app

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/NitayRabi/amesh/internal/acpx"
	"github.com/NitayRabi/amesh/internal/nodeclient"
	"github.com/NitayRabi/amesh/internal/nodeconfig"
)

func TestEnvList(t *testing.T) {
	t.Parallel()

	got := envList(map[string]string{
		"BETA":  "two",
		"ALPHA": "one",
	})

	want := []string{"ALPHA=one", "BETA=two"}
	if !slices.Equal(got, want) {
		t.Fatalf("envList() = %v, want %v", got, want)
	}
}

func TestRunDaemonLoopReconnectsAfterDisconnect(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	first := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
			{err: errors.New("server closed connection")},
		},
	}
	second := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
		},
		blockReadsUntilCanceled: true,
	}

	var (
		mu      sync.Mutex
		clients = []*fakeDaemonClient{first, second}
		next    int
		sleeps  int
	)

	errCh := make(chan error, 1)
	go func() {
		errCh <- runDaemonLoop(
			ctx,
			"ws://example.invalid/ws?role=node",
			"node-a",
			"token-a",
			nodeconfig.File{},
			acpx.Runner{},
			newSessionStore(),
			func(_ string) daemonClient {
				mu.Lock()
				defer mu.Unlock()
				client := clients[next]
				next++
				return client
			},
			func(context.Context, nodeconfig.AgentConfig) bool {
				return true
			},
			func(ctx context.Context, delay time.Duration) error {
				mu.Lock()
				sleeps++
				mu.Unlock()
				if delay <= 0 {
					t.Fatalf("expected positive retry delay, got %v", delay)
				}
				return nil
			},
		)
	}()

	waitForSends(t, first, 2)
	waitForSends(t, second, 2)
	cancel()

	if err := <-errCh; err != nil {
		t.Fatalf("runDaemonLoop() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if sleeps != 1 {
		t.Fatalf("sleep calls = %d, want 1", sleeps)
	}

	assertEnvelopeTypes(t, first.sent, []string{"node.resume", "node.capabilities.sync"})
	assertEnvelopeTypes(t, second.sent, []string{"node.resume", "node.capabilities.sync"})
}

func TestFilterHealthyAgents(t *testing.T) {
	t.Parallel()

	agents := []nodeconfig.AgentConfig{
		{ID: "healthy", Name: "Healthy", ACPXAgent: "healthy"},
		{ID: "down", Name: "Down", ACPXAgent: "down"},
	}

	got := filterHealthyAgents(context.Background(), agents, func(_ context.Context, agent nodeconfig.AgentConfig) bool {
		return agent.ID != "down"
	})

	if len(got) != 1 || got[0].ID != "healthy" {
		t.Fatalf("filterHealthyAgents() = %#v, want only healthy agent", got)
	}
}

type fakeDaemonClient struct {
	mu                     sync.Mutex
	connectErr             error
	readResults            []fakeReadResult
	blockReadsUntilCanceled bool
	sent                   []nodeclient.Envelope
}

type fakeReadResult struct {
	envelope nodeclient.Envelope
	err      error
}

func (client *fakeDaemonClient) Connect(context.Context) error {
	return client.connectErr
}

func (client *fakeDaemonClient) Close() error {
	return nil
}

func (client *fakeDaemonClient) Send(_ context.Context, envelope nodeclient.Envelope) error {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.sent = append(client.sent, envelope)
	return nil
}

func (client *fakeDaemonClient) Read(ctx context.Context) (nodeclient.Envelope, error) {
	client.mu.Lock()
	if len(client.readResults) > 0 {
		result := client.readResults[0]
		client.readResults = client.readResults[1:]
		client.mu.Unlock()
		return result.envelope, result.err
	}
	block := client.blockReadsUntilCanceled
	client.mu.Unlock()

	if block {
		<-ctx.Done()
		return nodeclient.Envelope{}, ctx.Err()
	}
	return nodeclient.Envelope{}, errors.New("unexpected read")
}

func (client *fakeDaemonClient) HeartbeatLoop(ctx context.Context, _ string) error {
	<-ctx.Done()
	return ctx.Err()
}

func waitForSends(t *testing.T, client *fakeDaemonClient, want int) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		client.mu.Lock()
		got := len(client.sent)
		client.mu.Unlock()
		if got >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	client.mu.Lock()
	defer client.mu.Unlock()
	t.Fatalf("client sent %d envelopes, want at least %d", len(client.sent), want)
}

func assertEnvelopeTypes(t *testing.T, envelopes []nodeclient.Envelope, want []string) {
	t.Helper()

	got := make([]string, 0, len(envelopes))
	for _, envelope := range envelopes {
		got = append(got, envelope.Type)
	}
	if !slices.Equal(got, want) {
		t.Fatalf("envelope types = %v, want %v", got, want)
	}
}
