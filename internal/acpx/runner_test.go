package acpx

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRunnerStreamsStdoutLineByLine(t *testing.T) {
	t.Parallel()

	var lines []string
	output, err := (Runner{}).Run(context.Background(), RunRequest{
		Command: "sh",
		Args: []string{
			"-c",
			"printf 'one\\n'; printf 'two\\n'; printf 'noise\\n' >&2",
		},
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

	_, err := (Runner{}).Run(ctx, RunRequest{
		Command: "sh",
		Args: []string{
			"-c",
			"sleep 5",
		},
	}, nil)
	if err == nil {
		t.Fatalf("expected cancellation error")
	}
}
