package acpconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAliasResolvesPasswordEnv(t *testing.T) {
	t.Setenv("AMESH_TEST_PASSWORD", "secret")
	dir := t.TempDir()
	path := filepath.Join(dir, "acp.json")
	if err := os.WriteFile(path, []byte(`{
  "aliases": {
    "mesh-reviewer": {
      "serverUrl": "http://127.0.0.1:3001",
      "agentId": "agent-reviewer",
      "passwordEnv": "AMESH_TEST_PASSWORD"
    }
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	alias, err := LoadAlias(path, "mesh-reviewer")
	if err != nil {
		t.Fatalf("LoadAlias() error = %v", err)
	}
	if alias.Password != "secret" {
		t.Fatalf("alias.Password = %q, want %q", alias.Password, "secret")
	}
}
