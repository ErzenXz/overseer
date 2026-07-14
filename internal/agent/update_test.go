package agent

import (
	"context"
	"os"
	"testing"
)

func TestMaybeSelfUpdateGating(t *testing.T) {
	a := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")

	// Not managed: never updates, regardless of version.
	os.Unsetenv(managedEnv)
	if a.maybeSelfUpdate(context.Background(), "v9.9.9", "ErzenXz/overseer") {
		t.Error("should not self-update when not managed")
	}

	os.Setenv(managedEnv, "1")
	defer os.Unsetenv(managedEnv)

	// Same version: no update.
	a2 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a2.maybeSelfUpdate(context.Background(), "v0.1.0", "ErzenXz/overseer") {
		t.Error("should not update to the same version")
	}

	// Dev/untagged hub version: skip to avoid update loops.
	a3 := New(Config{HubURL: "http://127.0.0.1:1"}, "0.1.0-dev")
	if a3.maybeSelfUpdate(context.Background(), "abc123-dirty", "ErzenXz/overseer") {
		t.Error("should not update to a non-tagged version")
	}

	// Empty hub version: no update.
	a4 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a4.maybeSelfUpdate(context.Background(), "", "ErzenXz/overseer") {
		t.Error("should not update when hub reports no version")
	}

	// Missing repository metadata never attempts an update.
	a5 := New(Config{HubURL: "http://127.0.0.1:1"}, "v0.1.0")
	if a5.maybeSelfUpdate(context.Background(), "v0.2.0", "") {
		t.Error("should not update without trusted repository metadata")
	}
}
