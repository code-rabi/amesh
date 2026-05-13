package acpx

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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

func TestRunnerRecreatesSessionWhenACPMetadataIsMissing(t *testing.T) {
	t.Parallel()

	statePath := filepath.Join(t.TempDir(), "state")
	command, args := helperCommand(t, "recover-missing-acp-metadata")
	if err := (Runner{}).Ensure(context.Background(), RunRequest{
		Command: command,
		Args:    args,
		Agent:   "openclaw",
		Session: "agent-main-acp-55f0c666",
		Env: []string{
			"GO_WANT_HELPER_PROCESS=1",
			"ACP_METADATA_RECOVERY_STATE=" + statePath,
		},
	}); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	bytes, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(string(bytes)), "ensure\nnew\nensure"; got != want {
		t.Fatalf("commands = %q, want %q", got, want)
	}
}

func TestRunnerRecreatesSessionWhenOpenClawPromptACPMetadataIsMissing(t *testing.T) {
	t.Parallel()

	statePath := filepath.Join(t.TempDir(), "state")
	command, args := helperCommand(t, "recover-openclaw-prompt-missing-acp-metadata")
	output, err := (Runner{}).Run(context.Background(), RunRequest{
		Command: command,
		Args:    args,
		Agent:   "openclaw",
		Session: "agent-main-acp-d9d29d47",
		Stdin:   "review this",
		Env: []string{
			"GO_WANT_HELPER_PROCESS=1",
			"ACP_METADATA_RECOVERY_STATE=" + statePath,
		},
	}, nil)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(string(output), "prompt-ok") {
		t.Fatalf("output = %q, want prompt-ok", output)
	}

	bytes, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(string(bytes)), "ensure\nprompt\nnew\nprompt"; got != want {
		t.Fatalf("commands = %q, want %q", got, want)
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

func TestRunnerNormalizesInvalidNonInteractivePermissions(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("ACPX_CONFIG_PATH", "")
	configPath := filepath.Join(home, ".acpx", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`{"nonInteractivePermissions":"approve-all","theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	command, args := helperCommand(t, "ok")
	if err := (Runner{}).Ensure(context.Background(), RunRequest{
		Command: command,
		Args:    args,
		Agent:   "codex",
		Env:     []string{"GO_WANT_HELPER_PROCESS=1"},
	}); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	bytes, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(bytes, &config); err != nil {
		t.Fatal(err)
	}
	if config["nonInteractivePermissions"] != "deny" {
		t.Fatalf("nonInteractivePermissions = %q, want deny", config["nonInteractivePermissions"])
	}
	if config["theme"] != "dark" {
		t.Fatalf("theme = %q, want dark", config["theme"])
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
	case "ok":
		os.Exit(0)
	case "emit-lines":
		fmt.Fprintln(os.Stdout, "one")
		fmt.Fprintln(os.Stdout, "two")
		fmt.Fprintln(os.Stderr, "noise")
		os.Exit(0)
	case "sleep":
		time.Sleep(5 * time.Second)
		os.Exit(0)
	case "recover-missing-acp-metadata":
		helperRecoverMissingACPMetadata()
	case "recover-openclaw-prompt-missing-acp-metadata":
		helperRecoverOpenClawPromptMissingACPMetadata()
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q", mode)
		os.Exit(2)
	}
}

func helperRecoverMissingACPMetadata() {
	statePath := os.Getenv("ACP_METADATA_RECOVERY_STATE")
	if statePath == "" {
		fmt.Fprintln(os.Stderr, "missing ACP_METADATA_RECOVERY_STATE")
		os.Exit(2)
	}

	args := os.Args
	command := ""
	for index := 0; index+2 < len(args); index++ {
		if args[index] == "openclaw" && args[index+1] == "sessions" {
			command = args[index+2]
			break
		}
	}
	if command == "" {
		fmt.Fprintf(os.Stderr, "missing sessions command in %q", args)
		os.Exit(2)
	}

	previous, _ := os.ReadFile(statePath)
	if err := os.WriteFile(statePath, append(previous, []byte(command+"\n")...), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write state: %v", err)
		os.Exit(2)
	}

	if command == "ensure" && !strings.Contains(string(previous), "new\n") {
		fmt.Fprintln(os.Stderr, "ACP error (ACP_SESSION_INIT_FAILED): ACP metadata is missing for agent:main:acp:55f0c666-f57c-4198-a9e3-ac9954d8cf43. Recreate this ACP session with /acp spawn and rebind the thread.")
		os.Exit(1)
	}
	os.Exit(0)
}

func helperRecoverOpenClawPromptMissingACPMetadata() {
	statePath := os.Getenv("ACP_METADATA_RECOVERY_STATE")
	if statePath == "" {
		fmt.Fprintln(os.Stderr, "missing ACP_METADATA_RECOVERY_STATE")
		os.Exit(2)
	}

	args := os.Args
	command := ""
	for index := 0; index+2 < len(args); index++ {
		if args[index] != "openclaw" {
			continue
		}
		switch {
		case args[index+1] == "sessions":
			command = args[index+2]
		case args[index+1] == "--session" || (index+2 < len(args) && args[index+1] == "agent-main-acp-d9d29d47"):
			command = "prompt"
		default:
			command = "prompt"
		}
		break
	}
	if command == "" {
		fmt.Fprintf(os.Stderr, "missing openclaw command in %q", args)
		os.Exit(2)
	}

	previous, _ := os.ReadFile(statePath)
	if err := os.WriteFile(statePath, append(previous, []byte(command+"\n")...), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write state: %v", err)
		os.Exit(2)
	}

	if command == "prompt" && !strings.Contains(string(previous), "new\n") {
		fmt.Fprintln(os.Stderr, "ACP error (ACP_SESSION_INIT_FAILED): ACP metadata is missing for agent:main:acp:d9d29d47-c7c5-40d0-9773-e464d4430352. Recreate this ACP session with /acp spawn and rebind the thread. next: If this session is stale, recreate it with /acp spawn and rebind the thread.")
		os.Exit(1)
	}
	if command == "prompt" {
		fmt.Fprintln(os.Stdout, "prompt-ok")
	}
	os.Exit(0)
}

func helperCommand(t *testing.T, mode string) (string, []string) {
	t.Helper()

	return os.Args[0], []string{"-test.run=TestRunnerHelperProcess", "--", mode}
}
