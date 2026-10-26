package hub

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestRedactSecrets(t *testing.T) {
	cases := []struct{ in, gone string }{
		{"export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"},
		{"key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", "AbCdEfGhIjKlMnOpQrStUvWx"},
		{"OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456", "abcdefghijklmnopqrstuvwxyz123456"},
		{"aws AKIAIOSFODNN7EXAMPLE here", "AKIAIOSFODNN7EXAMPLE"},
		{"aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalrXUtnFEMI"},
		{"Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789", "abcdefghijklmnopqrstuvwxyz0123456789"},
		{"jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "dBjftJeZ4CVPmB92K27uhbUJU1p1r"},
		{"db password=hunter2 ok", "hunter2"},
		{`{"api_key": "abc123def456"}`, "abc123def456"},
		{"postgres://admin:s3cretpw@db.internal:5432/app", "s3cretpw"},
		{"-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nmore\n-----END RSA PRIVATE KEY-----\nafter", "MIIEowIBAAKCAQEA"},
		{"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq", "MIIEvQIBADANBgkq"},
		{"xox" + "b-1234567890-abcdefghij", "abcdefghij"},
	}
	for _, c := range cases {
		got := redactSecrets(c.in)
		if strings.Contains(got, c.gone) {
			t.Errorf("redactSecrets(%q) = %q, still has the secret", c.in, got)
		}
		if !strings.Contains(got, shareRedacted) {
			t.Errorf("redactSecrets(%q) = %q, no marker", c.in, got)
		}
	}
	if got := redactSecrets("password=hunter2"); got != "password=[redacted]" {
		t.Errorf("marker = %q", got)
	}
	// Ordinary code and prose stay readable.
	for _, keep := range []string{
		"func Login(password string, token string) error",
		"token: string",
		"password = os.Getenv(\"DB_PASSWORD\")",
		"const authHeader = req.headers.auth",
		"Run `go test ./...` and fix the failing sessions test",
		"sk-learn is a library",
	} {
		if got := redactSecrets(keep); got != keep {
			t.Errorf("redactSecrets(%q) changed it to %q", keep, got)
		}
	}
	if got := redactSecrets("after the key\n-----END RSA PRIVATE KEY-----\nafter"); !strings.Contains(got, "after the key") {
		t.Errorf("text before a stray footer was lost: %q", got)
	}
}

func TestNameScrubber(t *testing.T) {
	n := newNameScrubber("/Users/erzen/Projects/orbit-api", "MacBook Pro", "erzens-mbp.local")
	cases := map[string]string{
		"edit /Users/erzen/Projects/orbit-api/src/auth.go": "edit src/auth.go",
		"cd /Users/erzen/Projects/orbit-api && go test":    "cd . && go test",
		"ssh erzens-mbp now":                               "ssh the machine now",
		"ran on MacBook Pro in 3s":                         "ran on the machine in 3s",
		"see /Users/erzen/.config/x and /home/bob/y":       "see ~/.config/x and ~/y",
		`C:\Users\Bob\proj\a.txt`:                          `~\proj\a.txt`,
	}
	for in, want := range cases {
		if got := n.scrub(in); got != want {
			t.Errorf("scrub(%q) = %q, want %q", in, got, want)
		}
	}
	var none *nameScrubber
	if none.scrub("x") != "x" {
		t.Error("nil scrubber should pass text through")
	}
}

func TestPrivateHost(t *testing.T) {
	for base, want := range map[string]bool{
		"http://localhost:4200":          true,
		"http://127.0.0.1:4200":          true,
		"http://[::1]:4200":              true,
		"http://192.168.1.20:4200":       true,
		"http://10.0.0.5":                true,
		"http://172.20.1.1":              true,
		"http://100.101.102.103:4200":    true,
		"http://macmini.local:4200":      true,
		"https://box.tail1234.ts.net":    true,
		"http://homelab":                 true,
		"https://overseer.example.com":   false,
		"https://8.8.8.8":                false,
		"http://100.200.1.1":             false, // outside 100.64.0.0/10
		"https://hub.mycompany.dev:8443": false,
		"":                               true,
	} {
		if got := privateHost(base); got != want {
			t.Errorf("privateHost(%q) = %v, want %v", base, got, want)
		}
	}
}

func TestSharePreview(t *testing.T) {
	p := &publicShare{Mode: shareReplay, Thread: publicThread{Title: "Fix flaky auth tests", AgentName: "Claude Code"}, Summary: publicSummary{DurationMs: 130_000, Steps: 14, Files: 3, Additions: 42, Deletions: 11}}
	title, desc := sharePreview(p)
	if title != "Claude Code fixed flaky auth tests in 2m 10s · Overseer" {
		t.Errorf("title = %q", title)
	}
	if !strings.Contains(desc, "14 steps") || !strings.Contains(desc, "3 files changed (+42 −11)") {
		t.Errorf("desc = %q", desc)
	}
	p.Thread.Title = "Dashboard polish"
	if title, _ := sharePreview(p); title != "Dashboard polish · Claude Code in 2m 10s · Overseer" {
		t.Errorf("title = %q", title)
	}
	p.Mode = shareLive
	if title, _ := sharePreview(p); !strings.HasPrefix(title, "Live: Dashboard polish") {
		t.Errorf("live title = %q", title)
	}
}

func TestRenderSharePageEscapes(t *testing.T) {
	out := renderSharePage("<html><head><title>Overseer</title></head><body></body></html>", `A "quoted" <b>title</b> · Overseer`, "d\nesc", "http://x/s/t")
	if strings.Contains(out, "<b>") || !strings.Contains(out, "&lt;b&gt;title") {
		t.Errorf("title not escaped: %s", out)
	}
	for _, want := range []string{`og:title`, `twitter:card`, `og:description`, `<title>A &#34;quoted&#34;`} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %s", want, out)
		}
	}
}

func TestWindowLimiter(t *testing.T) {
	l := newWindowLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !l.allow("a") {
			t.Fatalf("call %d refused", i)
		}
	}
	if l.allow("a") {
		t.Error("fourth call allowed")
	}
	if !l.allow("b") {
		t.Error("another client was refused")
	}
}

// --- end to end through the real routes ---

type shareEnv struct {
	t      *testing.T
	srv    *Server
	cookie *http.Cookie
}

func newShareEnv(t *testing.T) *shareEnv {
	srv := newTestServer(t, "v0.0.0-test")
	srv.opts.UI = fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><html><head><title>Overseer</title></head><body><div id="root"></div></body></html>`)}}
	t.Cleanup(func() { srv.store.Close() })
	return &shareEnv{t: t, srv: srv, cookie: &http.Cookie{Name: sessionCookie, Value: srv.sessions.create()}}
}

func (e *shareEnv) do(method, path string, body any, auth bool) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.RemoteAddr = "203.0.113.9:5555"
	if auth {
		req.AddCookie(e.cookie)
	}
	w := httptest.NewRecorder()
	e.srv.mux.ServeHTTP(w, req)
	return w
}

func (e *shareEnv) seedThread() *Thread {
	e.t.Helper()
	th := &Thread{Id: "t1", Title: "Fix flaky auth tests", DeviceId: "d1", Agent: "claude", Cwd: "/Users/erzen/Projects/orbit-api", Access: "edits", Status: "idle", CreatedAt: 1, UpdatedAt: 1}
	if err := e.srv.store.CreateThread(th); err != nil {
		e.t.Fatal(err)
	}
	now := time.UnixMilli(1_700_000_000_000)
	ev := func(ev protocol.ThreadEvent, at time.Time) {
		if _, err := e.srv.store.ApplyThreadEvent("t1", ev, "u1", at); err != nil {
			e.t.Fatal(err)
		}
	}
	ev(protocol.ThreadEvent{Id: "u1", Role: "user", Text: "Fix the flaky auth tests in /Users/erzen/Projects/orbit-api"}, now)
	ev(protocol.ThreadEvent{Id: "k1", Role: "tool", Tool: &protocol.ThreadTool{Name: "bash", Title: "Run", Status: "completed", Input: "cat .env", Output: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\nfrom /Users/erzen/Projects/orbit-api/.env"}}, now.Add(time.Second))
	ev(protocol.ThreadEvent{Id: "e1", Role: "tool", Tool: &protocol.ThreadTool{Name: "edit", Title: "Edit", Status: "completed", Files: []protocol.ThreadToolFile{{Path: "/Users/erzen/Projects/orbit-api/a_test.go", Additions: 2, Deletions: 1, Diff: "@@ -1 +1,2 @@\n-a\n+b"}}}}, now.Add(2*time.Second))
	ev(protocol.ThreadEvent{Id: "p1", Role: "approval", Approval: &protocol.ThreadApprovalRequest{Id: "p1", Title: "Allow?", Options: []protocol.ApprovalOption{{Id: "y", Label: "Yes", Kind: "allow_once"}}}}, now.Add(3*time.Second))
	ev(protocol.ThreadEvent{Id: "q1", Role: "question", Question: &protocol.ThreadQuestion{Id: "q1", Text: "Which?", Options: []protocol.QuestionOption{{Id: "a", Label: "A"}}}}, now.Add(4*time.Second))
	ev(protocol.ThreadEvent{Id: "a1", Role: "assistant", Text: "Fixed it.", DurationMs: 130_000}, now.Add(5*time.Second))
	return th
}

type shareCreated struct {
	Share Share  `json:"share"`
	Token string `json:"token"`
	URL   string `json:"url"`
}

func (e *shareEnv) create(mode, expires string, hide bool) shareCreated {
	e.t.Helper()
	w := e.do("POST", "/api/shares", map[string]any{"threadId": "t1", "mode": mode, "hideNames": hide, "expires": expires}, true)
	if w.Code != 200 {
		e.t.Fatalf("create share: %d %s", w.Code, w.Body)
	}
	var out shareCreated
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		e.t.Fatal(err)
	}
	return out
}

func TestShareLifecycle(t *testing.T) {
	e := newShareEnv(t)
	e.seedThread()

	// Creating needs the hub login.
	if w := e.do("POST", "/api/shares", map[string]any{"threadId": "t1", "mode": "replay"}, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous create = %d", w.Code)
	}
	if w := e.do("GET", "/api/shares", nil, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list = %d", w.Code)
	}
	if w := e.do("POST", "/api/shares", map[string]any{"threadId": "t1", "mode": "nope"}, true); w.Code != http.StatusBadRequest {
		t.Fatalf("bad mode = %d", w.Code)
	}
	if w := e.do("POST", "/api/shares", map[string]any{"threadId": "missing", "mode": "replay"}, true); w.Code != http.StatusNotFound {
		t.Fatalf("missing thread = %d", w.Code)
	}

	replay := e.create("replay", "7d", true)
	if len(replay.Token) != 43 || !strings.HasSuffix(replay.URL, "/s/"+replay.Token) {
		t.Fatalf("token/url: %q %q", replay.Token, replay.URL)
	}
	var stored string
	e.srv.store.db.QueryRow(`SELECT token_hash FROM shares WHERE id = ?`, replay.Share.Id).Scan(&stored)
	if stored == replay.Token || stored != hashShareToken(replay.Token) {
		t.Errorf("token must be stored hashed, got %q", stored)
	}

	// A message that arrives after the snapshot is not in the replay.
	if _, err := e.srv.store.ApplyThreadEvent("t1", protocol.ThreadEvent{Id: "u2", Role: "user", Text: "now do something else"}, "", time.UnixMilli(1_700_000_100_000)); err != nil {
		t.Fatal(err)
	}

	w := e.do("GET", "/api/public/shares/"+replay.Token, nil, false)
	if w.Code != 200 {
		t.Fatalf("public replay = %d %s", w.Code, w.Body)
	}
	body := w.Body.String()
	for _, leak := range []string{"ghp_abcdefghijklmnopqrstuvwxyz", "/Users/erzen", "orbit-api", "approval", "Allow?", "Which?", "now do something else", `"d1"`, `"t1"`} {
		if strings.Contains(body, leak) {
			t.Errorf("public replay leaks %q:\n%s", leak, body)
		}
	}
	if w.Header().Get("Set-Cookie") != "" {
		t.Error("public response must not set cookies")
	}
	var pub publicShare
	json.Unmarshal(w.Body.Bytes(), &pub)
	if pub.Mode != "replay" || pub.Thread.Title != "Fix flaky auth tests" || pub.Thread.DeviceName != "" || pub.Thread.Cwd != "" {
		t.Errorf("thread = %+v", pub.Thread)
	}
	if pub.Summary.Steps != 2 || pub.Summary.Files != 1 || pub.Summary.Additions != 2 || pub.Summary.DurationMs != 130_000 {
		t.Errorf("summary = %+v", pub.Summary)
	}
	if len(pub.Messages) != 4 { // user, 2 tools, assistant
		t.Errorf("%d messages, want 4", len(pub.Messages))
	}

	// Live shows the later message and keeps names when asked to.
	live := e.create("live", "never", false)
	w = e.do("GET", "/api/public/shares/"+live.Token, nil, false)
	pub = publicShare{}
	json.Unmarshal(w.Body.Bytes(), &pub)
	if pub.Mode != "live" || pub.Thread.Cwd != "/Users/erzen/Projects/orbit-api" || len(pub.Messages) != 5 {
		t.Errorf("live = mode %s cwd %q %d messages", pub.Mode, pub.Thread.Cwd, len(pub.Messages))
	}
	if strings.Contains(w.Body.String(), "ghp_abcdefghijklmnopqrstuvwxyz") {
		t.Error("live must redact secrets too")
	}

	// The link page carries the preview tags and still has the UI bundle.
	w = e.do("GET", "/s/"+replay.Token, nil, false)
	page := w.Body.String()
	if w.Code != 200 || !strings.Contains(page, `<div id="root">`) ||
		!strings.Contains(page, `og:title" content="Claude Code fixed flaky auth tests in 2m 10s · Overseer"`) ||
		!strings.Contains(page, `twitter:card`) {
		t.Errorf("page %d:\n%s", w.Code, page)
	}
	if strings.Contains(page, "orbit-api") || w.Header().Get("X-Robots-Tag") == "" {
		t.Errorf("page leaks names or lacks noindex")
	}

	// Views count page loads of the JSON, not previews.
	e.do("GET", "/api/public/shares/"+replay.Token+"?peek=1", nil, false)
	var views int64
	e.srv.store.db.QueryRow(`SELECT views FROM shares WHERE id = ?`, replay.Share.Id).Scan(&views)
	if views != 1 {
		t.Errorf("views = %d, want 1", views)
	}

	// The list shows both, newest first, without anything secret.
	w = e.do("GET", "/api/shares", nil, true)
	var list []Share
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 2 || list[0].Title != "Fix flaky auth tests" || strings.Contains(w.Body.String(), replay.Token) {
		t.Errorf("list = %s", w.Body)
	}

	// Revoking ends the link.
	if w := e.do("DELETE", "/api/shares/"+replay.Share.Id, nil, true); w.Code != 200 {
		t.Fatalf("revoke = %d", w.Code)
	}
	for _, path := range []string{"/api/public/shares/" + replay.Token, "/s/" + replay.Token} {
		w = e.do("GET", path, nil, false)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s after revoke = %d", path, w.Code)
		}
	}
	if w = e.do("GET", "/s/"+replay.Token, nil, false); !strings.Contains(w.Body.String(), "This link has expired") {
		t.Error("expired page should say so")
	}

	// Expired and unknown links look the same.
	e.srv.store.db.Exec(`UPDATE shares SET expires_at = ? WHERE id = ?`, time.Now().Unix()-5, live.Share.Id)
	if w = e.do("GET", "/api/public/shares/"+live.Token, nil, false); w.Code != http.StatusNotFound {
		t.Errorf("expired = %d", w.Code)
	}
	if w = e.do("GET", "/api/public/shares/not-a-real-token-at-all-xxxxxxxxxxxxxxxx", nil, false); w.Code != http.StatusNotFound {
		t.Errorf("unknown = %d", w.Code)
	}

	// Public routes expose nothing else.
	for _, path := range []string{"/api/threads", "/api/threads/t1", "/api/devices", "/api/shares"} {
		if w = e.do("GET", path, nil, false); w.Code != http.StatusUnauthorized {
			t.Errorf("%s without login = %d", path, w.Code)
		}
	}
}

func TestShareGoneWithSession(t *testing.T) {
	e := newShareEnv(t)
	e.seedThread()
	link := e.create("replay", "never", true)
	if err := e.srv.store.DeleteThread("t1"); err != nil {
		t.Fatal(err)
	}
	if w := e.do("GET", "/api/public/shares/"+link.Token, nil, false); w.Code != http.StatusNotFound {
		t.Errorf("share of a deleted session = %d", w.Code)
	}
	w := e.do("GET", "/api/shares", nil, true)
	var list []Share
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Errorf("orphan share still listed: %s", w.Body)
	}
}

func TestShareRateLimit(t *testing.T) {
	e := newShareEnv(t)
	for i := 0; i < 31; i++ {
		w := e.do("GET", "/api/public/shares/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil, false)
		if i < 30 && w.Code != http.StatusNotFound {
			t.Fatalf("miss %d = %d", i, w.Code)
		}
		if i == 30 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("miss %d = %d, want 429", i, w.Code)
		}
	}
}

// The live stream sends a snapshot, then messages, and never approvals.
func TestShareLiveStream(t *testing.T) {
	e := newShareEnv(t)
	e.seedThread()
	link := e.create("live", "never", true)
	ts := httptest.NewServer(e.srv.mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/public/shares/" + link.Token + "/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream = %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	events := make(chan [2]string, 16)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		var name string
		for sc.Scan() {
			line := sc.Text()
			if v, ok := strings.CutPrefix(line, "event: "); ok {
				name = v
			} else if v, ok := strings.CutPrefix(line, "data: "); ok {
				events <- [2]string{name, v}
			}
		}
		close(events)
	}()
	next := func() [2]string {
		select {
		case ev := <-events:
			return ev
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for an event")
			return [2]string{}
		}
	}
	if ev := next(); ev[0] != "snapshot" || strings.Contains(ev[1], "Allow?") || strings.Contains(ev[1], "ghp_abc") {
		t.Fatalf("first event = %v", ev)
	}
	// The snapshot arrives once the handler has subscribed.
	e.srv.threads.appendEvent("t1", protocol.ThreadEvent{Id: "p2", Role: "approval", Approval: &protocol.ThreadApprovalRequest{Id: "p2", Title: "Secret approval"}})
	e.srv.threads.appendEvent("t1", protocol.ThreadEvent{Id: "a2", Role: "assistant", Text: "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 done"})
	ev := next()
	for ev[0] == "thread" { // the session's own update arrives alongside
		if strings.Contains(ev[1], "Secret approval") || strings.Contains(ev[1], "orbit-api") {
			t.Fatalf("thread event leaks: %v", ev)
		}
		ev = next()
	}
	if ev[0] != "message" || !strings.Contains(ev[1], "done") || strings.Contains(ev[1], "ghp_abc") || strings.Contains(ev[1], "Secret approval") {
		t.Fatalf("message event = %v", ev)
	}

	// Revoking closes the stream's link for new viewers at once.
	e.do("DELETE", "/api/shares/"+link.Share.Id, nil, true)
	if r2, err := http.Get(ts.URL + "/api/public/shares/" + link.Token + "/stream"); err != nil || r2.StatusCode != 404 {
		t.Errorf("stream after revoke: %v %v", err, r2)
	}
}
