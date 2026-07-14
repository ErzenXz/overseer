package hub

import "testing"

func TestSetupCatalogueHasCrossPlatformCommands(t *testing.T) {
	want := map[string]bool{"node": true, "codex": true, "claude": true, "gemini": true, "tailscale": true}
	for _, spec := range setupSpecs {
		if !want[spec.id] {
			t.Fatalf("unexpected setup tool %q", spec.id)
		}
		delete(want, spec.id)
		if spec.name == "" || spec.binary == "" || spec.installUnix == "" || spec.installWindows == "" || spec.docsURL == "" {
			t.Errorf("setup tool %q is missing required cross-platform metadata", spec.id)
		}
	}
	for id := range want {
		t.Errorf("setup tool %q is missing", id)
	}
}

func TestAgentLoginCommandsPreferRemoteFriendlyFlows(t *testing.T) {
	for _, spec := range setupSpecs {
		switch spec.id {
		case "codex":
			if spec.authUnix != "codex login --device-auth" || spec.authWindows != "codex login --device-auth" {
				t.Error("Codex should use device-code login on remote machines")
			}
		case "claude", "gemini", "tailscale":
			if spec.authUnix == "" || spec.authWindows == "" {
				t.Errorf("%s should have a login/connect command on both platforms", spec.id)
			}
		}
	}
}
