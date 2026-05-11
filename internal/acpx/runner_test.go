package acpx

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRunnerStreamsStdoutLineByLine(t *testing.T) {
	t.Parallel()

	var lines []string
	command, args := helperCommand(t, "emit-lines")
	output, err := (Runner{}).Run(context.Background(), RunRequest{
		Command: command,
		Args:    args,
		Env:     []string{"GO_WANT_HELPER_PROCESS=1"},
	}, func(line string) {
		lines = append(lines, line)
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if got := string(output); !strings.Contains(got, "one") || !strings.Contains(got, "two") {
		t.Fatalf("stdout missing lines: %q", got)
	}
	if strings.Contains(string(output), "noise") {
		t.Fatalf("stderr leaked into stdout output: %q", output)
	}
	if len(lines) != 2 || lines[0] != "one" || lines[1] != "two" {
		t.Fatalf("expected line-by-line stdout, got %q", lines)
	}
}

func TestRunnerCancelsProcess(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	command, args := helperCommand(t, "sleep")
	_, err := (Runner{}).Run(ctx, RunRequest{
		Command: command,
		Args:    args,
		Env:     []string{"GO_WANT_HELPER_PROCESS=1"},
	}, nil)
	if err == nil {
		t.Fatalf("expected cancellation error")
	}
}

func TestRunnerHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	mode := ""
	for index, arg := range os.Args {
		if arg == "--" && index+1 < len(os.Args) {
			mode = os.Args[index+1]
			break
		}
	}

	switch mode {
	case "emit-lines":
		fmt.Fprintln(os.Stdout, "one")
		fmt.Fprintln(os.Stdout, "two")
		fmt.Fprintln(os.Stderr, "noise")
		os.Exit(0)
	case "sleep":
		time.Sleep(5 * time.Second)
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q", mode)
		os.Exit(2)
	}
}

func helperCommand(t *testing.T, mode string) (string, []string) {
	t.Helper()

	return os.Args[0], []string{"-test.run=TestRunnerHelperProcess", "--", mode}
}
