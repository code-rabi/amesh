package acpx

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRunnerStreamsOutput(t *testing.T) {
	t.Parallel()

	var chunks []string
	output, err := (Runner{}).Run(context.Background(), RunRequest{
		Command: "sh",
		Args: []string{
			"-c",
			"printf 'hello'; printf ' world' >&2",
		},
	}, func(text string) {
		chunks = append(chunks, text)
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if got := string(output); !strings.Contains(got, "hello") || !strings.Contains(got, "world") {
		t.Fatalf("unexpected output: %q", got)
	}
	if len(chunks) == 0 {
		t.Fatalf("expected streamed chunks")
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
