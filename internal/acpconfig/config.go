package acpconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Alias describes one exported ACP alias served by `amesh acp <alias>`.
type Alias struct {
	Name        string `json:"-"`
	ServerURL   string `json:"serverUrl"`
	AgentID     string `json:"agentId"`
	Password    string `json:"password,omitempty"`
	PasswordEnv string `json:"passwordEnv,omitempty"`
}

// File is the on-disk ACP alias registry.
type File struct {
	Aliases map[string]Alias `json:"aliases"`
}

// DefaultPath returns the default ACP alias config location.
func DefaultPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "acp.json"
	}
	return filepath.Join(home, ".config", "amesh", "acp.json")
}

// LoadAlias loads one alias from the ACP config file and resolves its password.
func LoadAlias(path string, name string) (Alias, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultPath()
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return Alias{}, fmt.Errorf("read ACP config %s: %w", path, err)
	}

	var file File
	if err := json.Unmarshal(bytes, &file); err != nil {
		return Alias{}, fmt.Errorf("decode ACP config %s: %w", path, err)
	}

	alias, ok := file.Aliases[name]
	if !ok {
		return Alias{}, fmt.Errorf("ACP alias %q not found in %s", name, path)
	}
	alias.Name = name

	if strings.TrimSpace(alias.ServerURL) == "" || strings.TrimSpace(alias.AgentID) == "" {
		return Alias{}, fmt.Errorf("ACP alias %q needs serverUrl and agentId", name)
	}

	if value := strings.TrimSpace(alias.Password); value != "" {
		alias.Password = value
		return alias, nil
	}
	if envName := strings.TrimSpace(alias.PasswordEnv); envName != "" {
		value := strings.TrimSpace(os.Getenv(envName))
		if value == "" {
			return Alias{}, fmt.Errorf("ACP alias %q password env %s is empty", name, envName)
		}
		alias.Password = value
		return alias, nil
	}

	for _, envName := range []string{"AUTH_ADMIN_PASSWORD", "AMESH_PASSWORD"} {
		if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
			alias.Password = value
			return alias, nil
		}
	}

	return Alias{}, fmt.Errorf("ACP alias %q has no password, passwordEnv, AUTH_ADMIN_PASSWORD, or AMESH_PASSWORD", name)
}
