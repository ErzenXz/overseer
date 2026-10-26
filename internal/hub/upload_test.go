package hub

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// TestFsUpload covers the composer's attachment path: folders that don't
// exist yet, "~", the resolved path in the reply, and bad names.
func TestFsUpload(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, err := srv.store.CreateApiToken("upload-test")
	if err != nil {
		t.Fatal(err)
	}

	upload := func(dir, name, body string) (int, map[string]string) {
		t.Helper()
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		part, _ := mw.CreateFormFile("file", name)
		part.Write([]byte(body))
		mw.Close()
		req, _ := http.NewRequest("POST", base+"/api/devices/"+deviceId+"/fs/upload?dir="+url.QueryEscape(dir), &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]string
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	t.Run("creates the folder", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "proj", ".overseer", "uploads")
		code, out := upload(dir, "shot.png", "png-bytes")
		if code != 200 || out["path"] != filepath.Join(dir, "shot.png") {
			t.Fatalf("got %d %v", code, out)
		}
		got, err := os.ReadFile(out["path"])
		if err != nil || string(got) != "png-bytes" {
			t.Fatalf("file on disk: %q %v", got, err)
		}
		// Attachments stay out of the project's git status.
		if _, err := os.Stat(filepath.Join(dir, "..", ".gitignore")); err != nil {
			t.Errorf("missing .overseer/.gitignore: %v", err)
		}
	})

	t.Run("expands ~ and returns the real path", func(t *testing.T) {
		code, out := upload("~/.overseer/uploads", "notes.txt", "hi")
		want := filepath.Join(home, ".overseer", "uploads", "notes.txt")
		if code != 200 || out["path"] != want {
			t.Fatalf("got %d %v, want path %s", code, out, want)
		}
		if _, err := os.Stat(want); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("reports a folder that cannot be created", func(t *testing.T) {
		blocker := filepath.Join(t.TempDir(), "file")
		os.WriteFile(blocker, []byte("x"), 0o644)
		code, out := upload(filepath.Join(blocker, "sub"), "a.txt", "x")
		if code != http.StatusBadGateway || out["error"] == "" {
			t.Fatalf("got %d %v, want 502 with an error", code, out)
		}
	})

	t.Run("rejects bad names", func(t *testing.T) {
		for _, name := range []string{"..", "."} {
			if code, _ := upload(t.TempDir(), name, "x"); code != http.StatusBadRequest {
				t.Errorf("%q: got %d, want 400", name, code)
			}
		}
	})
}
