// Package updater discovers, verifies, installs, and rolls back Overseer
// releases. It is shared by the hub and device agents so every machine uses
// the same conservative update path.
package updater

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const defaultTimeout = 5 * time.Minute

var githubAPIBase = "https://api.github.com"

type Release struct {
	Version      string
	AssetURL     string
	ChecksumsURL string
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

// Latest returns the newest stable release and its platform asset.
func Latest(ctx context.Context, repo, goos, goarch string) (Release, error) {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", githubAPIBase, repo)
	return fetchRelease(ctx, url, goos, goarch)
}

// ForVersion returns a specific stable release and its platform asset.
func ForVersion(ctx context.Context, repo, version, goos, goarch string) (Release, error) {
	if !isStableVersion(version) {
		return Release{}, fmt.Errorf("%q is not a stable release version", version)
	}
	url := fmt.Sprintf("%s/repos/%s/releases/tags/%s", githubAPIBase, repo, version)
	return fetchRelease(ctx, url, goos, goarch)
}

func fetchRelease(ctx context.Context, url, goos, goarch string) (Release, error) {
	asset := fmt.Sprintf("overseer_%s_%s", goos, goarch)
	var release githubRelease
	if err := getJSON(ctx, url, &release); err != nil {
		return Release{}, err
	}
	if release.Draft || release.Prerelease || !isStableVersion(release.TagName) {
		return Release{}, fmt.Errorf("latest release %q is not stable", release.TagName)
	}
	result := Release{Version: release.TagName}
	for _, candidate := range release.Assets {
		switch candidate.Name {
		case asset:
			result.AssetURL = candidate.URL
		case "checksums.txt":
			result.ChecksumsURL = candidate.URL
		}
	}
	if result.AssetURL == "" {
		return Release{}, fmt.Errorf("release %s has no %s asset", result.Version, asset)
	}
	if result.ChecksumsURL == "" {
		return Release{}, fmt.Errorf("release %s has no checksums.txt asset", result.Version)
	}
	return result, nil
}

func getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "overseer-updater")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return errors.New("no stable release has been published yet")
		}
		return fmt.Errorf("GitHub releases returned %s", resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(dst)
}

// IsNewer compares stable vMAJOR.MINOR.PATCH versions. Development builds are
// considered older than a real release so source-installed services can move
// onto the supported release channel.
func IsNewer(candidate, current string) bool {
	cv, cok := parseVersion(candidate)
	if !cok {
		return false
	}
	cur, ok := parseVersion(current)
	if !ok {
		return true
	}
	for i := range cv {
		if cv[i] != cur[i] {
			return cv[i] > cur[i]
		}
	}
	return false
}

func isStableVersion(v string) bool {
	_, ok := parseVersion(v)
	return ok
}

func parseVersion(v string) ([3]int, bool) {
	var result [3]int
	if !strings.HasPrefix(v, "v") || strings.Contains(v, "-") {
		return result, false
	}
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	if len(parts) != 3 {
		return result, false
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return result, false
		}
		result[i] = n
	}
	return result, true
}

// Install downloads and verifies a release, then replaces the running binary.
// On Windows the final swap happens in a detached PowerShell helper after the
// current process exits. taskName is restarted by that helper when provided.
func Install(ctx context.Context, release Release, taskName string) error {
	exe, err := currentExecutable()
	if err != nil {
		return err
	}
	asset := filepath.Base(release.AssetURL)
	want, err := fetchChecksum(ctx, release.ChecksumsURL, asset)
	if err != nil {
		return err
	}
	staged, err := downloadStaged(ctx, release.AssetURL, exe, want)
	if err != nil {
		return err
	}
	if err := validateBinary(ctx, staged, release.Version); err != nil {
		os.Remove(staged)
		return err
	}
	if runtime.GOOS == "windows" {
		return scheduleWindowsSwap(exe, staged, taskName, false)
	}
	return swapUnix(exe, staged)
}

// Rollback restores the single previous verified binary retained beside the
// executable. It follows the same safe Windows handoff as normal updates.
func Rollback(taskName string) error {
	exe, err := currentExecutable()
	if err != nil {
		return err
	}
	previous := previousPath(exe)
	if _, err := os.Stat(previous); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return errors.New("no previous version is available")
		}
		return err
	}
	if runtime.GOOS == "windows" {
		return scheduleWindowsSwap(exe, previous, taskName, true)
	}
	failed := exe + ".rollback"
	_ = os.Remove(failed)
	if err := backupExecutable(exe, failed); err != nil {
		return err
	}
	// Replacing an existing path with rename is atomic on the same filesystem,
	// so the service never observes a missing executable.
	if err := os.Rename(previous, exe); err != nil {
		_ = os.Remove(failed)
		return err
	}
	return os.Rename(failed, previous)
}

// PreviousVersion reports the retained rollback version when it can run.
func PreviousVersion(ctx context.Context) string {
	exe, err := currentExecutable()
	if err != nil {
		return ""
	}
	return binaryVersion(ctx, previousPath(exe))
}

func currentExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
		exe = resolved
	}
	return exe, nil
}

func previousPath(exe string) string {
	if runtime.GOOS == "windows" && strings.EqualFold(filepath.Ext(exe), ".exe") {
		return strings.TrimSuffix(exe, filepath.Ext(exe)) + ".previous.exe"
	}
	return exe + ".previous"
}

func fetchChecksum(ctx context.Context, url, asset string) (string, error) {
	resp, err := httpGet(ctx, url, 2<<20)
	if err != nil {
		return "", err
	}
	defer resp.Close()
	scanner := bufio.NewScanner(resp)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && strings.TrimPrefix(fields[len(fields)-1], "*") == asset {
			if len(fields[0]) != sha256.Size*2 {
				return "", fmt.Errorf("invalid checksum for %s", asset)
			}
			return strings.ToLower(fields[0]), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("checksums.txt does not contain %s", asset)
}

func downloadStaged(ctx context.Context, url, exe, want string) (string, error) {
	body, err := httpGet(ctx, url, 1<<30)
	if err != nil {
		return "", err
	}
	defer body.Close()
	pattern := ".overseer-update-*"
	if runtime.GOOS == "windows" {
		pattern += ".exe"
	}
	tmp, err := os.CreateTemp(filepath.Dir(exe), pattern)
	if err != nil {
		return "", err
	}
	name := tmp.Name()
	ok := false
	closed := false
	defer func() {
		if !closed {
			tmp.Close()
		}
		if !ok {
			os.Remove(name)
		}
	}()
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hash), body); err != nil {
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		return "", err
	}
	err = tmp.Close()
	closed = true
	if err != nil {
		return "", err
	}
	got := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(got, want) {
		return "", fmt.Errorf("checksum mismatch for downloaded update")
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(name, 0o755); err != nil {
			return "", err
		}
	}
	ok = true
	return name, nil
}

func httpGet(ctx context.Context, url string, limit int64) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "overseer-updater")
	resp, err := (&http.Client{Timeout: defaultTimeout}).Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("download returned %s", resp.Status)
	}
	return struct {
		io.Reader
		io.Closer
	}{Reader: io.LimitReader(resp.Body, limit), Closer: resp.Body}, nil
}

func validateBinary(ctx context.Context, path, wantVersion string) error {
	got := binaryVersion(ctx, path)
	if got == "" {
		return errors.New("downloaded binary did not pass its version check")
	}
	if got != wantVersion {
		return fmt.Errorf("downloaded binary reports %s, expected %s", got, wantVersion)
	}
	return nil
}

func binaryVersion(ctx context.Context, path string) string {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(out)), "overseer "))
}

func swapUnix(exe, staged string) error {
	previous := previousPath(exe)
	_ = os.Remove(previous)
	// A hard link keeps the old inode as a rollback candidate, then rename
	// atomically replaces the executable path with the fully verified stage.
	if err := backupExecutable(exe, previous); err != nil {
		return err
	}
	if err := os.Rename(staged, exe); err != nil {
		_ = os.Remove(previous)
		return err
	}
	return nil
}

func backupExecutable(source, destination string) error {
	if err := os.Link(source, destination); err == nil {
		return nil
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	ok := false
	closed := false
	defer func() {
		if !closed {
			out.Close()
		}
		if !ok {
			os.Remove(destination)
		}
	}()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	err = out.Close()
	closed = true
	if err != nil {
		return err
	}
	ok = true
	return nil
}

func scheduleWindowsSwap(exe, source, taskName string, rollback bool) error {
	script, err := os.CreateTemp(filepath.Dir(exe), ".overseer-swap-*.ps1")
	if err != nil {
		return err
	}
	backup := previousPath(exe)
	mode := fmt.Sprintf("$backup = %s; if (Test-Path $backup) { Remove-Item -Force $backup }; [System.IO.File]::Replace($source, $exe, $backup, $true)", psQuote(backup))
	if rollback {
		mode = fmt.Sprintf("$failed = $exe + '.rollback'; $backup = %s; if (Test-Path $failed) { Remove-Item -Force $failed }; [System.IO.File]::Replace($source, $exe, $failed, $true); Move-Item -Force $failed $backup", psQuote(backup))
	}
	contents := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$exe = %s
$source = %s
$task = %s
try {
  Wait-Process -Id %d -Timeout 120 -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  %s
  if ($task) {
    for ($i = 0; $i -lt 20; $i++) {
      schtasks.exe /Run /TN $task 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep -Seconds 1
    }
  }
} finally {
  Remove-Item -Force $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
}
`, psQuote(exe), psQuote(source), psQuote(taskName), os.Getpid(), mode)
	if _, err := script.WriteString(contents); err != nil {
		script.Close()
		os.Remove(script.Name())
		return err
	}
	if err := script.Close(); err != nil {
		os.Remove(script.Name())
		return err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script.Name())
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	if err := cmd.Start(); err != nil {
		os.Remove(script.Name())
		return err
	}
	return cmd.Process.Release()
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
