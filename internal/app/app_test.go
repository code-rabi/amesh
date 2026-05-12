package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
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
			writeConfig(t, nodeconfig.File{NodeName: "node-a"}),
			acpx.Runner{},
			newSessionStore(),
			func(_ string) daemonClient {
				mu.Lock()
				defer mu.Unlock()
				client := clients[next]
				next++
				return client
			},
			func(context.Context, nodeconfig.AgentConfig) error {
				return nil
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
			func(context.Context, io.Writer, io.Writer) error {
				t.Fatal("unexpected update invocation")
				return nil
			},
			func(context.Context, string) error {
				t.Fatal("unexpected detect invocation")
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

func TestRunDispatchesUpdateSubcommand(t *testing.T) {
	t.Parallel()

	called := false
	err := run(
		context.Background(),
		[]string{"update"},
		func(context.Context, io.Writer, io.Writer) error {
			called = true
			return nil
		},
		func(context.Context, string) error { return nil },
	)
	if err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if !called {
		t.Fatal("expected update runner to be called")
	}
}

func TestRunDispatchesDetectSubcommand(t *testing.T) {
	t.Parallel()

	configPath := filepath.Join(t.TempDir(), "agents.json")
	called := false
	err := run(
		context.Background(),
		[]string{"detect", "--config", configPath},
		func(context.Context, io.Writer, io.Writer) error { return nil },
		func(_ context.Context, path string) error {
			called = path == configPath
			return nil
		},
	)
	if err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if !called {
		t.Fatal("expected detect runner to be called")
	}
}

func TestRunDaemonSessionHandlesNodeUpdate(t *testing.T) {
	t.Parallel()

	client := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
			{envelope: nodeclient.Envelope{Type: "node.update"}},
		},
	}

	called := false
	err := runDaemonSession(
		context.Background(),
		"ws://example.invalid/ws?role=node",
		"node-a",
		"token-a",
		writeConfig(t, nodeconfig.File{NodeName: "node-a"}),
		acpx.Runner{},
		newSessionStore(),
		func(string) daemonClient { return client },
		func(context.Context, nodeconfig.AgentConfig) error { return nil },
		func(context.Context, io.Writer, io.Writer) error {
			called = true
			return nil
		},
		func(context.Context, string) error {
			t.Fatal("unexpected detect invocation")
			return nil
		},
	)
	if err != nil {
		t.Fatalf("runDaemonSession() error = %v", err)
	}
	if !called {
		t.Fatal("expected update runner to be called")
	}
	assertEnvelopeTypes(t, client.sent, []string{"node.resume", "node.capabilities.sync"})
}

func TestRunDaemonSessionHandlesNodeDetect(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
			{envelope: nodeclient.Envelope{Type: "node.detect"}},
		},
		blockReadsUntilCanceled: true,
	}

	called := false
	err := runDaemonSession(
		ctx,
		"ws://example.invalid/ws?role=node",
		"node-a",
		"token-a",
		writeConfig(t, nodeconfig.File{
			NodeName: "node-a",
			Agents: []nodeconfig.AgentConfig{
				{ID: "agent-a", Name: "Agent A", ACPXAgent: "claude"},
			},
		}),
		acpx.Runner{},
		newSessionStore(),
		func(string) daemonClient { return client },
		func(context.Context, nodeconfig.AgentConfig) error { return nil },
		func(context.Context, io.Writer, io.Writer) error { return nil },
		func(_ context.Context, path string) error {
			called = true
			cancel()
			return nil
		},
	)
	if err != nil {
		t.Fatalf("runDaemonSession() error = %v", err)
	}
	if !called {
		t.Fatal("expected detect runner to be called")
	}
	assertEnvelopeTypes(t, client.sent, []string{"node.resume", "node.capabilities.sync", "node.capabilities.sync"})
}

func TestRunDaemonSessionHandlesNodePathUpdate(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rootA := t.TempDir()
	rootB := t.TempDir()
	configPath := writeConfig(t, nodeconfig.File{
		NodeName: "node-a",
		Agents: []nodeconfig.AgentConfig{
			{ID: "agent-a", Name: "Agent A", ACPXAgent: "claude", Command: "/bin/acpx"},
		},
	})
	client := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
			{
				envelope: nodeclient.Envelope{
					Type: "node.paths.update",
					Payload: map[string]any{
						"paths": []any{rootA, rootB},
					},
				},
			},
		},
		blockReadsUntilCanceled: true,
	}

	err := runDaemonSession(
		ctx,
		"ws://example.invalid/ws?role=node",
		"node-a",
		"token-a",
		configPath,
		acpx.Runner{},
		newSessionStore(),
		func(string) daemonClient { return client },
		func(context.Context, nodeconfig.AgentConfig) error {
			cancel()
			return nil
		},
		func(context.Context, io.Writer, io.Writer) error { return nil },
		func(context.Context, string) error { return nil },
	)
	if err != nil {
		t.Fatalf("runDaemonSession() error = %v", err)
	}

	config, err := nodeconfig.Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !slices.Equal(config.Paths, []string{rootA, rootB}) {
		t.Fatalf("config paths = %v, want %v", config.Paths, []string{rootA, rootB})
	}
	assertEnvelopeTypes(t, client.sent, []string{"node.resume", "node.capabilities.sync", "node.capabilities.sync"})
}

func TestRunDaemonSessionHandlesNodePathBrowse(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "repo-a"), 0o755); err != nil {
		t.Fatalf("mkdir repo-a: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "repo-b"), 0o755); err != nil {
		t.Fatalf("mkdir repo-b: %v", err)
	}
	configPath := writeConfig(t, nodeconfig.File{NodeName: "node-a"})
	client := &fakeDaemonClient{
		readResults: []fakeReadResult{
			{envelope: nodeclient.Envelope{Type: "node.resumed"}},
			{
				envelope: nodeclient.Envelope{
					Type:      "node.paths.browse",
					RequestID: "browse-1",
					Payload: map[string]any{
						"path": root,
					},
				},
			},
		},
		blockReadsUntilCanceled: true,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- runDaemonSession(
			ctx,
			"ws://example.invalid/ws?role=node",
			"node-a",
			"token-a",
			configPath,
			acpx.Runner{},
			newSessionStore(),
			func(string) daemonClient { return client },
			func(context.Context, nodeconfig.AgentConfig) error {
				return nil
			},
			func(context.Context, io.Writer, io.Writer) error { return nil },
			func(context.Context, string) error { return nil },
		)
	}()

	waitForSends(t, client, 3)
	cancel()
	if err := <-errCh; err != nil {
		t.Fatalf("runDaemonSession() error = %v", err)
	}

	var browseReply nodeclient.Envelope
	for _, envelope := range client.sent {
		if envelope.Type == "node.paths.browse.result" {
			browseReply = envelope
			break
		}
	}
	if browseReply.Type == "" {
		t.Fatal("expected node.paths.browse.result to be sent")
	}
	if browseReply.RequestID != "browse-1" {
		t.Fatalf("browse reply request id = %q, want browse-1", browseReply.RequestID)
	}
	if browseReply.Payload["path"] != root {
		t.Fatalf("browse path = %v, want %v", browseReply.Payload["path"], root)
	}
	rawEntries, ok := browseReply.Payload["entries"].([]map[string]any)
	if ok {
		if len(rawEntries) != 2 {
			t.Fatalf("browse entry count = %d, want 2", len(rawEntries))
		}
		return
	}
	entries, ok := browseReply.Payload["entries"].([]any)
	if !ok {
		t.Fatalf("browse entries type = %T", browseReply.Payload["entries"])
	}
	if len(entries) != 2 {
		t.Fatalf("browse entry count = %d, want 2", len(entries))
	}
}

func TestConfiguredAgentsKeepsBaseAgentsUnchanged(t *testing.T) {
	t.Parallel()

	got := configuredAgents(nodeconfig.File{
		NodeName: "node-a",
		Paths:    []string{"/work/repo-a", "/work/repo-b"},
		Agents: []nodeconfig.AgentConfig{
			{ID: "agent-codex", Name: "Codex", ACPXAgent: "codex", Command: "/bin/acpx"},
		},
	})

	want := []nodeconfig.AgentConfig{
		{
			ID:        "agent-codex",
			Name:      "Codex",
			ACPXAgent: "codex",
			Command:   "/bin/acpx",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("configuredAgents() = %#v, want %#v", got, want)
	}
}

func TestCapabilitiesWithStatus(t *testing.T) {
	t.Parallel()

	agents := []nodeconfig.AgentConfig{
		{ID: "healthy", Name: "Healthy", ACPXAgent: "healthy"},
		{ID: "down", Name: "Down", ACPXAgent: "down"},
	}

	got := capabilitiesWithStatus(context.Background(), agents, func(_ context.Context, agent nodeconfig.AgentConfig) error {
		if agent.ID == "down" {
			return errors.New("missing auth")
		}
		return nil
	})

	if len(got) != 2 {
		t.Fatalf("capabilitiesWithStatus() len = %d, want 2", len(got))
	}
	if got[0]["status"] != "online" || got[1]["status"] != "error" {
		t.Fatalf("capabilitiesWithStatus() = %#v, want online/error statuses", got)
	}
	if got[1]["error"] != "missing auth" {
		t.Fatalf("capabilitiesWithStatus() error = %#v, want missing auth", got[1]["error"])
	}
}

func TestParseDetectableAgentsFromACPXHelp(t *testing.T) {
	t.Parallel()

	help := `
Commands:
  openclaw [options] [prompt...]          Use openclaw agent
  codex [options] [prompt...]             Use codex agent
  claude [options] [prompt...]            Use claude agent
  gemini [options] [prompt...]            Use gemini agent
  cursor [options] [prompt...]            Use cursor agent
  copilot [options] [prompt...]           Use copilot agent
  droid [options] [prompt...]             Use droid agent
  iflow [options] [prompt...]             Use iflow agent
  kilocode [options] [prompt...]          Use kilocode agent
  kimi [options] [prompt...]              Use kimi agent
  kiro [options] [prompt...]              Use kiro agent
  opencode [options] [prompt...]          Use opencode agent
  qoder [options] [prompt...]             Use qoder agent
  qwen [options] [prompt...]              Use qwen agent
  trae [options] [prompt...]              Use trae agent
  prompt [options] [prompt...]            Prompt using codex by default
`

	got := parseDetectableAgentsFromACPXHelp(help)
	want := []detectableAgent{
		{ID: "agent-openclaw", Name: "OpenClaw", ACPXAgent: "openclaw"},
		{ID: "agent-codex", Name: "Codex", ACPXAgent: "codex"},
		{ID: "agent-claude", Name: "Claude", ACPXAgent: "claude"},
		{ID: "agent-gemini", Name: "Gemini", ACPXAgent: "gemini"},
		{ID: "agent-cursor", Name: "Cursor", ACPXAgent: "cursor"},
		{ID: "agent-copilot", Name: "Copilot", ACPXAgent: "copilot"},
		{ID: "agent-droid", Name: "Droid", ACPXAgent: "droid"},
		{ID: "agent-iflow", Name: "iFlow", ACPXAgent: "iflow"},
		{ID: "agent-kilocode", Name: "Kilo Code", ACPXAgent: "kilocode"},
		{ID: "agent-kimi", Name: "Kimi", ACPXAgent: "kimi"},
		{ID: "agent-kiro", Name: "Kiro", ACPXAgent: "kiro"},
		{ID: "agent-opencode", Name: "OpenCode", ACPXAgent: "opencode"},
		{ID: "agent-qoder", Name: "Qoder", ACPXAgent: "qoder"},
		{ID: "agent-qwen", Name: "Qwen", ACPXAgent: "qwen"},
		{ID: "agent-trae", Name: "Trae", ACPXAgent: "trae"},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("parseDetectableAgentsFromACPXHelp() = %#v, want %#v", got, want)
	}
}

func TestDefaultACPXCommandFallsBackToManagedInstall(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("AMESH_ACPX_PATH", "")

	managed := filepath.Join(home, ".local", "share", "amesh", "acpx", "bin", "acpx")
	writeExecutable(t, managed, "#!/bin/sh\nexit 0\n")

	if got := defaultACPXCommand(); got != managed {
		t.Fatalf("defaultACPXCommand() = %q, want %q", got, managed)
	}
}

func TestDetectAgentsFindsInstalledAgentsWithoutHealthProbe(t *testing.T) {
	home := t.TempDir()
	binDir := filepath.Join(t.TempDir(), "bin")
	nodeDir := filepath.Join(t.TempDir(), "node-bin")
	t.Setenv("HOME", home)
	t.Setenv("PATH", strings.Join([]string{binDir, nodeDir}, string(os.PathListSeparator)))
	t.Setenv("AMESH_ACPX_PATH", "")

	managed := filepath.Join(home, ".local", "share", "amesh", "acpx", "bin", "acpx")
	writeExecutable(t, managed, `#!/bin/sh
if [ "$1" = "--help" ]; then
cat <<'EOF'
Commands:
  codex [options] [prompt...]             Use codex agent
  claude [options] [prompt...]            Use claude agent
  gemini [options] [prompt...]            Use gemini agent
EOF
exit 0
fi
exit 1
`)
	writeExecutable(t, filepath.Join(nodeDir, "node"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(binDir, "codex"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(binDir, "claude"), "#!/bin/sh\nexit 0\n")

	got := detectAgents(context.Background(), acpx.Runner{})
	slices.SortFunc(got, func(a, b nodeconfig.AgentConfig) int {
		return strings.Compare(a.ID, b.ID)
	})
	pathEnv := strings.Join([]string{binDir, nodeDir}, string(os.PathListSeparator))
	want := []nodeconfig.AgentConfig{
		{
			ID:        "agent-claude",
			Name:      "Claude",
			ACPXAgent: "claude",
			Command:   managed,
			Args:      []string{},
			Env:       map[string]string{"PATH": pathEnv},
			Labels:    []string{"detected"},
		},
		{
			ID:        "agent-codex",
			Name:      "Codex",
			ACPXAgent: "codex",
			Command:   managed,
			Args:      []string{},
			Env:       map[string]string{"PATH": pathEnv},
			Labels:    []string{"detected"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("detectAgents() = %#v, want %#v", got, want)
	}
}

type fakeDaemonClient struct {
	mu                      sync.Mutex
	connectErr              error
	readResults             []fakeReadResult
	blockReadsUntilCanceled bool
	sent                    []nodeclient.Envelope
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

func writeConfig(t *testing.T, config nodeconfig.File) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "agents.json")
	if err := nodeconfig.Save(path, config); err != nil {
		t.Fatalf("save config: %v", err)
	}
	return path
}

func writeExecutable(t *testing.T, path string, contents string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
