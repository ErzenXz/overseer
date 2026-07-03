package agent

import (
	"os"
	"testing"
)

func TestMaybeSelfUpdateGating(t *testing.T) {
	a := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")

	// Not managed: never updates, regardless of version.
	os.Unsetenv(managedEnv)
	if a.maybeSelfUpdate("v9.9.9") {
		t.Error("should not self-update when not managed")
	}

	os.Setenv(managedEnv, "1")
	defer os.Unsetenv(managedEnv)

	// Same version: no update.
	a2 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a2.maybeSelfUpdate("v0.1.0") {
		t.Error("should not update to the same version")
	}

	// Dev/untagged hub version: skip to avoid update loops.
	a3 := New(Config{HubURL: "http://127.0.0.1:1"}, "0.1.0-dev")
	if a3.maybeSelfUpdate("abc123-dirty") {
		t.Error("should not update to a non-tagged version")
	}

	// Empty hub version: no update.
	a4 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a4.maybeSelfUpdate("") {
		t.Error("should not update when hub reports no version")
	}

	// Tagged, newer, managed, but hub unreachable: attempts, download fails,
	// returns false (agent keeps running on the current binary).
	a5 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a5.maybeSelfUpdate("v0.2.0") {
		t.Error("failed download should not report a successful update")
	}
	// Second call is a no-op this process lifetime (triedUpdate latch).
	if a5.maybeSelfUpdate("v0.2.0") {
		t.Error("should only attempt update once per process")
	}
}
