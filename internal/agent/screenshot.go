package agent

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Screenshots of a session's live preview (before/after a change). The page is
// a dev server on this machine; the picture is taken by the Chrome, Chromium
// or Edge that is already installed, headless, with a throwaway profile. There
// is no browser bundled and no browser driver: when none is installed the
// answer is "no-browser" and the hub skips quietly.

const (
	shotDefaultWidth  = 1440
	shotDefaultHeight = 900
	shotPhoneWidth    = 390
	shotPhoneHeight   = 844
	shotTimeout       = 50 * time.Second
	shotKeepPNG       = 900 * 1024  // a bigger PNG is sent as JPEG
	shotMaxBytes      = 1536 * 1024 // the hub's limit for one image
	shotMaxPixels     = 40_000_000  // refuse to decode anything bigger
	phoneUserAgent    = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

// browser is an installed Chromium-family browser.
type browser struct {
	Path string
	Name string
}

// browserFinder holds the lookups findBrowser needs, so tests can describe a
// machine without having one.
type browserFinder struct {
	goos     string
	env      func(string) string
	home     string
	exists   func(path string) bool
	lookPath func(name string) (string, error)
}

func systemBrowserFinder() browserFinder {
	home, _ := os.UserHomeDir()
	return browserFinder{
		goos: runtime.GOOS, env: os.Getenv, home: home,
		exists:   func(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() },
		lookPath: exec.LookPath,
	}
}

// find returns the first browser found: $OVERSEER_CHROME, then the usual
// install locations for the OS, then names on PATH. Chrome comes before
// Chromium, Edge and Brave.
func (f browserFinder) find() (browser, bool) {
	if p := strings.TrimSpace(f.env("OVERSEER_CHROME")); p != "" && f.exists(p) {
		return browser{Path: p, Name: "Chrome"}, true
	}
	type cand struct{ name, path string }
	var paths []cand
	var names []cand
	switch f.goos {
	case "darwin":
		apps := []string{"/Applications", filepath.Join(f.home, "Applications")}
		for _, root := range apps {
			paths = append(paths,
				cand{"Chrome", root + "/Google Chrome.app/Contents/MacOS/Google Chrome"},
				cand{"Chrome Canary", root + "/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"},
				cand{"Chromium", root + "/Chromium.app/Contents/MacOS/Chromium"},
				cand{"Edge", root + "/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"},
				cand{"Brave", root + "/Brave Browser.app/Contents/MacOS/Brave Browser"},
			)
		}
	case "windows":
		for _, root := range []string{f.env("ProgramFiles"), f.env("ProgramFiles(x86)"), f.env("LOCALAPPDATA")} {
			if root == "" {
				continue
			}
			paths = append(paths,
				cand{"Chrome", filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe")},
				cand{"Edge", filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe")},
				cand{"Brave", filepath.Join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")},
				cand{"Chromium", filepath.Join(root, "Chromium", "Application", "chrome.exe")},
			)
		}
	default:
		names = []cand{
			{"Chrome", "google-chrome"}, {"Chrome", "google-chrome-stable"}, {"Chromium", "chromium"},
			{"Chromium", "chromium-browser"}, {"Edge", "microsoft-edge"}, {"Edge", "microsoft-edge-stable"},
			{"Brave", "brave-browser"}, {"Chrome", "chrome"},
		}
		paths = []cand{
			{"Chrome", "/opt/google/chrome/chrome"}, {"Chromium", "/snap/bin/chromium"},
			{"Edge", "/opt/microsoft/msedge/msedge"}, {"Brave", "/opt/brave.com/brave/brave"},
		}
	}
	for _, c := range names {
		if p, err := f.lookPath(c.path); err == nil && p != "" {
			return browser{Path: p, Name: c.name}, true
		}
	}
	for _, c := range paths {
		if f.exists(c.path) {
			return browser{Path: c.path, Name: c.name}, true
		}
	}
	return browser{}, false
}

// checkShotURL accepts only a dev server on this machine: http, a loopback
// host and an explicit port. The hub builds the URL from a listening port, but
// the agent does not take its word for it.
func checkShotURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "http" || u.User != nil {
		return nil, fmt.Errorf("only http://localhost pages can be captured")
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		return nil, fmt.Errorf("only http://localhost pages can be captured")
	}
	if p, err := strconv.Atoi(u.Port()); err != nil || p < 1 || p > 65535 {
		return nil, fmt.Errorf("the page needs a port")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !ip.IsLoopback() {
		return nil, fmt.Errorf("only http://localhost pages can be captured")
	}
	return u, nil
}

// screenshot answers a screenshot.capture request.
func (a *Agent) screenshot(req protocol.ScreenshotRequest) protocol.ScreenshotResult {
	ctx, cancel := context.WithTimeout(context.Background(), shotTimeout)
	defer cancel()
	return captureScreenshot(ctx, systemBrowserFinder(), req)
}

func captureScreenshot(ctx context.Context, finder browserFinder, req protocol.ScreenshotRequest) protocol.ScreenshotResult {
	fail := func(format string, args ...any) protocol.ScreenshotResult {
		return protocol.ScreenshotResult{Status: protocol.ShotError, Message: fmt.Sprintf(format, args...)}
	}
	u, err := checkShotURL(req.Url)
	if err != nil {
		return fail("%v", err)
	}
	b, ok := finder.find()
	if !ok {
		return protocol.ScreenshotResult{Status: protocol.ShotNoBrowser, Message: "No Chrome, Chromium or Edge is installed on this machine."}
	}
	width, height := req.Width, req.Height
	if width <= 0 {
		width = shotDefaultWidth
		if req.Mobile {
			width = shotPhoneWidth
		}
	}
	if height <= 0 {
		height = shotDefaultHeight
		if req.Mobile {
			height = shotPhoneHeight
		}
	}
	width, height = min(max(width, 320), 3000), min(max(height, 240), 4000)
	wait := req.WaitMs
	if wait <= 0 {
		wait = 5000
	}
	wait = min(max(wait, 500), 15000)
	if req.Mobile {
		return captureMobile(ctx, b, u.String(), width, height, wait) // screenshot_cdp.go
	}

	tmp, err := os.MkdirTemp("", "overseer-shot-")
	if err != nil {
		return fail("Could not make a temporary folder: %v", err)
	}
	defer os.RemoveAll(tmp)
	out := filepath.Join(tmp, "shot.png")
	args := []string{
		"--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
		"--no-first-run", "--no-default-browser-check", "--disable-extensions",
		"--disable-background-networking", "--disable-component-update", "--disable-sync",
		"--user-data-dir=" + filepath.Join(tmp, "profile"),
		fmt.Sprintf("--window-size=%d,%d", width, height),
		fmt.Sprintf("--virtual-time-budget=%d", wait),
		"--screenshot=" + out,
	}
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		args = append(args, "--no-sandbox") // Chrome refuses to run as root without it
	}
	args = append(args, u.String())

	cmd := exec.CommandContext(ctx, b.Path, args...)
	var log bytes.Buffer
	cmd.Stdout, cmd.Stderr = &log, &log
	cmd.WaitDelay = 3 * time.Second
	setProcGroup(cmd)
	cmd.Cancel = func() error {
		done := make(chan struct{})
		go func() { time.Sleep(2500 * time.Millisecond); close(done) }()
		killProcessTree(cmd, done)
		return nil
	}
	runErr := cmd.Run()
	data, readErr := os.ReadFile(out)
	if readErr != nil || len(data) == 0 {
		if ctx.Err() != nil {
			return fail("The page took too long to load.")
		}
		text := lastLine(log.String())
		if len(text) > 200 {
			text = text[:200]
		}
		if text == "" && runErr != nil {
			text = runErr.Error()
		}
		return fail("%s could not take the screenshot: %s", b.Name, text)
	}
	return packShot(data, b.Name)
}

// packShot returns the PNG as it is when it is small, else as a JPEG, and
// refuses what would not fit the hub's limit.
func packShot(pngData []byte, browserName string) protocol.ScreenshotResult {
	cfg, err := png.DecodeConfig(bytes.NewReader(pngData))
	if err != nil {
		return protocol.ScreenshotResult{Status: protocol.ShotError, Message: "The browser wrote something that is not a picture."}
	}
	res := protocol.ScreenshotResult{Status: protocol.ShotOK, Width: cfg.Width, Height: cfg.Height, Browser: browserName}
	if len(pngData) <= shotKeepPNG {
		res.Mime, res.Data = "image/png", pngData
		return res
	}
	if cfg.Width*cfg.Height > shotMaxPixels {
		return protocol.ScreenshotResult{Status: protocol.ShotError, Message: "The page is too tall to capture."}
	}
	img, err := png.Decode(bytes.NewReader(pngData))
	if err != nil {
		return protocol.ScreenshotResult{Status: protocol.ShotError, Message: "The browser wrote something that is not a picture."}
	}
	for _, quality := range []int{82, 65, 45} {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, flatten(img), &jpeg.Options{Quality: quality}); err != nil {
			break
		}
		if buf.Len() <= shotMaxBytes {
			res.Mime, res.Data = "image/jpeg", buf.Bytes()
			return res
		}
	}
	return protocol.ScreenshotResult{Status: protocol.ShotError, Message: "The screenshot is too large to keep."}
}

// flatten puts a picture on white so transparency does not turn black in JPEG.
func flatten(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(b)
	for i := range dst.Pix {
		dst.Pix[i] = 0xff
	}
	draw.Draw(dst, b, src, b.Min, draw.Over)
	return dst
}
