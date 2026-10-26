package agent

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// A machine described in a table: which files exist, which names are on PATH.
func fakeMachine(goos string, env map[string]string, files []string, onPath map[string]string) browserFinder {
	have := map[string]bool{}
	for _, f := range files {
		have[filepath.ToSlash(f)] = true
	}
	return browserFinder{
		goos: goos, home: "/home/u",
		env:    func(k string) string { return env[k] },
		exists: func(p string) bool { return have[filepath.ToSlash(p)] },
		lookPath: func(name string) (string, error) {
			if p, ok := onPath[name]; ok {
				return p, nil
			}
			return "", errors.New("not found")
		},
	}
}

func TestFindBrowser(t *testing.T) {
	chromeMac := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	edgeMac := "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
	tests := []struct {
		name     string
		finder   browserFinder
		wantName string
		wantPath string
		found    bool
	}{
		{"mac with Chrome and Edge prefers Chrome", fakeMachine("darwin", nil, []string{edgeMac, chromeMac}, nil), "Chrome", chromeMac, true},
		{"mac with only Edge", fakeMachine("darwin", nil, []string{edgeMac}, nil), "Edge", edgeMac, true},
		{"mac user Applications folder", fakeMachine("darwin", nil, []string{"/home/u/Applications/Chromium.app/Contents/MacOS/Chromium"}, nil), "Chromium", "/home/u/Applications/Chromium.app/Contents/MacOS/Chromium", true},
		{"mac with nothing", fakeMachine("darwin", nil, nil, nil), "", "", false},
		{"linux chromium on PATH", fakeMachine("linux", nil, nil, map[string]string{"chromium": "/usr/bin/chromium"}), "Chromium", "/usr/bin/chromium", true},
		{"linux google-chrome beats chromium", fakeMachine("linux", nil, nil, map[string]string{"chromium": "/usr/bin/chromium", "google-chrome": "/usr/bin/google-chrome"}), "Chrome", "/usr/bin/google-chrome", true},
		{"linux snap chromium", fakeMachine("linux", nil, []string{"/snap/bin/chromium"}, nil), "Chromium", "/snap/bin/chromium", true},
		{"linux edge", fakeMachine("linux", nil, nil, map[string]string{"microsoft-edge": "/usr/bin/microsoft-edge"}), "Edge", "/usr/bin/microsoft-edge", true},
		{"linux nothing", fakeMachine("linux", nil, nil, nil), "", "", false},
		{"windows Chrome in Program Files", fakeMachine("windows", map[string]string{"ProgramFiles": `C:\Program Files`}, []string{`C:\Program Files\Google\Chrome\Application\chrome.exe`}, nil), "Chrome", `C:\Program Files\Google\Chrome\Application\chrome.exe`, true},
		{"explicit override wins", fakeMachine("linux", map[string]string{"OVERSEER_CHROME": "/opt/mine/chrome"}, []string{"/opt/mine/chrome"}, map[string]string{"chromium": "/usr/bin/chromium"}), "Chrome", "/opt/mine/chrome", true},
		{"override that does not exist is ignored", fakeMachine("linux", map[string]string{"OVERSEER_CHROME": "/gone"}, nil, map[string]string{"chromium": "/usr/bin/chromium"}), "Chromium", "/usr/bin/chromium", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.finder.goos == "windows" && runtime.GOOS != "windows" {
				t.Skip("windows paths are built with the host's separator")
			}
			got, ok := tc.finder.find()
			if ok != tc.found || got.Name != tc.wantName || (tc.found && got.Path != tc.wantPath) {
				t.Errorf("found %v %+v, want %v %s %s", ok, got, tc.found, tc.wantName, tc.wantPath)
			}
		})
	}
}

func TestCheckShotURL(t *testing.T) {
	good := []string{"http://localhost:5173/", "http://127.0.0.1:3000/a?b=1", "http://[::1]:8080/", "http://LOCALHOST:80"}
	bad := []string{
		"https://localhost:5173/", "http://example.com:80/", "http://localhost/", "http://localhost:0/", "http://localhost:99999/",
		"http://user:pw@localhost:3000/", "file:///etc/passwd", "http://192.168.1.5:3000/", "http://169.254.169.254:80/", "javascript:alert(1)", "",
		"http://localhost.evil.com:3000/", "http://127.0.0.1.nip.io:3000/",
	}
	for _, u := range good {
		if _, err := checkShotURL(u); err != nil {
			t.Errorf("rejected %q: %v", u, err)
		}
	}
	for _, u := range bad {
		if _, err := checkShotURL(u); err == nil {
			t.Errorf("accepted %q", u)
		}
	}
}

// writeFakeBrowser makes a script that behaves like `chrome --screenshot`:
// it logs its arguments and writes pngPath to the requested file.
func writeFakeBrowser(t *testing.T, pngPath string) (bin, logPath string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake browser is a shell script")
	}
	dir := t.TempDir()
	logPath = filepath.Join(dir, "args.txt")
	bin = filepath.Join(dir, "fake-chrome")
	script := `#!/bin/sh
for a in "$@"; do
  printf '%s\n' "$a" >> "` + logPath + `"
  case "$a" in --screenshot=*) out="${a#--screenshot=}";; esac
done
cp "` + pngPath + `" "$out"
echo "1234 bytes written to file $out" >&2
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin, logPath
}

func makePNG(t *testing.T, w, h int, noisy bool) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(1))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{0x20, 0x60, 0xd0, 0xff}
			if noisy {
				c = color.RGBA{uint8(rng.Intn(256)), uint8(rng.Intn(256)), uint8(rng.Intn(256)), 0xff}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "in.png")
	os.WriteFile(path, buf.Bytes(), 0o644)
	return path
}

func envFinder(bin string) browserFinder {
	f := systemBrowserFinder()
	f.env = func(k string) string {
		if k == "OVERSEER_CHROME" {
			return bin
		}
		return ""
	}
	return f
}

func TestCaptureScreenshotWithFakeBrowser(t *testing.T) {
	bin, logPath := writeFakeBrowser(t, makePNG(t, 64, 40, false))
	res := captureScreenshot(context.Background(), envFinder(bin), protocol.ScreenshotRequest{Url: "http://localhost:5173/about", Width: 1280, Height: 720})
	if res.Status != protocol.ShotOK || res.Mime != "image/png" || res.Width != 64 || len(res.Data) == 0 {
		t.Fatalf("result = %+v", res)
	}
	log, _ := os.ReadFile(logPath)
	args := strings.Split(strings.TrimSpace(string(log)), "\n")
	has := func(want string) bool {
		for _, a := range args {
			if a == want {
				return true
			}
		}
		return false
	}
	for _, want := range []string{"--headless=new", "--window-size=1280,720", "--virtual-time-budget=5000", "http://localhost:5173/about"} {
		if !has(want) {
			t.Errorf("browser was not given %s; got %v", want, args)
		}
	}
	if last := args[len(args)-1]; last != "http://localhost:5173/about" {
		t.Errorf("the page must be the last argument, got %q", last)
	}
	profile := ""
	for _, a := range args {
		if strings.HasPrefix(a, "--user-data-dir=") {
			profile = strings.TrimPrefix(a, "--user-data-dir=")
		}
	}
	if profile == "" {
		t.Error("no throwaway profile")
	} else if _, err := os.Stat(filepath.Dir(profile)); err == nil {
		t.Error("the temporary folder was not removed")
	}
}

func TestCaptureScreenshotRefusesOtherPlaces(t *testing.T) {
	bin, logPath := writeFakeBrowser(t, makePNG(t, 8, 8, false))
	for _, u := range []string{"https://example.com/", "http://10.0.0.5:8080/", "file:///etc/hosts"} {
		res := captureScreenshot(context.Background(), envFinder(bin), protocol.ScreenshotRequest{Url: u})
		if res.Status != protocol.ShotError {
			t.Errorf("%s: %+v", u, res)
		}
	}
	if _, err := os.Stat(logPath); err == nil {
		t.Error("the browser was started for a refused page")
	}
}

func TestCaptureScreenshotWithoutBrowser(t *testing.T) {
	f := fakeMachine("linux", nil, nil, nil)
	res := captureScreenshot(context.Background(), f, protocol.ScreenshotRequest{Url: "http://localhost:3000/"})
	if res.Status != protocol.ShotNoBrowser || res.Message == "" {
		t.Fatalf("result = %+v", res)
	}
}

func TestPackShotShrinksBigPictures(t *testing.T) {
	big, err := os.ReadFile(makePNG(t, 900, 700, true)) // noise does not compress
	if err != nil {
		t.Fatal(err)
	}
	if len(big) <= shotKeepPNG {
		t.Fatalf("test picture is only %d bytes", len(big))
	}
	res := packShot(big, "Chrome")
	if res.Status != protocol.ShotOK || res.Mime != "image/jpeg" || len(res.Data) >= len(big) || len(res.Data) > shotMaxBytes {
		t.Fatalf("result = %s %s %d bytes (from %d)", res.Status, res.Mime, len(res.Data), len(big))
	}
	if res.Width != 900 || res.Height != 700 {
		t.Errorf("size = %dx%d", res.Width, res.Height)
	}
	if bad := packShot([]byte("not a png"), "Chrome"); bad.Status != protocol.ShotError {
		t.Errorf("garbage = %+v", bad)
	}
}

func TestCaptureScreenshotTimesOut(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "slow")
	os.WriteFile(bin, []byte("#!/bin/sh\nsleep 30\n"), 0o755)
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	res := captureScreenshot(ctx, envFinder(bin), protocol.ScreenshotRequest{Url: "http://localhost:3000/"})
	if res.Status != protocol.ShotError || !strings.Contains(res.Message, "too long") {
		t.Errorf("result = %+v", res)
	}
	if time.Since(start) > 10*time.Second {
		t.Errorf("took %s to give up", time.Since(start))
	}
}

// TestRealBrowser takes one real screenshot of the page named by
// OVERSEER_REAL_SHOT_URL with the browser installed here. It is skipped unless
// that is set.
func TestRealBrowser(t *testing.T) {
	url := os.Getenv("OVERSEER_REAL_SHOT_URL")
	if url == "" {
		t.Skip("set OVERSEER_REAL_SHOT_URL to a local page to run this")
	}
	out := os.Getenv("OVERSEER_REAL_SHOT_OUT")
	for _, mobile := range []bool{false, true} {
		w := 1440
		if mobile {
			w = 390
		}
		res := captureScreenshot(context.Background(), systemBrowserFinder(), protocol.ScreenshotRequest{Url: url, Mobile: mobile, Width: w, Height: 900})
		if res.Status != protocol.ShotOK {
			t.Fatalf("mobile=%v: %+v", mobile, res)
		}
		t.Logf("mobile=%v: %s %dx%d %d bytes via %s", mobile, res.Mime, res.Width, res.Height, len(res.Data), res.Browser)
		if out != "" {
			ext := ".png"
			if res.Mime == "image/jpeg" {
				ext = ".jpg"
			}
			name := "desktop"
			if mobile {
				name = "phone"
			}
			os.WriteFile(filepath.Join(out, name+ext), res.Data, 0o644)
		}
	}
}
