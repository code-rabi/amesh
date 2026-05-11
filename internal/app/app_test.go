package app

import (
	"slices"
	"testing"
)

func TestEnvList(t *testing.T) {
	t.Parallel()

	got := envList(map[string]string{
		"BETA":  "two",
		"ALPHA": "one",
	})

	want := []string{"ALPHA=one", "BETA=two"}
	if !slices.Equal(got, want) {
		t.Fatalf("envList() = %v, want %v", got, want)
	}
}
