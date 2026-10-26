package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/updater"
)

func TestUpdatePreferencePersists(t *testing.T) {
	t.Setenv("OVERSEER_MANAGED", "")
	store, err := OpenStore(t.TempDir() + "/overseer.db")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	manager := newUpdateManager(store, "v1.0.0", "acme/overseer")
	if !manager.snapshot().AutoUpdate {
		t.Fatal("auto-update should default to enabled")
	}
	if err := manager.setAuto(false); err != nil {
		t.Fatal(err)
	}
	reloaded := newUpdateManager(store, "v1.0.0", "acme/overseer")
	status := reloaded.snapshot()
	if status.AutoUpdate {
		t.Fatal("disabled auto-update preference was not persisted")
	}
	if status.Managed {
		t.Fatal("standalone test process should not be reported as managed")
	}
}

func TestUpdateNotesSplitsNewerAndCurrent(t *testing.T) {
	t.Setenv("OVERSEER_MANAGED", "")
	store, err := OpenStore(t.TempDir() + "/overseer.db")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	entries := []updater.Entry{
		{Version: "v0.5.0", Groups: []updater.Group{}},
		{Version: "v0.4.1", Groups: []updater.Group{}},
		{Version: "v0.4.0", Groups: []updater.Group{}},
		{Version: "v0.3.0", Groups: []updater.Group{}},
	}
	fetches := 0
	manager := newUpdateManager(store, "v0.4.0", "acme/overseer")
	manager.fetchNotes = func(_ context.Context, repo, tag string) ([]updater.Entry, error) {
		fetches++
		if repo != "acme/overseer" || tag != "v0.5.0" {
			t.Errorf("fetched %s@%s", repo, tag)
		}
		return entries, nil
	}
	manager.status.LatestVersion = "v0.5.0"

	for i := 0; i < 3; i++ { // later calls come from the cache
		got := manager.notes(context.Background())
		if len(got.Newer) != 2 || got.Newer[0].Version != "v0.5.0" || got.Newer[1].Version != "v0.4.1" {
			t.Fatalf("newer = %+v", got.Newer)
		}
		if got.Current == nil || got.Current.Version != "v0.4.0" {
			t.Fatalf("current = %+v", got.Current)
		}
	}
	if fetches != 1 {
		t.Errorf("fetched %d times, want 1", fetches)
	}
}

func TestUpdateNotesRetriesFailuresLaterAndSkipsDevBuilds(t *testing.T) {
	t.Setenv("OVERSEER_MANAGED", "")
	store, err := OpenStore(t.TempDir() + "/overseer.db")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	fetches := 0
	manager := newUpdateManager(store, "v0.4.0", "acme/overseer")
	manager.fetchNotes = func(context.Context, string, string) ([]updater.Entry, error) {
		fetches++
		return nil, errors.New("offline")
	}
	manager.status.LatestVersion = "v0.5.0"
	for i := 0; i < 3; i++ {
		if got := manager.notes(context.Background()); len(got.Newer) != 0 || got.Current != nil {
			t.Fatalf("expected empty notes, got %+v", got)
		}
	}
	if fetches != 1 {
		t.Errorf("failed fetch repeated %d times within the retry window", fetches)
	}
	manager.notesFail = time.Now().Add(-2 * notesRetry)
	manager.notes(context.Background())
	if fetches != 2 {
		t.Errorf("fetches = %d after the retry window, want 2", fetches)
	}

	dev := newUpdateManager(store, "0.1.0-dev", "acme/overseer")
	dev.fetchNotes = func(context.Context, string, string) ([]updater.Entry, error) {
		t.Fatal("dev builds must not fetch notes")
		return nil, nil
	}
	dev.status.LatestVersion = "v0.5.0"
	if got := dev.notes(context.Background()); len(got.Newer) != 0 || got.Current != nil {
		t.Fatalf("dev notes = %+v", got)
	}
}

func TestUpdateNotesEndpoint(t *testing.T) {
	srv := newTestServer(t, "v0.4.0")
	srv.updates.fetchNotes = func(context.Context, string, string) ([]updater.Entry, error) {
		return []updater.Entry{{Version: "v0.5.0", Date: "2026-10-27", Intro: "Hi.", Groups: []updater.Group{{Title: "New", Items: []string{"**A.** b"}}}}}, nil
	}
	srv.updates.status.LatestVersion = "v0.5.0"
	w := httptest.NewRecorder()
	srv.handleUpdateNotes(w, httptest.NewRequest("GET", "/api/updates/notes", nil))
	var body struct {
		CurrentVersion string `json:"currentVersion"`
		Newer          []struct {
			Version string `json:"version"`
			Groups  []struct {
				Title string   `json:"title"`
				Items []string `json:"items"`
			} `json:"groups"`
		} `json:"newer"`
		Current *struct{} `json:"current"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.CurrentVersion != "v0.4.0" || len(body.Newer) != 1 || body.Newer[0].Groups[0].Items[0] != "**A.** b" || body.Current != nil {
		t.Errorf("body = %s", w.Body.String())
	}
}
