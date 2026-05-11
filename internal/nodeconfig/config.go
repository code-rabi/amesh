package nodeconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// AgentConfig describes one local capability exposed by the node daemon.
type AgentConfig struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	ACPXAgent string            `json:"acpxAgent"`
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	CWD       string            `json:"cwd,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Labels    []string          `json:"labels,omitempty"`
}

// File describes the on-disk node daemon capability file.
type File struct {
	NodeName string        `json:"nodeName"`
	Agents   []AgentConfig `json:"agents"`
}

// Load reads and validates the local agent configuration file.
func Load(path string) (File, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return File{}, fmt.Errorf("read config %s: %w", path, err)
	}

	var file File
	if err := json.Unmarshal(bytes, &file); err != nil {
		return File{}, fmt.Errorf("decode config %s: %w", path, err)
	}

	if file.NodeName == "" {
		return File{}, fmt.Errorf("decode config %s: nodeName is required", path)
	}

	for index, agent := range file.Agents {
		if agent.ID == "" || agent.Name == "" || agent.ACPXAgent == "" {
			return File{}, fmt.Errorf("decode config %s: each agent needs id, name, and acpxAgent", path)
		}
		if agent.Command == "" || strings.TrimSpace(agent.Command) == "acpx" {
			file.Agents[index].Command = defaultACPXCommand()
		}
		if slices.Equal(agent.Args, []string{"run"}) {
			file.Agents[index].Args = []string{}
		}
		if file.Agents[index].Args == nil {
			file.Agents[index].Args = []string{}
		}
	}

	return file, nil
}

// Save writes the node daemon capability file to disk.
func Save(path string, file File) error {
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir config dir for %s: %w", path, err)
	}
	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}

func defaultACPXCommand() string {
	if path := strings.TrimSpace(os.Getenv("AMESH_ACPX_PATH")); path != "" {
		return path
	}
	return "acpx"
}
