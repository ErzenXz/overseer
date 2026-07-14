package updater

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsNewer(t *testing.T) {
	tests := []struct {
		candidate string
		current   string
		want      bool
	}{
		{"v1.2.4", "v1.2.3", true},
		{"v2.0.0", "v1.99.99", true},
		{"v1.2.3", "v1.2.3", false},
		{"v1.2.2", "v1.2.3", false},
		{"v1.2.3", "development", true},
		{"v1.2.3-beta.1", "v1.2.2", false},
		{"latest", "v1.2.2", false},
	}
	for _, tt := range tests {
		if got := IsNewer(tt.candidate, tt.current); got != tt.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", tt.candidate, tt.current, got, tt.want)
		}
	}
}

func TestLatestSelectsPlatformAssetAndChecksums(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/acme/overseer/releases/latest" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"tag_name":"v1.4.0","draft":false,"prerelease":false,"assets":[{"name":"overseer_linux_arm64","browser_download_url":"https://downloads/binary"},{"name":"checksums.txt","browser_download_url":"https://downloads/checksums"}]}`)
	}))
	defer server.Close()
	oldBase := githubAPIBase
	githubAPIBase = server.URL
	defer func() { githubAPIBase = oldBase }()

	release, err := Latest(context.Background(), "acme/overseer", "linux", "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if release.Version != "v1.4.0" || release.AssetURL != "https://downloads/binary" || release.ChecksumsURL != "https://downloads/checksums" {
		t.Fatalf("unexpected release: %#v", release)
	}
}

func TestLatestRejectsReleaseWithoutChecksums(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"tag_name":"v1.4.0","assets":[{"name":"overseer_linux_amd64","browser_download_url":"https://downloads/binary"}]}`)
	}))
	defer server.Close()
	oldBase := githubAPIBase
	githubAPIBase = server.URL
	defer func() { githubAPIBase = oldBase }()

	if _, err := Latest(context.Background(), "acme/overseer", "linux", "amd64"); err == nil {
		t.Fatal("expected a release without checksums.txt to be rejected")
	}
}
