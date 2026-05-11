package acpx

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"sync"
)

// RunRequest describes one acpx process invocation.
type RunRequest struct {
	Command   string
	Args      []string
	WorkingDir string
	Env       []string
	Stdin     string
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

	cmd := exec.CommandContext(ctx, command, request.Args...)
	cmd.Dir = request.WorkingDir
	cmd.Env = append(cmd.Environ(), request.Env...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("open stderr pipe: %w", err)
	}

	if request.Stdin != "" {
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return nil, fmt.Errorf("open stdin pipe: %w", err)
		}
		go func() {
			defer stdin.Close()
			_, _ = io.WriteString(stdin, request.Stdin)
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
