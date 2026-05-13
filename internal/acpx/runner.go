package acpx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// RunRequest describes one acpx process invocation.
type RunRequest struct {
	Command    string
	Args       []string
	Agent      string
	Session    string
	WorkingDir string
	Env        []string
	Stdin      string
}

// Runner executes local acpx-backed agent requests.
type Runner struct{}

// Ensure checks that the configured ACPX-backed agent session can be established.
func (Runner) Ensure(ctx context.Context, request RunRequest) error {
	command := request.Command
	if command == "" {
		command = "acpx"
	}
	if strings.TrimSpace(request.Agent) == "" {
		return nil
	}
	if err := ensureCompatibleConfig(); err != nil {
		return err
	}
	err := runCommand(ctx, command, buildEnsureArgs(request), request.WorkingDir, request.Env, "")
	if err == nil {
		return nil
	}
	if request.Session == "" || !isMissingACPMetadataError(err) {
		return err
	}
	if newErr := runCommand(ctx, command, buildSessionNewArgs(request), request.WorkingDir, request.Env, ""); newErr != nil {
		return fmt.Errorf("%w; recreate acpx session after missing ACP metadata: %v", err, newErr)
	}
	return runCommand(ctx, command, buildEnsureArgs(request), request.WorkingDir, request.Env, "")
}

// Run starts the configured process, streams stdout line-by-line through onStdoutLine,
// and returns the full stdout output. stderr is captured separately and discarded; acpx's
// stderr is debug noise (status banners, token footers) and would corrupt structured
// stdout if merged.
func (Runner) Run(
	ctx context.Context,
	request RunRequest,
	onStdoutLine func(line string),
) ([]byte, error) {
	command := request.Command
	if command == "" {
		command = "acpx"
	}

	if strings.TrimSpace(request.Agent) != "" {
		if err := ensureCompatibleConfig(); err != nil {
			return nil, err
		}
		if err := (Runner{}).Ensure(ctx, request); err != nil {
			return nil, fmt.Errorf("ensure acpx session: %w", err)
		}
		output, err := runStreamingCommand(ctx, command, buildPromptArgs(request), request.WorkingDir, request.Env, request.Stdin, onStdoutLine)
		if err == nil || request.Session == "" || !isMissingACPMetadataError(err) {
			return output, err
		}
		if newErr := runCommand(ctx, command, buildSessionNewArgs(request), request.WorkingDir, request.Env, ""); newErr != nil {
			return output, fmt.Errorf("%w; recreate acpx session after missing ACP metadata: %v", err, newErr)
		}
		return runStreamingCommand(ctx, command, buildPromptArgs(request), request.WorkingDir, request.Env, request.Stdin, onStdoutLine)
	}

	return runStreamingCommand(ctx, command, request.Args, request.WorkingDir, request.Env, request.Stdin, onStdoutLine)
}

func ensureCompatibleConfig() error {
	path := strings.TrimSpace(os.Getenv("ACPX_CONFIG_PATH"))
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("resolve ACPX config path: %w", err)
		}
		path = filepath.Join(home, ".acpx", "config.json")
	}

	config := map[string]any{}
	if bytes, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(bytes, &config); err != nil {
			return fmt.Errorf("decode ACPX config %s: %w", path, err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("read ACPX config %s: %w", path, err)
	}

	if config["nonInteractivePermissions"] == "deny" || config["nonInteractivePermissions"] == "fail" {
		return nil
	}
	config["nonInteractivePermissions"] = "deny"

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create ACPX config dir: %w", err)
	}
	bytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode ACPX config: %w", err)
	}
	bytes = append(bytes, '\n')
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		return fmt.Errorf("write ACPX config %s: %w", path, err)
	}
	return nil
}

func buildEnsureArgs(request RunRequest) []string {
	args := append([]string{}, request.Args...)
	if request.WorkingDir != "" {
		args = append(args, "--cwd", request.WorkingDir)
	}
	args = append(args, request.Agent, "sessions", "ensure")
	if request.Session != "" {
		args = append(args, "--name", request.Session)
	}
	return args
}

func buildSessionNewArgs(request RunRequest) []string {
	args := append([]string{}, request.Args...)
	if request.WorkingDir != "" {
		args = append(args, "--cwd", request.WorkingDir)
	}
	args = append(args, request.Agent, "sessions", "new")
	if request.Session != "" {
		args = append(args, "--name", request.Session)
	}
	return args
}

func isMissingACPMetadataError(err error) bool {
	message := err.Error()
	return strings.Contains(message, "ACP_SESSION_INIT_FAILED") &&
		strings.Contains(message, "ACP metadata is missing")
}

func buildPromptArgs(request RunRequest) []string {
	args := append([]string{}, request.Args...)
	// JSON output: one raw ACP JSON-RPC message per line. Lets the control plane
	// forward structured session/update notifications (tool_call, agent_message_chunk,
	// agent_thought_chunk, plan, usage_update) instead of flattened text.
	args = append(args, "--format", "json", "--json-strict")
	if request.WorkingDir != "" {
		args = append(args, "--cwd", request.WorkingDir)
	}
	args = append(args, request.Agent)
	if request.Session != "" {
		args = append(args, "--session", request.Session)
	}
	return args
}

func runCommand(
	ctx context.Context,
	command string,
	args []string,
	workingDir string,
	env []string,
	stdinText string,
) error {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workingDir
	cmd.Env = append(cmd.Environ(), env...)
	if stdinText != "" {
		cmd.Stdin = strings.NewReader(stdinText)
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func runStreamingCommand(
	ctx context.Context,
	command string,
	args []string,
	workingDir string,
	env []string,
	stdinText string,
	onStdoutLine func(line string),
) ([]byte, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workingDir
	cmd.Env = append(cmd.Environ(), env...)

	var (
		stdoutBuf bytes.Buffer
		stderrBuf bytes.Buffer
	)
	stdoutWriter := &lineStreamingWriter{
		output:       &stdoutBuf,
		onStdoutLine: onStdoutLine,
	}
	cmd.Stdout = stdoutWriter
	cmd.Stderr = &stderrBuf

	if stdinText != "" {
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return nil, fmt.Errorf("open stdin pipe: %w", err)
		}
		go func() {
			defer stdin.Close()
			_, _ = io.WriteString(stdin, stdinText)
		}()
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start acpx: %w", err)
	}

	err := cmd.Wait()
	stdoutWriter.Flush()
	output := append([]byte(nil), stdoutBuf.Bytes()...)
	if err != nil {
		if stderrText := strings.TrimSpace(stderrBuf.String()); stderrText != "" {
			return output, fmt.Errorf("run acpx: %w: %s", err, stderrText)
		}
		return output, fmt.Errorf("run acpx: %w", err)
	}
	return output, nil
}

type lineStreamingWriter struct {
	mu           sync.Mutex
	output       *bytes.Buffer
	pending      []byte
	onStdoutLine func(line string)
}

func (writer *lineStreamingWriter) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	written := len(chunk)
	if _, err := writer.output.Write(chunk); err != nil {
		return 0, err
	}

	for len(chunk) > 0 {
		index := bytes.IndexByte(chunk, '\n')
		if index == -1 {
			writer.pending = append(writer.pending, chunk...)
			break
		}
		line := append(writer.pending, chunk[:index]...)
		writer.pending = writer.pending[:0]
		writer.emitLocked(line)
		chunk = chunk[index+1:]
	}

	return written, nil
}

func (writer *lineStreamingWriter) Flush() {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	if len(writer.pending) == 0 {
		return
	}
	writer.emitLocked(writer.pending)
	writer.pending = nil
}

func (writer *lineStreamingWriter) emitLocked(line []byte) {
	if writer.onStdoutLine == nil {
		return
	}
	writer.onStdoutLine(string(line))
}
