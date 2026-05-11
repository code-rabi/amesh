package acpx

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
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
		if err := runCommand(ctx, command, buildEnsureArgs(request), request.WorkingDir, request.Env, ""); err != nil {
			return nil, fmt.Errorf("ensure acpx session: %w", err)
		}
		return runStreamingCommand(ctx, command, buildPromptArgs(request), request.WorkingDir, request.Env, request.Stdin, onStdoutLine)
	}

	return runStreamingCommand(ctx, command, request.Args, request.WorkingDir, request.Env, request.Stdin, onStdoutLine)
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
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("open stderr pipe: %w", err)
	}

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

	var (
		stdoutBuf bytes.Buffer
		mu        sync.Mutex
		wg        sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
		for scanner.Scan() {
			line := scanner.Bytes()
			mu.Lock()
			stdoutBuf.Write(line)
			stdoutBuf.WriteByte('\n')
			mu.Unlock()
			if onStdoutLine != nil {
				onStdoutLine(string(line))
			}
		}
	}()
	go func() {
		defer wg.Done()
		// Drain stderr so the child process never blocks on a full pipe.
		// We intentionally discard the contents: acpx stderr is operator noise
		// (banners, [acpx] tokens summary, http debug) and never carries protocol
		// state. Surfacing it would let it leak into chat transcripts again.
		_, _ = io.Copy(io.Discard, stderr)
	}()

	err = cmd.Wait()
	wg.Wait()
	output := stdoutBuf.Bytes()
	if err != nil {
		return output, fmt.Errorf("run acpx: %w", err)
	}
	return output, nil
}
