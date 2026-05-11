package nodestate

import (
	"path/filepath"
	"testing"
)

func TestSaveAndLoad(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "node-state.json")
	input := File{
		NodeID:         "node-1",
		ReconnectToken: "token-1",
		ServerURL:      "ws://localhost:3001/ws?role=node",
		ConfigPath:     "examples/agents.json",
	}

	if err := Save(path, input); err != nil {
		t.Fatalf("save state: %v", err)
	}

	output, err := Load(path)
	if err != nil {
		t.Fatalf("load state: %v", err)
	}

	if output != input {
		t.Fatalf("unexpected state: %#v", output)
	}
}
