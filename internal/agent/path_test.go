package agent

import (
	"path/filepath"
	"testing"
)

func TestManagedPathEntriesWithoutHomeNeverReturnsRelativePaths(t *testing.T) {
	if paths := managedPathEntries("windows", "", ""); len(paths) != 0 {
		t.Fatalf("Windows without an absolute base should add no PATH entries: %#v", paths)
	}
	if paths := managedPathEntries("windows", "", ".overseer"); len(paths) != 0 {
		t.Fatalf("Windows with a relative base should add no PATH entries: %#v", paths)
	}
	for _, path := range managedPathEntries("linux", "", "") {
		if !filepath.IsAbs(path) {
			t.Fatalf("managed PATH entry must be absolute: %q", path)
		}
	}
}
