package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExpandHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for in, want := range map[string]string{
		"~":                   home,
		"~/.overseer/uploads": filepath.Join(home, ".overseer", "uploads"),
		"/abs/path":           "/abs/path",
		"rel/path":            "rel/path",
		"~other/path":         "~other/path",
	} {
		if got := expandHome(in); got != want {
			t.Errorf("expandHome(%q) = %q, want %q", in, got, want)
		}
	}
}

// Attached images from a session without a folder are addressed as ~/…
func TestLoadPromptImagesExpandsHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, ".overseer", "uploads")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "a.png"), []byte("png"), 0o644)
	imgs, err := loadPromptImages(home, []string{"~/.overseer/uploads/a.png"})
	if err != nil || len(imgs) != 1 || imgs[0].Mime != "image/png" {
		t.Fatalf("got %v %v", imgs, err)
	}
}
