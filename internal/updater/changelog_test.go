package updater

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("testdata/CHANGELOG.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestParseChangelog(t *testing.T) {
	entries := StableEntries(ParseChangelog(fixture(t)))
	if len(entries) != 3 {
		t.Fatalf("got %d stable entries, want 3 (Unreleased and the rc dropped)", len(entries))
	}
	top := entries[0]
	if top.Version != "v0.5.0" || top.Date != "2026-10-27" {
		t.Fatalf("top entry = %q %q", top.Version, top.Date)
	}
	if want := "Pick where a session runs, drop files into the composer, and get told when an agent needs you."; top.Intro != want {
		t.Errorf("intro = %q", top.Intro)
	}
	if len(top.Groups) != 2 || top.Groups[0].Title != "New" || top.Groups[1].Title != "Fixed" {
		t.Fatalf("groups = %+v", top.Groups)
	}
	items := top.Groups[0].Items
	if len(items) != 2 {
		t.Fatalf("items = %q", items)
	}
	if want := "**Where it runs.** A picker for the machine, folder and branch, with [last seen](docs/guide.md#machines) times."; items[0] != want {
		t.Errorf("wrapped bullet = %q", items[0])
	}
	if entries[2].Version != "v0.3.9" || entries[2].Date != "2026-10-01" {
		t.Errorf("plain-hyphen heading = %+v", entries[2])
	}
}

func TestChangelogFetchesFileForTag(t *testing.T) {
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		fmt.Fprint(w, fixture(t))
	}))
	defer server.Close()
	old := rawBase
	rawBase = server.URL
	defer func() { rawBase = old }()

	entries, err := Changelog(context.Background(), "acme/overseer", "v0.5.0")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/acme/overseer/v0.5.0/CHANGELOG.md" {
		t.Errorf("fetched %s", path)
	}
	if len(entries) != 3 || entries[0].Version != "v0.5.0" {
		t.Errorf("entries = %+v", entries)
	}
}

func TestChangelogFallsBackToReleaseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/CHANGELOG.md"):
			http.NotFound(w, r)
		case r.URL.Path == "/repos/acme/overseer/releases/tags/v0.5.0":
			body := "Short intro.\n\n### New\n- **One.** Thing.\n\n---\n\n[Full changelog](https://overseer.sh/changelog/)\n\n## What's Changed\n* auto by @x"
			fmt.Fprintf(w, `{"body":%q,"published_at":"2026-10-27T10:00:00Z"}`, body)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	}))
	defer server.Close()
	oldRaw, oldAPI := rawBase, githubAPIBase
	rawBase, githubAPIBase = server.URL, server.URL
	defer func() { rawBase, githubAPIBase = oldRaw, oldAPI }()

	entries, err := Changelog(context.Background(), "acme/overseer", "v0.5.0")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %+v", entries)
	}
	e := entries[0]
	if e.Version != "v0.5.0" || e.Date != "2026-10-27" || e.Intro != "Short intro." {
		t.Errorf("entry = %+v", e)
	}
	if len(e.Groups) != 1 || len(e.Groups[0].Items) != 1 {
		t.Errorf("groups = %+v", e.Groups)
	}
}

func TestChangelogRejectsNonStableTag(t *testing.T) {
	if _, err := Changelog(context.Background(), "acme/overseer", "0.1.0-dev"); err == nil {
		t.Fatal("expected an error for a dev tag")
	}
}
