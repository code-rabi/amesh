package app

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/NitayRabi/amesh/internal/acpx"
	"github.com/NitayRabi/amesh/internal/nodeclient"
	"github.com/NitayRabi/amesh/internal/nodeconfig"
	"github.com/NitayRabi/amesh/internal/nodestate"
)

// Run executes the node daemon CLI.
func Run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("expected subcommand: register, run, or update")
	}

	switch args[0] {
	case "register":
		return runRegister(ctx, args[1:])
	case "run":
		return runDaemon(ctx, args[1:])
	case "update":
		return runUpdate(ctx, os.Stdout, os.Stderr)
	default:
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func runUpdate(ctx context.Context, stdout, stderr io.Writer) error {
	if _, err := exec.LookPath("bash"); err != nil {
		return errors.New("required CLI missing: bash")
	}
	if _, err := exec.LookPath("curl"); err != nil {
		return errors.New("required CLI missing: curl")
	}

	repo := os.Getenv("AMESH_REPO")
	if repo == "" {
		repo = "NitayRabi/amesh"
	}
	installerURL := os.Getenv("AMESH_INSTALL_URL")
	if installerURL == "" {
		installerURL = fmt.Sprintf("https://raw.githubusercontent.com/%s/main/install-amesh-node.sh", repo)
	}

	cmd := exec.CommandContext(ctx, "bash", "-c", `set -euo pipefail; curl -fsSL "$AMESH_INSTALL_URL" | bash`)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = append(os.Environ(), "AMESH_INSTALL_URL="+installerURL)
	if os.Getenv("INSTALL_DIR") == "" {
		if installDir, ok := currentInstallDir(); ok {
			cmd.Env = append(cmd.Env, "INSTALL_DIR="+installDir)
		}
	}

	fmt.Fprintf(stdout, "updating amesh-node from %s\n", installerURL)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("update failed: %w", err)
	}
	return nil
}

func currentInstallDir() (string, bool) {
	executable, err := os.Executable()
	if err != nil {
		return "", false
	}
	return filepath.Dir(executable), true
}

func runRegister(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("register", flag.ContinueOnError)
	serverURL := flags.String("server", "ws://localhost:3001/ws?role=node", "control plane websocket URL")
	token := flags.String("token", "", "registration token")
	nodeID := flags.String("node-id", fmt.Sprintf("node-%d", time.Now().Unix()), "persistent node ID")
	configPath := flags.String("config", "examples/agents.json", "path to agents config")
	statePath := flags.String("state", ".amesh-node-state.json", "path to durable node state")
	if err := flags.Parse(args); err != nil {
		return err
	}

	config, err := nodeconfig.Load(*configPath)
	if err != nil {
		return err
	}

	client := nodeclient.New(*serverURL + "&nodeId=" + *nodeID)
	if err := client.Connect(ctx); err != nil {
		return err
	}

	result, err := client.Register(ctx, nodeclient.Envelope{
		Type:      "node.register",
		RequestID: fmt.Sprintf("register-%d", time.Now().UnixNano()),
		Source:    *nodeID,
		Target:    "server",
		Payload: map[string]any{
			"registrationToken": *token,
			"nodeName":          config.NodeName,
			"host":              hostname(),
			"labels":            []string{"local"},
		},
	})
	if err != nil {
		return err
	}

	if err := client.Send(ctx, nodeclient.Envelope{
		Type:      "node.capabilities.sync",
		RequestID: fmt.Sprintf("sync-%d", time.Now().UnixNano()),
		Source:    *nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":       *nodeID,
			"capabilities": config.Agents,
		},
	}); err != nil {
		return err
	}
	_ = client.Close()

	return nodestate.Save(*statePath, nodestate.File{
		NodeID:         result.NodeID,
		ReconnectToken: result.ReconnectToken,
		ServerURL:      *serverURL,
		ConfigPath:     *configPath,
	})
}

func runDaemon(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	serverURL := flags.String("server", "ws://localhost:3001/ws?role=node", "control plane websocket URL")
	nodeID := flags.String("node-id", "", "persistent node ID")
	reconnectToken := flags.String("reconnect-token", "", "durable reconnect token")
	configPath := flags.String("config", "examples/agents.json", "path to agents config")
	statePath := flags.String("state", ".amesh-node-state.json", "path to durable node state")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if *nodeID == "" {
		state, err := nodestate.Load(*statePath)
		if err == nil {
			if *nodeID == "" {
				*nodeID = state.NodeID
			}
			if *reconnectToken == "" {
				*reconnectToken = state.ReconnectToken
			}
			if *serverURL == "ws://localhost:3001/ws?role=node" && state.ServerURL != "" {
				*serverURL = state.ServerURL
			}
			if *configPath == "examples/agents.json" && state.ConfigPath != "" {
				*configPath = state.ConfigPath
			}
		}
	}
	if *nodeID == "" {
		return errors.New("node-id is required, either via --node-id or saved state")
	}
	if *reconnectToken == "" {
		return errors.New("reconnect-token is required, either via --reconnect-token or saved state")
	}

	config, err := nodeconfig.Load(*configPath)
	if err != nil {
		return err
	}

	client := nodeclient.New(*serverURL + "&nodeId=" + *nodeID)
	if err := client.Connect(ctx); err != nil {
		return err
	}

	if err := client.Send(ctx, nodeclient.Envelope{
		Type:      "node.resume",
		RequestID: fmt.Sprintf("resume-%d", time.Now().UnixNano()),
		Source:    *nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":         *nodeID,
			"reconnectToken": *reconnectToken,
		},
	}); err != nil {
		return err
	}
	reply, err := client.Read(ctx)
	if err != nil {
		return err
	}
	if reply.Type != "node.resumed" {
		return fmt.Errorf("unexpected resume reply %q", reply.Type)
	}

	if err := client.Send(ctx, nodeclient.Envelope{
		Type:      "node.capabilities.sync",
		RequestID: fmt.Sprintf("sync-%d", time.Now().UnixNano()),
		Source:    *nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":       *nodeID,
			"capabilities": config.Agents,
		},
	}); err != nil {
		return err
	}

	go func() {
		_ = client.HeartbeatLoop(ctx, *nodeID)
	}()

	runner := acpx.Runner{}
	sessions := newSessionStore()
	for {
		envelope, err := client.Read(ctx)
		if err != nil {
			return err
		}
		switch envelope.Type {
		case "session.start", "session.input":
			if err := startSession(ctx, client, runner, sessions, config, *nodeID, envelope); err != nil {
				return err
			}
		case "session.cancel":
			if err := cancelSession(ctx, client, sessions, *nodeID, envelope); err != nil {
				return err
			}
		}
	}
}

func startSession(
	ctx context.Context,
	client *nodeclient.Client,
	runner acpx.Runner,
	sessions *sessionStore,
	config nodeconfig.File,
	nodeID string,
	envelope nodeclient.Envelope,
) error {
	agentID, _ := envelope.Payload["agentId"].(string)
	prompt, _ := envelope.Payload["prompt"].(string)
	sessionID := deref(envelope.SessionID)

	var target *nodeconfig.AgentConfig
	for _, candidate := range config.Agents {
		if candidate.ID == agentID {
			candidate := candidate
			target = &candidate
			break
		}
	}
	if target == nil {
		return fmt.Errorf("agent %s not found in local config", agentID)
	}

	aggregatedPrompt, alreadyRunning := sessions.recordPrompt(sessionID, prompt)
	if alreadyRunning {
		return client.Send(ctx, failureEvent(nodeID, envelope.SessionID, agentID, "session already running"))
	}

	runCtx, cancel := context.WithCancel(ctx)
	sessions.setCancel(sessionID, cancel)
	go func() {
		defer sessions.clearRunning(sessionID)
		output, err := runner.Run(runCtx, acpx.RunRequest{
			Command:    target.Command,
			Args:       target.Args,
			Agent:      target.ACPXAgent,
			Session:    sessionID,
			WorkingDir: target.CWD,
			Env:        envList(target.Env),
			Stdin:      aggregatedPrompt,
		}, func(text string) {
			_ = client.Send(ctx, deltaEvent(nodeID, envelope.SessionID, agentID, text))
		})
		if err != nil {
			if errors.Is(runCtx.Err(), context.Canceled) {
				_ = client.Send(ctx, cancelledEvent(nodeID, envelope.SessionID, agentID, "cancelled"))
				return
			}
			_ = client.Send(ctx, failureEvent(nodeID, envelope.SessionID, agentID, err.Error()))
			return
		}

		_ = client.Send(ctx, completedEvent(nodeID, envelope.SessionID, agentID, string(output)))
	}()

	return nil
}

func cancelSession(
	ctx context.Context,
	client *nodeclient.Client,
	sessions *sessionStore,
	nodeID string,
	envelope nodeclient.Envelope,
) error {
	agentID, _ := envelope.Payload["agentId"].(string)
	reason, _ := envelope.Payload["reason"].(string)
	if sessions.cancel(deref(envelope.SessionID)) {
		return nil
	}
	return client.Send(ctx, cancelledEvent(nodeID, envelope.SessionID, agentID, reason))
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return "unknown-host"
	}
	return name
}

func envList(values map[string]string) []string {
	if len(values) == 0 {
		return nil
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)

	entries := make([]string, 0, len(keys))
	for _, key := range keys {
		entries = append(entries, fmt.Sprintf("%s=%s", key, values[key]))
	}
	return entries
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type sessionStore struct {
	mu      sync.Mutex
	prompts map[string][]string
	cancels map[string]context.CancelFunc
	running map[string]bool
}

func newSessionStore() *sessionStore {
	return &sessionStore{
		prompts: map[string][]string{},
		cancels: map[string]context.CancelFunc{},
		running: map[string]bool{},
	}
}

func (store *sessionStore) recordPrompt(sessionID string, prompt string) (string, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.running[sessionID] {
		return "", true
	}
	store.prompts[sessionID] = append(store.prompts[sessionID], prompt)
	store.running[sessionID] = true
	return strings.Join(store.prompts[sessionID], "\n\n"), false
}

func (store *sessionStore) setCancel(sessionID string, cancel context.CancelFunc) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.cancels[sessionID] = cancel
}

func (store *sessionStore) clearRunning(sessionID string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.running, sessionID)
	delete(store.cancels, sessionID)
}

func (store *sessionStore) cancel(sessionID string) bool {
	store.mu.Lock()
	cancel, ok := store.cancels[sessionID]
	store.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func deltaEvent(nodeID string, sessionID *string, agentID string, text string) nodeclient.Envelope {
	return nodeclient.Envelope{
		Type:      "session.event",
		RequestID: fmt.Sprintf("event-%d", time.Now().UnixNano()),
		SessionID: sessionID,
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"id":            fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			"sessionId":     deref(sessionID),
			"eventType":     "session.output.delta",
			"sourceAgentId": agentID,
			"targetAgentId": nil,
			"payload": map[string]any{
				"text": text,
			},
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}
}

func completedEvent(nodeID string, sessionID *string, agentID string, text string) nodeclient.Envelope {
	return nodeclient.Envelope{
		Type:      "session.event",
		RequestID: fmt.Sprintf("event-%d", time.Now().UnixNano()),
		SessionID: sessionID,
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"id":            fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			"sessionId":     deref(sessionID),
			"eventType":     "session.output.completed",
			"sourceAgentId": agentID,
			"targetAgentId": nil,
			"payload": map[string]any{
				"text": text,
			},
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}
}

func failureEvent(nodeID string, sessionID *string, agentID string, message string) nodeclient.Envelope {
	return nodeclient.Envelope{
		Type:      "session.event",
		RequestID: fmt.Sprintf("event-%d", time.Now().UnixNano()),
		SessionID: sessionID,
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"id":            fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			"sessionId":     deref(sessionID),
			"eventType":     "session.failed",
			"sourceAgentId": agentID,
			"targetAgentId": nil,
			"payload": map[string]any{
				"error": message,
			},
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}
}

func cancelledEvent(nodeID string, sessionID *string, agentID string, reason string) nodeclient.Envelope {
	return nodeclient.Envelope{
		Type:      "session.event",
		RequestID: fmt.Sprintf("event-%d", time.Now().UnixNano()),
		SessionID: sessionID,
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"id":            fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			"sessionId":     deref(sessionID),
			"eventType":     "session.cancelled",
			"sourceAgentId": agentID,
			"targetAgentId": nil,
			"payload": map[string]any{
				"reason": reason,
			},
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}
}
