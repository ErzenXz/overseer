package hub

import (
	"bufio"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestShotCwdOKAndPathWithin(t *testing.T) {
	for cwd, want := range map[string]bool{
		"/Users/erzen/Projects/app": true, "/home/me/code/site": true, "/srv/app": false, "/Users/erzen": false, "/home/me": false, "/": false,
		"": false, "~": false, "~/app": true, "~/Projects/app": true, `C:\Users\me`: false, `C:\Users\me\code\app`: true, "/a/b/c": true,
	} {
		if got := shotCwdOK(cwd); got != want {
			t.Errorf("shotCwdOK(%q) = %v, want %v", cwd, got, want)
		}
	}
	for _, tc := range []struct {
		dir, p string
		want   bool
	}{
		{"/a/b/app", "/a/b/app", true}, {"/a/b/app", "/a/b/app/web", true}, {"/a/b/app/", "/a/b/app/web/", true},
		{"/a/b/app", "/a/b/app2", false}, {"/a/b/app", "/a/b", false}, {"/a/b/app", "", false}, {"", "/a", false},
		{`C:\code\app`, `c:/code/app/web`, true}, {`C:\code\app`, `D:\code\app`, false},
	} {
		if got := pathWithin(tc.dir, tc.p); got != tc.want {
			t.Errorf("pathWithin(%q, %q) = %v, want %v", tc.dir, tc.p, got, tc.want)
		}
	}
}

func TestPublicShotBase(t *testing.T) {
	srv, _ := startHub(t)
	for _, tc := range []struct {
		url     string
		want    string
		problem string
	}{
		{"https://hub.example.com", "https://hub.example.com", ""},
		{"https://hub.example.com/", "https://hub.example.com", ""},
		{"https://overseer.acme.dev:8443", "https://overseer.acme.dev:8443", ""},
		{"http://hub.example.com", "", "http"},
		{"http://localhost:4200", "", "http"},
		{"https://localhost", "", "no public https address"},
		{"https://192.168.1.5", "", "no public https address"},
		{"https://203.0.113.9", "", "no public https address"},
		{"https://mybox", "", "no public https address"},
		{"https://nas.local", "", "only reachable on your own network"},
		{"https://hub.home.arpa", "", "only reachable on your own network"},
		{"", "", "does not know a public address"},
	} {
		srv.store.SetSetting(settingHubPublicURL, tc.url)
		base, reason := srv.publicShotBase()
		if base != tc.want || (tc.problem == "") != (reason == "") || !strings.Contains(reason, tc.problem) {
			t.Errorf("%q: base %q reason %q (want %q / %q)", tc.url, base, reason, tc.want, tc.problem)
		}
	}
}

func TestShotsCommentBody(t *testing.T) {
	shots := []threadShot{
		{Kind: "before", Form: "desktop", Mime: "image/png", Token: strings.Repeat("a", 32)},
		{Kind: "after", Form: "desktop", Mime: "image/jpeg", Token: strings.Repeat("b", 32)},
	}
	body := shotsCommentBody("https://hub.example.com", shots)
	for _, want := range []string{"### Before and after", "| Before | After |",
		`src="https://hub.example.com/api/shots/pub/` + strings.Repeat("a", 32) + `.png"`,
		`src="https://hub.example.com/api/shots/pub/` + strings.Repeat("b", 32) + `.jpg"`, "overseer.sh"} {
		if !strings.Contains(body, want) {
			t.Errorf("comment is missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "Phone") {
		t.Error("a phone table without phone pictures")
	}
	shots = append(shots, threadShot{Kind: "before", Form: "phone", Mime: "image/png", Token: strings.Repeat("c", 32)})
	if body := shotsCommentBody("https://h.example.com", shots); !strings.Contains(body, "**Phone**") || !strings.Contains(body, "_none_") {
		t.Errorf("phone table:\n%s", body)
	}
}

func TestParsePRView(t *testing.T) {
	repo, n, state := parsePRView(`{"number":42,"url":"https://github.com/acme/widgets/pull/42","state":"open"}`)
	if repo != "acme/widgets" || n != 42 || state != "OPEN" {
		t.Errorf("got %q %d %q", repo, n, state)
	}
	for _, bad := range []string{``, `nope`, `{"number":1,"url":"https://evil.example/acme/widgets/pull/1","state":"OPEN"}`, `{"number":0,"url":"https://github.com/a/b/pull/1"}`} {
		if repo, _, _ := parsePRView(bad); repo != "" {
			t.Errorf("accepted %q", bad)
		}
	}
}

// ---- the whole picture, with a fake Chrome and a real dev server ----

func writeShotPNG(t *testing.T, dir string) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 20))
	for x := 0; x < 32; x++ {
		for y := 0; y < 20; y++ {
			img.Set(x, y, color.RGBA{0x20, 0x70, 0xe0, 0xff})
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	path := filepath.Join(dir, "shot.png")
	os.WriteFile(path, buf.Bytes(), 0o644)
	return path
}

// startDevServer runs a web server whose working folder is dir.
func startDevServer(t *testing.T, dir string) int {
	t.Helper()
	app := exec.Command(os.Args[0], "-test.run=^$")
	app.Dir = dir
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, fakeACPEnv+"=") { // TestMain would run the fake agent instead
			app.Env = append(app.Env, kv)
		}
	}
	app.Env = append(app.Env, fakeHTTPEnv+"=1")
	stdin, _ := app.StdinPipe()
	stdout, _ := app.StdoutPipe()
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stdin.Close(); app.Wait() })
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.TrimSpace(line))
	return port
}

func shotsEnv(t *testing.T) (*apEnv, string) {
	t.Helper()
	oldTick, oldRetry, oldPR, oldPorts := shotsTickEvery, shotRetryAfter, shotPRCheckEvery, shotPortsTTL
	shotsTickEvery, shotRetryAfter, shotPRCheckEvery, shotPortsTTL = 100*time.Millisecond, 200*time.Millisecond, 0, 0
	t.Cleanup(func() {
		shotsTickEvery, shotRetryAfter, shotPRCheckEvery, shotPortsTTL = oldTick, oldRetry, oldPR, oldPorts
	})
	e := newAPEnv(t)
	// A fake Chrome: records the page it was asked for and writes a picture.
	dir := t.TempDir()
	fixture := writeShotPNG(t, dir)
	bin := filepath.Join(dir, "fake-chrome")
	script := `#!/bin/sh
for a in "$@"; do
  case "$a" in --screenshot=*) out="${a#--screenshot=}";; esac
  last="$a"
done
echo "$last" >> "` + filepath.Join(dir, "pages.txt") + `"
cp "` + fixture + `" "$out"
`
	os.WriteFile(bin, []byte(script), 0o755)
	t.Setenv("OVERSEER_CHROME", bin)
	return e, filepath.Join(dir, "pages.txt")
}

func (e *apEnv) startSession(cwd string) Thread {
	e.f.t.Helper()
	var th Thread
	e.api.do("POST", "/api/threads", map[string]any{"deviceId": e.device, "agent": e.agent, "cwd": cwd, "access": "ask", "prompt": "make the header blue"}, &th)
	return th
}

func (e *apEnv) shots(threadId string) shotsReply {
	e.f.t.Helper()
	var reply shotsReply
	e.api.do("GET", "/api/threads/"+threadId+"/shots", nil, &reply)
	return reply
}

func findShot(reply shotsReply, kind, form string) *threadShot {
	for i := range reply.Shots {
		if reply.Shots[i].Kind == kind && reply.Shots[i].Form == form {
			return &reply.Shots[i]
		}
	}
	return nil
}

func TestShotsBeforeAndAfterAndPullRequestComment(t *testing.T) {
	e, pages := shotsEnv(t)
	cwd := filepath.Join(e.f.home, "code", "site")
	os.MkdirAll(cwd, 0o755)
	port := startDevServer(t, cwd)

	th := e.startSession(cwd)
	// The preview was already there: the first picture is the "before".
	waitUntil(t, "the before screenshot", 30*time.Second, func() bool { return findShot(e.shots(th.Id), "before", "desktop") != nil })
	reply := e.shots(th.Id)
	before := findShot(reply, "before", "desktop")
	if before.Port != port || before.Mime != "image/png" || before.Width != 32 || before.Height != 20 || before.Size == 0 {
		t.Fatalf("before = %+v (server on %d)", before, port)
	}
	if findShot(reply, "after", "desktop") != nil {
		t.Error("an after picture exists before the turn ended")
	}
	if b, _ := os.ReadFile(pages); !strings.Contains(string(b), fmt.Sprintf("http://localhost:%d/", port)) {
		t.Errorf("the browser was asked for %q", b)
	}
	// Only the session's own server was captured, once.
	time.Sleep(500 * time.Millisecond)
	if b, _ := os.ReadFile(pages); strings.Count(string(b), "\n") != 1 {
		t.Errorf("pages captured:\n%s", b)
	}

	// The picture is served to signed-in users only.
	resp, _ := http.Get(e.api.base + before.Url)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("an unauthenticated image request = %d", resp.StatusCode)
	}
	req, _ := http.NewRequest("GET", e.api.base+before.Url, nil)
	req.Header.Set("Authorization", "Bearer "+e.api.token)
	resp, _ = http.DefaultClient.Do(req)
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/png" || resp.Header.Get("X-Content-Type-Options") != "nosniff" || !bytes.HasPrefix(data, []byte("\x89PNG")) {
		t.Errorf("image: %d %s %d bytes", resp.StatusCode, resp.Header.Get("Content-Type"), len(data))
	}

	// The agent's turn ends: the "after" is taken, and the pull request the
	// session has (the stub gh says there is one) is looked at. The hub has
	// no public https address, so nothing is posted and the reason is kept.
	e.approve(th.Id)
	waitUntil(t, "the after screenshot", 30*time.Second, func() bool { return findShot(e.shots(th.Id), "after", "desktop") != nil })
	waitUntil(t, "the pull request note", 20*time.Second, func() bool { return e.shots(th.Id).Info.PR.State == "skipped" })
	reply = e.shots(th.Id)
	if !strings.Contains(reply.Info.PR.Reason, "http") || reply.PublicBase != "" || reply.PublicReason == "" {
		t.Errorf("info = %+v / %q", reply.Info, reply.PublicReason)
	}
	if e.f.read("pr-comment.txt") != "" {
		t.Error("a comment was posted without a public https address")
	}
	if keptBefore := findShot(reply, "before", "desktop"); keptBefore == nil || keptBefore.Id != before.Id {
		t.Error("the before picture was replaced")
	}

	// With a public https address the comment goes up, once.
	e.srv.store.SetSetting(settingHubPublicURL, "https://hub.example.com")
	var after shotsReply
	e.api.do("POST", "/api/threads/"+th.Id+"/shots", map[string]string{"kind": "after"}, &after)
	waitUntil(t, "the pull request comment", 20*time.Second, func() bool { return e.shots(th.Id).Info.PR.State == "commented" })
	comment := e.f.read("pr-comment.txt")
	reply = e.shots(th.Id)
	b, a := findShot(reply, "before", "desktop"), findShot(reply, "after", "desktop")
	if !strings.Contains(comment, "Before and after") || !regexp.MustCompile(`https://hub\.example\.com/api/shots/pub/[0-9a-f]{32}\.png`).MatchString(comment) {
		t.Fatalf("comment:\n%s", comment)
	}
	// The token in the comment opens the picture without signing in.
	token := regexp.MustCompile(`/api/shots/pub/([0-9a-f]{32})\.png`).FindStringSubmatch(comment)[1]
	pub, _ := http.Get(e.api.base + "/api/shots/pub/" + token + ".png")
	pubData, _ := io.ReadAll(pub.Body)
	pub.Body.Close()
	if pub.StatusCode != 200 || pub.Header.Get("Content-Type") != "image/png" || !bytes.HasPrefix(pubData, []byte("\x89PNG")) {
		t.Errorf("public image: %d %s", pub.StatusCode, pub.Header.Get("Content-Type"))
	}
	_ = b
	_ = a
	for _, bad := range []string{strings.Repeat("0", 32) + ".png", "short.png", token[:31] + "g.png", "../../etc/passwd", token + ".png/x"} {
		r, err := http.Get(e.api.base + "/api/shots/pub/" + bad)
		if err == nil {
			r.Body.Close()
			if r.StatusCode == 200 {
				t.Errorf("%q was served", bad)
			}
		}
	}
	// Another look at the pull request does not comment twice.
	e.api.do("POST", "/api/threads/"+th.Id+"/shots", map[string]string{"kind": "after"}, &after)
	time.Sleep(600 * time.Millisecond)
	if n := strings.Count(e.f.read("gh.log"), "pr comment"); n != 1 {
		t.Errorf("%d pull request comments", n)
	}

	// Gone with the session.
	e.api.do("DELETE", "/api/threads/"+th.Id, nil, &map[string]bool{})
	r, _ := http.Get(e.api.base + "/api/shots/pub/" + token + ".png")
	r.Body.Close()
	if r.StatusCode != http.StatusNotFound {
		t.Errorf("a deleted session's picture is still served: %d", r.StatusCode)
	}
}

func TestShotsOnlyCaptureTheSessionsOwnServer(t *testing.T) {
	e, pages := shotsEnv(t)
	other := filepath.Join(e.f.home, "code", "elsewhere")
	mine := filepath.Join(e.f.home, "code", "mine")
	os.MkdirAll(other, 0o755)
	os.MkdirAll(mine, 0o755)
	startDevServer(t, other) // somebody else's server

	th := e.startSession(mine)
	time.Sleep(1500 * time.Millisecond)
	if reply := e.shots(th.Id); len(reply.Shots) != 0 {
		t.Fatalf("captured a server from another folder: %+v", reply.Shots)
	}
	if b, _ := os.ReadFile(pages); len(b) != 0 {
		t.Errorf("the browser was started: %s", b)
	}
	// A manual try says why.
	var reply shotsReply
	e.api.do("POST", "/api/threads/"+th.Id+"/shots", map[string]string{"kind": "after"}, &reply)
	if reply.Info.Status != "no-preview" || !strings.Contains(reply.Info.Note, "No web server") {
		t.Errorf("info = %+v", reply.Info)
	}

	// A session in a broad folder (a home folder) is never matched at all.
	home := e.startSession("/private/tmp")
	startDevServer(t, "/private/tmp")
	e.api.do("POST", "/api/threads/"+home.Id+"/shots", map[string]string{"kind": "after"}, &reply)
	if len(reply.Shots) != 0 {
		t.Errorf("captured for a session in the home folder: %+v", reply.Shots)
	}
}

func TestShotsCanBeTurnedOff(t *testing.T) {
	e, pages := shotsEnv(t)
	cwd := filepath.Join(e.f.home, "code", "site")
	os.MkdirAll(cwd, 0o755)
	startDevServer(t, cwd)
	var cfg struct {
		Config shotsConfig `json:"config"`
	}
	e.api.do("PUT", "/api/shots/config", map[string]bool{"enabled": false}, &cfg)
	if cfg.Config.Enabled || !cfg.Config.PRComment || cfg.Config.Phone {
		t.Errorf("config = %+v", cfg.Config)
	}
	th := e.startSession(cwd)
	time.Sleep(1200 * time.Millisecond)
	if b, _ := os.ReadFile(pages); len(b) != 0 {
		t.Errorf("a screenshot was taken while off: %s", b)
	}
	if code := e.api.do("POST", "/api/threads/"+th.Id+"/shots", map[string]string{"kind": "before"}, nil); code != http.StatusConflict {
		t.Errorf("manual capture while off = %d", code)
	}
	e.api.do("PUT", "/api/shots/config", map[string]any{"enabled": true, "phone": true, "prComment": false}, &cfg)
	if !cfg.Config.Enabled || !cfg.Config.Phone || cfg.Config.PRComment {
		t.Errorf("config = %+v", cfg.Config)
	}
	if code := e.api.do("POST", "/api/threads/"+th.Id+"/shots", map[string]string{"kind": "nope"}, nil); code != http.StatusBadRequest {
		t.Errorf("bad kind = %d", code)
	}
}
