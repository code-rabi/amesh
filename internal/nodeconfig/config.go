package nodeconfig

import (
	"encoding/json"
	"fmt"
	"os"
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
		if agent.Command == "" {
			file.Agents[index].Command = "acpx"
		}
	}

	return file, nil
}
