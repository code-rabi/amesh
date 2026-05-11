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

func TestLoadUsesManagedACPXPathForDefaultCommand(t *testing.T) {
	t.Setenv("AMESH_ACPX_PATH", "/opt/amesh/acpx/bin/acpx")

	dir := t.TempDir()
	path := filepath.Join(dir, "agents.json")
	if err := os.WriteFile(path, []byte(`{
		"nodeName": "demo-node",
		"agents": [
			{
				"id": "agent-1",
				"name": "Planner",
				"acpxAgent": "planner",
				"args": ["run"]
			},
			{
				"id": "agent-2",
				"name": "Reviewer",
				"acpxAgent": "reviewer",
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

	for _, agent := range file.Agents {
		if agent.Command != "/opt/amesh/acpx/bin/acpx" {
			t.Fatalf("unexpected command for %s: %s", agent.ID, agent.Command)
		}
	}
}
