package app

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/NitayRabi/amesh/internal/acpbridge"
	"github.com/NitayRabi/amesh/internal/acpconfig"
	"github.com/NitayRabi/amesh/internal/acpx"
	"github.com/NitayRabi/amesh/internal/nodeclient"
	"github.com/NitayRabi/amesh/internal/nodeconfig"
	"github.com/NitayRabi/amesh/internal/nodestate"
)

type daemonClient interface {
	Connect(ctx context.Context) error
	Close() error
	Send(ctx context.Context, envelope nodeclient.Envelope) error
	Read(ctx context.Context) (nodeclient.Envelope, error)
	HeartbeatLoop(ctx context.Context, nodeID string) error
}

type daemonClientFactory func(serverURL string) daemonClient

type sleeper func(ctx context.Context, delay time.Duration) error

type capabilityProber func(ctx context.Context, agent nodeconfig.AgentConfig) error

type nodeUpdateOptions struct {
	ServerURL  string
	NodeID     string
	ConfigPath string
	StatePath  string
	SelfUpdate bool
	Reinstall bool
}

type updateRunner func(ctx context.Context, stdout, stderr io.Writer, options nodeUpdateOptions) error
type detectRunner func(ctx context.Context, configPath string) error

type retryableDaemonError struct {
	err error
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "amesh-node %s %s\n", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
}

func sendNodeLog(ctx context.Context, client daemonClient, nodeID string, level string, message string, context map[string]any) {
	if context == nil {
		context = map[string]any{}
	}
	if err := client.Send(ctx, nodeclient.Envelope{
		Type:      "node.log",
		RequestID: fmt.Sprintf("log-%d", time.Now().UnixNano()),
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":     nodeID,
			"level":      level,
			"message":    message,
			"context":    context,
			"observedAt": time.Now().UTC().Format(time.RFC3339),
		},
	}); err != nil {
		logf("node log send failed node=%s error=%v", nodeID, err)
	}
}

func (err retryableDaemonError) Error() string {
	return err.err.Error()
}

func (err retryableDaemonError) Unwrap() error {
	return err.err
}

// Run executes the node daemon CLI.
func Run(ctx context.Context, args []string) error {
	return run(ctx, args, runUpdate, runDetect)
}

func run(ctx context.Context, args []string, update updateRunner, detect detectRunner) error {
	if len(args) == 0 {
		return errors.New("expected subcommand: register, run, detect, update, reinstall, logs, or acp")
	}

	switch args[0] {
	case "register":
		return runRegister(ctx, args[1:])
	case "run":
		return runDaemon(ctx, args[1:], update, detect)
	case "detect":
		return runDetectCommand(ctx, args[1:], detect)
	case "update":
		return update(ctx, os.Stdout, os.Stderr, nodeUpdateOptions{})
	case "reinstall":
		return update(ctx, os.Stdout, os.Stderr, nodeUpdateOptions{Reinstall: true})
	case "acp":
		return runACPBridge(ctx, args[1:], os.Stdin, os.Stdout)
	case "logs":
		return runLogs(ctx, args[1:], os.Stdout, os.Stderr)
	default:
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func runLogs(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("logs", flag.ContinueOnError)
	serviceName := flags.String("service", "amesh-node", "systemd user service name")
	lines := flags.Int("n", 200, "number of recent log lines")
	follow := flags.Bool("follow", true, "follow new log lines")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if _, err := exec.LookPath("journalctl"); err != nil {
		return fmt.Errorf("journalctl is required to read installed node logs: %w", err)
	}
	journalArgs := []string{"--user", "-u", *serviceName, "-n", fmt.Sprintf("%d", *lines), "--no-pager"}
	if *follow {
		journalArgs = append(journalArgs, "-f")
	}
	cmd := exec.CommandContext(ctx, "journalctl", journalArgs...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("read node logs: %w", err)
	}
	return nil
}

func runACPBridge(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer) error {
	flags := flag.NewFlagSet("acp", flag.ContinueOnError)
	configPath := flags.String("config", acpconfig.DefaultPath(), "path to ACP alias config")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("usage: amesh acp [--config path] <alias>")
	}

	alias, err := acpconfig.LoadAlias(*configPath, flags.Arg(0))
	if err != nil {
		return err
	}

	bridge, err := acpbridge.New(ctx, alias)
	if err != nil {
		return err
	}
	defer func() {
		_ = bridge.Close()
	}()

	return bridge.Serve(ctx, stdin, stdout)
}

func runUpdate(ctx context.Context, stdout, stderr io.Writer, options nodeUpdateOptions) error {
	return runInstaller(ctx, stdout, stderr, options, options.Reinstall)
}

func runReinstall(ctx context.Context, stdout, stderr io.Writer, options nodeUpdateOptions) error {
	options.Reinstall = true
	return runInstaller(ctx, stdout, stderr, options, true)
}

func runInstaller(ctx context.Context, stdout, stderr io.Writer, options nodeUpdateOptions, reinstall bool) error {
	if _, err := exec.LookPath("bash"); err != nil {
		return errors.New("required CLI missing: bash")
	}
	if _, err := exec.LookPath("curl"); err != nil {
		return errors.New("required CLI missing: curl")
	}

	repo := os.Getenv("AMESH_REPO")
	if repo == "" {
		repo = "code-rabi/amesh"
	}
	installerURL := os.Getenv("AMESH_INSTALL_URL")
	if installerURL == "" {
		installerURL = fmt.Sprintf("https://raw.githubusercontent.com/%s/main/install-amesh-node.sh", repo)
	}

	cmd := exec.CommandContext(ctx, "bash", "-c", `set -euo pipefail; curl -fsSL "$AMESH_INSTALL_URL" | bash`)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = append(os.Environ(), "AMESH_INSTALL_URL="+installerURL)
	if strings.TrimSpace(options.ServerURL) != "" && os.Getenv("SERVER_URL") == "" {
		cmd.Env = append(cmd.Env, "SERVER_URL="+options.ServerURL)
	}
	if strings.TrimSpace(options.NodeID) != "" && os.Getenv("NODE_ID") == "" {
		cmd.Env = append(cmd.Env, "NODE_ID="+options.NodeID)
	}
	if strings.TrimSpace(options.ConfigPath) != "" && os.Getenv("CONFIG_PATH") == "" {
		cmd.Env = append(cmd.Env, "CONFIG_PATH="+options.ConfigPath)
	}
	if strings.TrimSpace(options.StatePath) != "" && os.Getenv("STATE_PATH") == "" {
		cmd.Env = append(cmd.Env, "STATE_PATH="+options.StatePath)
	}
	if options.SelfUpdate {
		cmd.Env = append(cmd.Env, "AMESH_NODE_SELF_UPDATE=1")
	}
	if reinstall {
		cmd.Env = append(cmd.Env, "AMESH_NODE_REINSTALL=1")
	}
	if os.Getenv("INSTALL_DIR") == "" {
		if installDir, ok := currentInstallDir(); ok {
			cmd.Env = append(cmd.Env, "INSTALL_DIR="+installDir)
		}
	}

	action := "updating"
	if reinstall {
		action = "reinstalling"
	}
	fmt.Fprintf(stdout, "%s amesh-node from %s\n", action, installerURL)
	if err := cmd.Run(); err != nil {
		if reinstall {
			return fmt.Errorf("reinstall failed: %w", err)
		}
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

func defaultConfigPath() string {
	if path := strings.TrimSpace(os.Getenv("AMESH_NODE_CONFIG_PATH")); path != "" {
		return path
	}
	return ".amesh-agents.json"
}

type detectableAgent struct {
	ID        string
	Name      string
	ACPXAgent string
}

var detectableAgents = []detectableAgent{
	{ID: "agent-claude", Name: "Claude", ACPXAgent: "claude"},
	{ID: "agent-codex", Name: "Codex", ACPXAgent: "codex"},
	{ID: "agent-openclaw", Name: "OpenClaw", ACPXAgent: "openclaw"},
	{ID: "agent-pi", Name: "PI", ACPXAgent: "pi"},
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

var acpxHelpAgentLine = regexp.MustCompile(`^\s{2}([a-z0-9][a-z0-9-]*)\s+\[options\]\s+\[prompt\.\.\.\]\s+Use\s+(.+?)\s+agent\s*$`)

func defaultACPXCommand() string {
	if path := strings.TrimSpace(os.Getenv("AMESH_ACPX_PATH")); path != "" {
		return path
	}
	if home, err := os.UserHomeDir(); err == nil {
		managed := filepath.Join(home, ".local", "share", "amesh", "acpx", "bin", "acpx")
		if _, err := os.Stat(managed); err == nil {
			return managed
		}
	}
	return "acpx"
}

func runDetect(ctx context.Context, configPath string) error {
	nodeName := hostname()
	paths := []string{}
	if existing, err := nodeconfig.Load(configPath); err == nil && strings.TrimSpace(existing.NodeName) != "" {
		nodeName = existing.NodeName
		paths = existing.Paths
	}

	logf("detect start config=%s node=%s acpx=%s", configPath, nodeName, defaultACPXCommand())
	detected := detectAgents(ctx, acpx.Runner{})
	config := nodeconfig.File{
		NodeName: nodeName,
		Paths:    paths,
		Agents:   detected,
	}
	if err := nodeconfig.Save(configPath, config); err != nil {
		return err
	}
	logf("detect complete config=%s agents=%d", configPath, len(detected))
	fmt.Fprintf(os.Stdout, "detected %d agent(s) and wrote %s\n", len(detected), configPath)
	return nil
}

func runDetectCommand(ctx context.Context, args []string, detect detectRunner) error {
	flags := flag.NewFlagSet("detect", flag.ContinueOnError)
	configPath := flags.String("config", defaultConfigPath(), "path to agents config")
	statePath := flags.String("state", ".amesh-node-state.json", "path to durable node state")
	if err := flags.Parse(args); err != nil {
		return err
	}

	resolvedConfigPath := *configPath
	if resolvedConfigPath == defaultConfigPath() {
		if state, err := nodestate.Load(*statePath); err == nil && strings.TrimSpace(state.ConfigPath) != "" {
			resolvedConfigPath = state.ConfigPath
		}
	}
	return detect(ctx, resolvedConfigPath)
}

func detectAgents(ctx context.Context, runner acpx.Runner) []nodeconfig.AgentConfig {
	candidates := detectableAgents
	if parsed, err := detectableAgentsFromACPXHelp(ctx, defaultACPXCommand()); err == nil && len(parsed) > 0 {
		candidates = parsed
	}

	detectedCandidates := detectInstalledAgents(candidates)
	agents := make([]nodeconfig.AgentConfig, 0, len(candidates))
	for _, candidate := range detectedCandidates {
		env := detectedAgentEnv(candidate)
		if candidate.ACPXAgent == "openclaw" {
			var ok bool
			env, ok = verifiedOpenClawEnv(ctx, runner, env)
			if !ok {
				continue
			}
		}
		agent := nodeconfig.AgentConfig{
			ID:        candidate.ID,
			Name:      candidate.Name,
			ACPXAgent: candidate.ACPXAgent,
			Command:   defaultACPXCommand(),
			Args:      []string{},
			Env:       env,
			Labels:    []string{"detected"},
		}
		agents = append(agents, agent)
	}
	return agents
}

func verifiedOpenClawEnv(ctx context.Context, runner acpx.Runner, fallback map[string]string) (map[string]string, bool) {
	candidateDirs := openClawPathDirs()
	if len(candidateDirs) == 0 {
		return nil, false
	}

	baseEntries := filepath.SplitList(os.Getenv("PATH"))
	nodeDirs := commandPathDirs("node")
	for _, dir := range candidateDirs {
		pathEntries := uniquePathEntries([]string{dir}, nodeDirs, baseEntries)
		env := map[string]string{
			"PATH": strings.Join(pathEntries, string(os.PathListSeparator)),
		}
		probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := runner.Ensure(probeCtx, acpx.RunRequest{
			Command: defaultACPXCommand(),
			Agent:   "openclaw",
			Session: "amesh-detect-openclaw",
			Env:     envList(env),
		})
		cancel()
		if err == nil {
			return env, true
		}
		log.Printf("openclaw ACP readiness probe failed for PATH prefix %s: %v", dir, err)
	}

	if len(fallback) > 0 {
		return fallback, false
	}
	return nil, false
}

func openClawPathDirs() []string {
	seen := map[string]struct{}{}
	dirs := make([]string, 0)
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		path := filepath.Join(dir, "openclaw")
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || info.Mode()&0o111 == 0 {
			continue
		}
		for _, candidateDir := range executableDirs(path) {
			if _, ok := seen[candidateDir]; ok {
				continue
			}
			seen[candidateDir] = struct{}{}
			dirs = append(dirs, candidateDir)
		}
	}
	return dirs
}

func detectedAgentEnv(candidate detectableAgent) map[string]string {
	pathEntries := uniquePathEntries(
		commandPathDirs(candidate.ACPXAgent),
		commandPathDirs("node"),
		filepath.SplitList(os.Getenv("PATH")),
	)
	if len(pathEntries) == 0 {
		return map[string]string{}
	}
	return map[string]string{
		"PATH": strings.Join(pathEntries, string(os.PathListSeparator)),
	}
}

func commandPathDirs(command string) []string {
	if strings.TrimSpace(command) == "" {
		return nil
	}
	path, err := exec.LookPath(command)
	if err != nil {
		return nil
	}
	return executableDirs(path)
}

func executableDirs(path string) []string {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}

	dirs := make([]string, 0, 2)
	add := func(dir string) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		dir = filepath.Clean(dir)
		for _, existing := range dirs {
			if existing == dir {
				return
			}
		}
		dirs = append(dirs, dir)
	}

	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		add(filepath.Dir(resolved))
	}
	add(filepath.Dir(path))
	return dirs
}

func uniquePathEntries(groups ...[]string) []string {
	seen := map[string]struct{}{}
	entries := make([]string, 0)
	for _, group := range groups {
		for _, entry := range group {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			if _, ok := seen[entry]; ok {
				continue
			}
			seen[entry] = struct{}{}
			entries = append(entries, entry)
		}
	}
	return entries
}

func detectInstalledAgents(candidates []detectableAgent) []detectableAgent {
	detected := make([]detectableAgent, 0, len(candidates))
	for _, candidate := range candidates {
		if _, err := exec.LookPath(candidate.ACPXAgent); err == nil {
			detected = append(detected, candidate)
		}
	}
	return detected
}

func configuredAgents(config nodeconfig.File) []nodeconfig.AgentConfig {
	return append([]nodeconfig.AgentConfig(nil), config.Agents...)
}

func appendUniqueLabels(labels []string, extra ...string) []string {
	seen := make(map[string]struct{}, len(labels)+len(extra))
	merged := make([]string, 0, len(labels)+len(extra))
	for _, label := range labels {
		if _, ok := seen[label]; ok {
			continue
		}
		seen[label] = struct{}{}
		merged = append(merged, label)
	}
	for _, label := range extra {
		if _, ok := seen[label]; ok {
			continue
		}
		seen[label] = struct{}{}
		merged = append(merged, label)
	}
	return merged
}

func detectableAgentsFromACPXHelp(ctx context.Context, command string) ([]detectableAgent, error) {
	output, err := exec.CommandContext(ctx, command, "--help").CombinedOutput()
	if err != nil {
		return nil, err
	}
	return parseDetectableAgentsFromACPXHelp(string(output)), nil
}

func parseDetectableAgentsFromACPXHelp(help string) []detectableAgent {
	lines := strings.Split(help, "\n")
	agents := make([]detectableAgent, 0, len(lines))
	for _, line := range lines {
		matches := acpxHelpAgentLine.FindStringSubmatch(line)
		if len(matches) != 3 {
			continue
		}
		command := matches[1]
		name := strings.TrimSpace(matches[2])
		if command == "" || name == "" {
			continue
		}
		agents = append(agents, detectableAgent{
			ID:        "agent-" + command,
			Name:      displayNameForAgent(command, name),
			ACPXAgent: command,
		})
	}
	return agents
}

func displayNameForAgent(command string, fallback string) string {
	switch command {
	case "claude":
		return "Claude"
	case "codex":
		return "Codex"
	case "openclaw":
		return "OpenClaw"
	case "pi":
		return "PI"
	case "gemini":
		return "Gemini"
	case "cursor":
		return "Cursor"
	case "copilot":
		return "Copilot"
	case "droid":
		return "Droid"
	case "iflow":
		return "iFlow"
	case "kimi":
		return "Kimi"
	case "kiro":
		return "Kiro"
	case "kilocode":
		return "Kilo Code"
	case "qoder":
		return "Qoder"
	case "qwen":
		return "Qwen"
	case "trae":
		return "Trae"
	case "opencode":
		return "OpenCode"
	}
	if fallback != "" {
		return strings.ToUpper(fallback[:1]) + fallback[1:]
	}
	return strings.ToUpper(command[:1]) + command[1:]
}

func ensureConfigPath(ctx context.Context, configPath string, detect detectRunner) error {
	if _, err := os.Stat(configPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat config %s: %w", configPath, err)
	}
	return detect(ctx, configPath)
}

func runRegister(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("register", flag.ContinueOnError)
	serverURL := flags.String("server", "ws://localhost:3001/ws?role=node", "control plane websocket URL")
	token := flags.String("token", "", "registration token")
	nodeID := flags.String("node-id", fmt.Sprintf("node-%d", time.Now().Unix()), "persistent node ID")
	configPath := flags.String("config", defaultConfigPath(), "path to agents config")
	statePath := flags.String("state", ".amesh-node-state.json", "path to durable node state")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if err := ensureConfigPath(ctx, *configPath, runDetect); err != nil {
		return err
	}
	config, err := nodeconfig.Load(*configPath)
	if err != nil {
		return err
	}
	logf("register start node=%s server=%s config=%s agents=%d", *nodeID, *serverURL, *configPath, len(config.Agents))

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
			"version":           currentVersion(),
		},
	})
	if err != nil {
		return err
	}
	logf("register acknowledged node=%s reconnect_token=present", result.NodeID)

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
	logf("register capability sync sent node=%s capabilities=%d", *nodeID, len(config.Agents))
	_ = client.Close()

	if err := nodestate.Save(*statePath, nodestate.File{
		NodeID:         result.NodeID,
		ReconnectToken: result.ReconnectToken,
		ServerURL:      *serverURL,
		ConfigPath:     *configPath,
	}); err != nil {
		return err
	}
	logf("register complete node=%s state=%s", result.NodeID, *statePath)
	return nil
}

func runDaemon(ctx context.Context, args []string, update updateRunner, detect detectRunner) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	serverURL := flags.String("server", "ws://localhost:3001/ws?role=node", "control plane websocket URL")
	nodeID := flags.String("node-id", "", "persistent node ID")
	reconnectToken := flags.String("reconnect-token", "", "durable reconnect token")
	configPath := flags.String("config", defaultConfigPath(), "path to agents config")
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
			if *configPath == defaultConfigPath() && state.ConfigPath != "" {
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

	if err := ensureConfigPath(ctx, *configPath, detect); err != nil {
		return err
	}
	logf("run start node=%s server=%s state=%s config=%s", *nodeID, *serverURL, *statePath, *configPath)

	runner := acpx.Runner{}
	sessions := newSessionStore()
	return runDaemonLoop(
		ctx,
		*serverURL,
		*nodeID,
		*reconnectToken,
		*configPath,
		*statePath,
		runner,
		sessions,
		func(serverURL string) daemonClient {
			return nodeclient.New(serverURL)
		},
		probeAgentHealth(acpx.Runner{}),
		sleepWithContext,
		update,
		detect,
	)
}

func startSession(
	ctx context.Context,
	client daemonClient,
	runner acpx.Runner,
	sessions *sessionStore,
	configPath string,
	nodeID string,
	envelope nodeclient.Envelope,
) error {
	config, err := nodeconfig.Load(configPath)
	if err != nil {
		return fmt.Errorf("load config %s: %w", configPath, err)
	}
	agents := configuredAgents(config)
	agentID, _ := envelope.Payload["agentId"].(string)
	prompt, _ := envelope.Payload["prompt"].(string)
	requestedCWD, _ := envelope.Payload["cwd"].(string)
	sessionID := deref(envelope.SessionID)

	var target *nodeconfig.AgentConfig
	for _, candidate := range agents {
		if candidate.ID == agentID {
			candidate := candidate
			target = &candidate
			break
		}
	}
	if target == nil {
		return fmt.Errorf("agent %s not found in local config", agentID)
	}
	if requested := strings.TrimSpace(requestedCWD); requested != "" {
		allowed := requested == target.CWD
		if !allowed {
			for _, path := range config.Paths {
				if path == requested {
					allowed = true
					break
				}
			}
		}
		if !allowed {
			return fmt.Errorf("requested cwd %q is not exposed on this node", requested)
		}
	}

	aggregatedPrompt, alreadyRunning := sessions.recordPrompt(sessionID, prompt)
	if alreadyRunning {
		return client.Send(ctx, failureEvent(nodeID, envelope.SessionID, agentID, "session already running"))
	}

	runCtx, cancel := context.WithCancel(ctx)
	sessions.setCancel(sessionID, cancel)
	go func() {
		defer sessions.clearRunning(sessionID)
		workingDir := strings.TrimSpace(requestedCWD)
		if workingDir == "" {
			workingDir = target.CWD
		}
		_, err := runner.Run(runCtx, acpx.RunRequest{
			Command:    target.Command,
			Args:       target.Args,
			Agent:      target.ACPXAgent,
			Session:    sessionID,
			WorkingDir: workingDir,
			Env:        envList(target.Env),
			Stdin:      aggregatedPrompt,
		}, func(line string) {
			line = strings.TrimSpace(line)
			if line == "" {
				return
			}
			event, ok := acpUpdateEventFromLine(nodeID, envelope.SessionID, agentID, line)
			if !ok {
				return
			}
			_ = client.Send(ctx, event)
		})
		if err != nil {
			if errors.Is(runCtx.Err(), context.Canceled) {
				_ = client.Send(ctx, cancelledEvent(nodeID, envelope.SessionID, agentID, "cancelled"))
				return
			}
			_ = client.Send(ctx, failureEvent(nodeID, envelope.SessionID, agentID, err.Error()))
			return
		}

		_ = client.Send(ctx, completedEvent(nodeID, envelope.SessionID, agentID, ""))
	}()

	return nil
}

func updateConfigPaths(configPath string, paths []string) error {
	config, err := nodeconfig.Load(configPath)
	if err != nil {
		return fmt.Errorf("load config %s: %w", configPath, err)
	}

	resolved, err := resolveExposedPaths(paths)
	if err != nil {
		return err
	}
	config.Paths = resolved
	if err := nodeconfig.Save(configPath, config); err != nil {
		return err
	}
	return nil
}

func resolveExposedPaths(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return []string{}, nil
	}

	seen := make(map[string]struct{}, len(paths))
	resolved := make([]string, 0, len(paths))
	for _, raw := range paths {
		path := strings.TrimSpace(raw)
		if path == "" {
			continue
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, fmt.Errorf("resolve path %q: %w", path, err)
		}
		info, err := os.Stat(absolute)
		if err != nil {
			return nil, fmt.Errorf("stat path %q: %w", absolute, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("path %q is not a directory", absolute)
		}
		if _, ok := seen[absolute]; ok {
			continue
		}
		seen[absolute] = struct{}{}
		resolved = append(resolved, absolute)
	}
	return resolved, nil
}

type directoryEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	HasChildren bool   `json:"hasChildren"`
}

func browseDirectories(configPath string, requestedPath string) (string, []map[string]any, error) {
	root, err := resolveBrowseRoot(configPath, requestedPath)
	if err != nil {
		return "", nil, err
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return "", nil, fmt.Errorf("read directory %q: %w", root, err)
	}

	children := make([]directoryEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		childPath := filepath.Join(root, entry.Name())
		hasChildren, err := directoryHasChildren(childPath)
		if err != nil {
			return "", nil, err
		}
		children = append(children, directoryEntry{
			Name:        entry.Name(),
			Path:        childPath,
			HasChildren: hasChildren,
		})
	}
	sort.Slice(children, func(i, j int) bool {
		return strings.ToLower(children[i].Name) < strings.ToLower(children[j].Name)
	})

	payload := make([]map[string]any, 0, len(children))
	for _, child := range children {
		raw, err := json.Marshal(child)
		if err != nil {
			return "", nil, fmt.Errorf("encode directory entry: %w", err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return "", nil, fmt.Errorf("decode directory entry: %w", err)
		}
		payload = append(payload, parsed)
	}
	return root, payload, nil
}

func resolveBrowseRoot(configPath string, requestedPath string) (string, error) {
	path := strings.TrimSpace(requestedPath)
	if path == "" {
		config, err := nodeconfig.Load(configPath)
		if err == nil && len(config.Paths) > 0 {
			parent := filepath.Dir(config.Paths[0])
			if parent != "" {
				path = parent
			}
		}
	}
	if path == "" {
		home, err := os.UserHomeDir()
		if err == nil && strings.TrimSpace(home) != "" {
			path = home
		}
	}
	if path == "" {
		path = string(filepath.Separator)
	}

	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve directory %q: %w", path, err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("stat directory %q: %w", absolute, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("path %q is not a directory", absolute)
	}
	return absolute, nil
}

func directoryHasChildren(path string) (bool, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false, fmt.Errorf("read directory %q: %w", path, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			return true, nil
		}
	}
	return false, nil
}

func cancelSession(
	ctx context.Context,
	client daemonClient,
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

func runDaemonLoop(
	ctx context.Context,
	serverURL string,
	nodeID string,
	reconnectToken string,
	configPath string,
	statePath string,
	runner acpx.Runner,
	sessions *sessionStore,
	clientFactory daemonClientFactory,
	probe capabilityProber,
	sleep sleeper,
	update updateRunner,
	detect detectRunner,
) error {
	backoff := time.Second

	for {
		logf("run loop connect node=%s server=%s", nodeID, serverURL)
		err := runDaemonSession(
			ctx,
			serverURL,
			nodeID,
			reconnectToken,
			configPath,
			statePath,
			runner,
			sessions,
			clientFactory,
			probe,
			update,
			detect,
		)
		if err == nil || errors.Is(err, context.Canceled) {
			return nil
		}

		var retryable retryableDaemonError
		if !errors.As(err, &retryable) {
			return err
		}
		logf("run loop retry node=%s error=%v backoff=%s", nodeID, retryable.err, backoff)

		if sleepErr := sleep(ctx, backoff); sleepErr != nil {
			return nil
		}
		if backoff < 15*time.Second {
			backoff *= 2
			if backoff > 15*time.Second {
				backoff = 15 * time.Second
			}
		}
	}
}

func runDaemonSession(
	ctx context.Context,
	serverURL string,
	nodeID string,
	reconnectToken string,
	configPath string,
	statePath string,
	runner acpx.Runner,
	sessions *sessionStore,
	clientFactory daemonClientFactory,
	probe capabilityProber,
	update updateRunner,
	detect detectRunner,
) error {
	client := clientFactory(serverURL + "&nodeId=" + nodeID)
	if err := client.Connect(ctx); err != nil {
		return retryableDaemonError{err: err}
	}
	logf("session connected node=%s", nodeID)
	defer func() {
		_ = client.Close()
	}()

	if err := client.Send(ctx, nodeclient.Envelope{
		Type:      "node.resume",
		RequestID: fmt.Sprintf("resume-%d", time.Now().UnixNano()),
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":         nodeID,
			"reconnectToken": reconnectToken,
			"version":        currentVersion(),
		},
	}); err != nil {
		return retryableDaemonError{err: err}
	}
	reply, err := client.Read(ctx)
	if err != nil {
		return retryableDaemonError{err: err}
	}
	if reply.Type == "node.resume.denied" {
		return fmt.Errorf("resume denied: %v", reply.Payload["reason"])
	}
	if reply.Type != "node.resumed" {
		return fmt.Errorf("unexpected resume reply %q", reply.Type)
	}
	logf("session resumed node=%s", nodeID)

	if err := syncHealthyCapabilities(ctx, client, nodeID, configPath, probe); err != nil {
		return retryableDaemonError{err: err}
	}
	sendNodeLog(ctx, client, nodeID, "info", "node session resumed", map[string]any{
		"serverUrl": serverURL,
		"config":    configPath,
		"version":   currentVersion(),
	})

	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		_ = client.HeartbeatLoop(sessionCtx, nodeID)
	}()
	go func() {
		_ = capabilitySyncLoop(sessionCtx, client, nodeID, configPath, probe)
	}()

	for {
		envelope, err := client.Read(sessionCtx)
		if err != nil {
			if errors.Is(sessionCtx.Err(), context.Canceled) {
				return nil
			}
			return retryableDaemonError{err: err}
		}
		switch envelope.Type {
		case "session.start", "session.input":
			logf("session command node=%s type=%s session=%s", nodeID, envelope.Type, deref(envelope.SessionID))
			sendNodeLog(sessionCtx, client, nodeID, "info", "session command received", map[string]any{
				"type":      envelope.Type,
				"sessionId": deref(envelope.SessionID),
				"agentId":   envelope.Payload["agentId"],
			})
			if err := startSession(sessionCtx, client, runner, sessions, configPath, nodeID, envelope); err != nil {
				sendNodeLog(sessionCtx, client, nodeID, "error", "session command failed", map[string]any{
					"type":      envelope.Type,
					"sessionId": deref(envelope.SessionID),
					"error":     err.Error(),
				})
				return retryableDaemonError{err: err}
			}
		case "session.cancel":
			logf("session cancel node=%s session=%s", nodeID, deref(envelope.SessionID))
			sendNodeLog(sessionCtx, client, nodeID, "warn", "session cancel received", map[string]any{
				"sessionId": deref(envelope.SessionID),
			})
			if err := cancelSession(sessionCtx, client, sessions, nodeID, envelope); err != nil {
				return retryableDaemonError{err: err}
			}
		case "node.detect":
			logf("detect command node=%s config=%s", nodeID, configPath)
			sendNodeLog(sessionCtx, client, nodeID, "info", "agent detection started", map[string]any{
				"config": configPath,
			})
			if err := detect(sessionCtx, configPath); err != nil {
				sendNodeLog(sessionCtx, client, nodeID, "error", "agent detection failed", map[string]any{
					"config": configPath,
					"error":  err.Error(),
				})
				return fmt.Errorf("node detect failed: %w", err)
			}
			if err := syncHealthyCapabilities(sessionCtx, client, nodeID, configPath, probe); err != nil {
				return retryableDaemonError{err: err}
			}
		case "node.paths.update":
			paths, ok := envelope.Payload["paths"].([]any)
			if !ok {
				return fmt.Errorf("node path update failed: invalid paths payload")
			}
			nextPaths := make([]string, 0, len(paths))
			for _, raw := range paths {
				path, ok := raw.(string)
				if !ok {
					return fmt.Errorf("node path update failed: invalid path entry")
				}
				nextPaths = append(nextPaths, path)
			}
			if err := updateConfigPaths(configPath, nextPaths); err != nil {
				sendNodeLog(sessionCtx, client, nodeID, "error", "path update failed", map[string]any{
					"error": err.Error(),
				})
				return fmt.Errorf("node path update failed: %w", err)
			}
			sendNodeLog(sessionCtx, client, nodeID, "info", "node paths updated", map[string]any{
				"paths": nextPaths,
			})
			if err := syncHealthyCapabilities(sessionCtx, client, nodeID, configPath, probe); err != nil {
				return retryableDaemonError{err: err}
			}
		case "node.paths.browse":
			path, _ := envelope.Payload["path"].(string)
			browsedPath, entries, err := browseDirectories(configPath, path)
			if err != nil {
				return fmt.Errorf("node path browse failed: %w", err)
			}
			if err := client.Send(sessionCtx, nodeclient.Envelope{
				Type:      "node.paths.browse.result",
				RequestID: envelope.RequestID,
				SessionID: nil,
				Source:    nodeID,
				Target:    "server",
				Payload: map[string]any{
					"nodeId":  nodeID,
					"path":    browsedPath,
					"entries": entries,
				},
			}); err != nil {
				return retryableDaemonError{err: err}
			}
		case "node.update":
			logf("update command node=%s", nodeID)
			sendNodeLog(sessionCtx, client, nodeID, "warn", "node update requested", map[string]any{
				"serverUrl": serverURL,
				"config":    configPath,
				"state":     statePath,
			})
			if err := update(sessionCtx, os.Stdout, os.Stderr, nodeUpdateOptions{
				ServerURL:  serverURL,
				NodeID:     nodeID,
				ConfigPath: configPath,
				StatePath:  statePath,
				SelfUpdate: true,
			}); err != nil {
				sendNodeLog(sessionCtx, client, nodeID, "error", "node update failed", map[string]any{
					"error": err.Error(),
				})
				return fmt.Errorf("node update failed: %w", err)
			}
			return nil
		}
	}
}

func syncHealthyCapabilities(
	ctx context.Context,
	client daemonClient,
	nodeID string,
	configPath string,
	probe capabilityProber,
) error {
	config, err := nodeconfig.Load(configPath)
	if err != nil {
		return fmt.Errorf("load config %s: %w", configPath, err)
	}
	capabilities := capabilitiesWithStatus(ctx, configuredAgents(config), probe)
	logf("capability sync node=%s config=%s configured=%d healthy=%d", nodeID, configPath, len(config.Agents), len(capabilities))
	errorCount := 0
	for _, capability := range capabilities {
		if capability["status"] != "error" {
			continue
		}
		errorCount++
		sendNodeLog(ctx, client, nodeID, "error", "agent health probe failed", map[string]any{
			"agentId":   capability["id"],
			"agentName": capability["name"],
			"acpxAgent": capability["acpxAgent"],
			"error":     capability["error"],
		})
	}
	sendNodeLog(ctx, client, nodeID, "info", "capability sync completed", map[string]any{
		"config":     configPath,
		"configured": len(config.Agents),
		"healthy":    len(capabilities) - errorCount,
		"errors":     errorCount,
	})
	return client.Send(ctx, nodeclient.Envelope{
		Type:      "node.capabilities.sync",
		RequestID: fmt.Sprintf("sync-%d", time.Now().UnixNano()),
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"nodeId":       nodeID,
			"capabilities": capabilities,
		},
	})
}

func capabilitySyncLoop(
	ctx context.Context,
	client daemonClient,
	nodeID string,
	configPath string,
	probe capabilityProber,
) error {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := syncHealthyCapabilities(ctx, client, nodeID, configPath, probe); err != nil {
				return err
			}
		}
	}
}

func capabilitiesWithStatus(
	ctx context.Context,
	agents []nodeconfig.AgentConfig,
	probe capabilityProber,
) []map[string]any {
	capabilities := make([]map[string]any, 0, len(agents))
	for _, agent := range agents {
		status := "online"
		if probe != nil {
			if probeErr := probe(ctx, agent); probeErr != nil {
				status = "error"
				capabilities = append(capabilities, map[string]any{
					"id":        agent.ID,
					"name":      agent.Name,
					"acpxAgent": agent.ACPXAgent,
					"command":   agent.Command,
					"args":      agent.Args,
					"status":    status,
					"error":     probeErr.Error(),
					"cwd":       agent.CWD,
					"env":       agent.Env,
					"labels":    agent.Labels,
				})
				continue
			}
		}
		capabilities = append(capabilities, map[string]any{
			"id":        agent.ID,
			"name":      agent.Name,
			"acpxAgent": agent.ACPXAgent,
			"command":   agent.Command,
			"args":      agent.Args,
			"status":    status,
			"cwd":       agent.CWD,
			"env":       agent.Env,
			"labels":    agent.Labels,
		})
	}
	return capabilities
}

func probeAgentHealth(runner acpx.Runner) capabilityProber {
	return func(ctx context.Context, agent nodeconfig.AgentConfig) error {
		probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()

		err := runner.Ensure(probeCtx, acpx.RunRequest{
			Command:    agent.Command,
			Args:       agent.Args,
			Agent:      agent.ACPXAgent,
			Session:    "amesh-health-" + agent.ID,
			WorkingDir: agent.CWD,
			Env:        envList(agent.Env),
		})
		if err != nil {
			log.Printf("agent health probe failed for %s (%s): %v", agent.Name, agent.ID, err)
		}
		return err
	}
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return "unknown-host"
	}
	return name
}

func currentVersion() string {
	if version := strings.TrimSpace(os.Getenv("AMESH_NODE_VERSION")); version != "" {
		return version
	}

	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	version := strings.TrimSpace(info.Main.Version)
	if version == "" || version == "(devel)" {
		return ""
	}
	return version
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

// acpUpdateEventFromLine parses one stdout line from `acpx --format json` and, if it
// represents an ACP session/update notification, wraps the raw update payload in an
// amesh session.event for forwarding to the control plane. Other JSON-RPC traffic
// (requests, responses) is ignored: amesh's browser surface only needs the agent's
// session/update notifications.
func acpUpdateEventFromLine(nodeID string, sessionID *string, agentID string, line string) (nodeclient.Envelope, bool) {
	var rpc struct {
		JSONRPC string         `json:"jsonrpc"`
		Method  string         `json:"method"`
		Params  map[string]any `json:"params"`
	}
	if err := json.Unmarshal([]byte(line), &rpc); err != nil {
		return nodeclient.Envelope{}, false
	}
	if rpc.JSONRPC == "" || rpc.Method != "session/update" || rpc.Params == nil {
		return nodeclient.Envelope{}, false
	}
	update, ok := rpc.Params["update"].(map[string]any)
	if !ok {
		return nodeclient.Envelope{}, false
	}

	return nodeclient.Envelope{
		Type:      "session.event",
		RequestID: fmt.Sprintf("event-%d", time.Now().UnixNano()),
		SessionID: sessionID,
		Source:    nodeID,
		Target:    "server",
		Payload: map[string]any{
			"id":            fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			"sessionId":     deref(sessionID),
			"eventType":     "session.acp.update",
			"sourceAgentId": agentID,
			"targetAgentId": nil,
			"payload": map[string]any{
				"update": update,
			},
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}, true
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
