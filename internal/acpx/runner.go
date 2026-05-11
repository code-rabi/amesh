package acpx

import (
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

// Run starts the configured process, streams output chunks as they arrive, and returns the full output.
func (Runner) Run(
	ctx context.Context,
	request RunRequest,
	onChunk func(text string),
) ([]byte, error) {
	command := request.Command
	if command == "" {
		command = "acpx"
	}

	if strings.TrimSpace(request.Agent) != "" {
		if err := runCommand(ctx, command, buildEnsureArgs(request), request.WorkingDir, request.Env, ""); err != nil {
			return nil, fmt.Errorf("ensure acpx session: %w", err)
		}
		return runStreamingCommand(ctx, command, buildPromptArgs(request), request.WorkingDir, request.Env, request.Stdin, onChunk)
	}

	return runStreamingCommand(ctx, command, request.Args, request.WorkingDir, request.Env, request.Stdin, onChunk)
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
	args = append(args, "--format", "quiet")
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
	onChunk func(text string),
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
		buffer bytes.Buffer
		mu     sync.Mutex
		wg     sync.WaitGroup
	)
	collect := func(reader io.Reader) {
		defer wg.Done()
		chunk := make([]byte, 1024)
		for {
			n, err := reader.Read(chunk)
			if n > 0 {
				text := string(chunk[:n])
				mu.Lock()
				buffer.WriteString(text)
				mu.Unlock()
				if onChunk != nil {
					onChunk(text)
				}
			}
			if err != nil {
				if err == io.EOF {
					return
				}
				return
			}
		}
	}

	wg.Add(2)
	go collect(stdout)
	go collect(stderr)

	err = cmd.Wait()
	wg.Wait()
	output := buffer.Bytes()
	if err != nil {
		return output, fmt.Errorf("run acpx: %w", err)
	}
	return output, nil
}
