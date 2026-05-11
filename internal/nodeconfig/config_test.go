package nodeconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "agents.json")
	if err := os.WriteFile(path, []byte(`{
		"nodeName": "demo-node",
		"agents": [
			{
				"id": "agent-1",
				"name": "Planner",
				"acpxAgent": "planner",
				"command": "acpx",
				"args": ["run"]
			}
		]
	}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	file, err := Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if file.NodeName != "demo-node" {
		t.Fatalf("unexpected node name: %s", file.NodeName)
	}
	if len(file.Agents) != 1 {
		t.Fatalf("unexpected agents length: %d", len(file.Agents))
	}
}
