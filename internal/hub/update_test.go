package hub

import "testing"

func TestUpdatePreferencePersists(t *testing.T) {
	t.Setenv("OVERSEER_MANAGED", "")
	store, err := OpenStore(t.TempDir() + "/overseer.db")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	manager := newUpdateManager(store, "v1.0.0", "acme/overseer")
	if !manager.snapshot(t.Context()).AutoUpdate {
		t.Fatal("auto-update should default to enabled")
	}
	if err := manager.setAuto(false); err != nil {
		t.Fatal(err)
	}
	reloaded := newUpdateManager(store, "v1.0.0", "acme/overseer")
	status := reloaded.snapshot(t.Context())
	if status.AutoUpdate {
		t.Fatal("disabled auto-update preference was not persisted")
	}
	if status.Managed {
		t.Fatal("standalone test process should not be reported as managed")
	}
}
