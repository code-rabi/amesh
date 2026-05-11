package nodestate

import (
	"encoding/json"
	"fmt"
	"os"
)

// File stores durable node credentials between register and run commands.
type File struct {
	NodeID         string `json:"nodeId"`
	ReconnectToken string `json:"reconnectToken"`
	ServerURL      string `json:"serverUrl"`
	ConfigPath     string `json:"configPath"`
}

// Load reads the durable node state file from disk.
func Load(path string) (File, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return File{}, fmt.Errorf("read node state %s: %w", path, err)
	}

	var file File
	if err := json.Unmarshal(bytes, &file); err != nil {
		return File{}, fmt.Errorf("decode node state %s: %w", path, err)
	}
	return file, nil
}

// Save writes the durable node state file to disk.
func Save(path string, file File) error {
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return fmt.Errorf("encode node state %s: %w", path, err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		return fmt.Errorf("write node state %s: %w", path, err)
	}
	return nil
}
