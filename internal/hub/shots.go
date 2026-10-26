package hub

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Before/after screenshots of a session's live preview.
//
// When a session has a dev server running in its own folder, the hub asks that
// machine's headless Chrome for a picture the first time the server shows up
// (the "before") and again when the agent's turn ends (the "after"). The
// pictures are kept here, in the hub's database, a few per session, and shown
// in the session's Changes panel. When a pull request is opened from the
// session, they are added to it as a comment, but only if the hub has a public
// https address GitHub can load them from; nothing is ever uploaded anywhere
// else.

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS thread_shots (
	id         TEXT PRIMARY KEY,
	thread_id  TEXT NOT NULL,
	kind       TEXT NOT NULL,
	form       TEXT NOT NULL DEFAULT 'desktop',
	turn       TEXT NOT NULL DEFAULT '',
	port       INTEGER NOT NULL DEFAULT 0,
	path       TEXT NOT NULL DEFAULT '/',
	mime       TEXT NOT NULL,
	width      INTEGER NOT NULL DEFAULT 0,
	height     INTEGER NOT NULL DEFAULT 0,
	size       INTEGER NOT NULL DEFAULT 0,
	token      TEXT NOT NULL,
	note       TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	data       BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS thread_shots_thread ON thread_shots(thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS thread_shots_token ON thread_shots(token);
CREATE TABLE IF NOT EXISTS thread_shot_info (
	thread_id  TEXT PRIMARY KEY,
	status     TEXT NOT NULL DEFAULT '',
	note       TEXT NOT NULL DEFAULT '',
	pr_url     TEXT NOT NULL DEFAULT '',
	pr_state   TEXT NOT NULL DEFAULT '',
	pr_reason  TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL DEFAULT 0
);
`)
}

const (
	settingShotsEnabled   = "shots_enabled"    // "0" turns screenshots off
	settingShotsPhone     = "shots_phone"      // "1" adds a phone-size picture
	settingShotsPRComment = "shots_pr_comment" // "0" keeps pictures out of pull requests

	shotMaxBytes    = 1536 * 1024       // one picture
	shotsMaxTotal   = 400 * 1024 * 1024 // all pictures together
	shotPublicTTL   = 180 * 24 * time.Hour
	shotCallTimeout = 75 * time.Second
	shotBeforeTries = 6
)

// Timings. Variables so tests can shorten them.
var (
	shotPortsTTL     = 3 * time.Second
	shotsTickEvery   = 5 * time.Second
	shotRetryAfter   = 12 * time.Second
	shotPRCheckEvery = 20 * time.Second
)

// shotsConfig is what the user can switch.
type shotsConfig struct {
	Enabled   bool `json:"enabled"`
	Phone     bool `json:"phone"`
	PRComment bool `json:"prComment"`
}

func (s *Server) shotsConfig() shotsConfig {
	get := func(key string) string { v, _ := s.store.Setting(key); return v }
	return shotsConfig{Enabled: get(settingShotsEnabled) != "0", Phone: get(settingShotsPhone) == "1", PRComment: get(settingShotsPRComment) != "0"}
}

// threadShot is one stored picture (without its bytes).
type threadShot struct {
	Id        string `json:"id"`
	ThreadId  string `json:"threadId"`
	Kind      string `json:"kind"` // before | after
	Form      string `json:"form"` // desktop | phone
	Turn      string `json:"turn,omitempty"`
	Port      int    `json:"port,omitempty"`
	Path      string `json:"path,omitempty"`
	Mime      string `json:"mime"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	Size      int    `json:"size"`
	Note      string `json:"note,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	Url       string `json:"url"`
	Token     string `json:"-"`
}

// shotInfo is what is known about a session's screenshots besides the
// pictures: why there are none, and what happened with the pull request.
type shotInfo struct {
	Status string `json:"status,omitempty"` // "", no-browser, no-preview, error
	Note   string `json:"note,omitempty"`
	PR     struct {
		State  string `json:"state,omitempty"` // commented | skipped | failed
		Url    string `json:"url,omitempty"`
		Reason string `json:"reason,omitempty"`
	} `json:"pr"`
}

type shotsState struct {
	mu       sync.Mutex
	last     map[string]string    // thread -> status at the last look
	tries    map[string]int       // thread -> failed attempts at a "before"
	nextTry  map[string]time.Time // thread -> not before
	ports    map[string]shotPorts // device -> recent port list
	prCheck  map[string]time.Time // thread -> last pull request lookup
	inflight map[string]bool      // thread -> a "before" job is running
	threadMu map[string]*sync.Mutex
	deviceMu map[string]*sync.Mutex
	homes    map[string]string // device -> home folder
}

type shotPorts struct {
	at    time.Time
	ports []protocol.PortInfo
}

func (s *Server) shotsThreadLock(id string) *sync.Mutex {
	s.shots.mu.Lock()
	defer s.shots.mu.Unlock()
	if s.shots.threadMu == nil {
		s.shots.threadMu = map[string]*sync.Mutex{}
	}
	m := s.shots.threadMu[id]
	if m == nil {
		m = &sync.Mutex{}
		s.shots.threadMu[id] = m
	}
	return m
}

func (s *Server) shotsDeviceLock(id string) *sync.Mutex {
	s.shots.mu.Lock()
	defer s.shots.mu.Unlock()
	if s.shots.deviceMu == nil {
		s.shots.deviceMu = map[string]*sync.Mutex{}
	}
	m := s.shots.deviceMu[id]
	if m == nil {
		m = &sync.Mutex{}
		s.shots.deviceMu[id] = m
	}
	return m
}

// ---- store ----

const shotColumns = `id, thread_id, kind, form, turn, port, path, mime, width, height, size, token, note, created_at`

func scanShot(row rowScanner) (*threadShot, error) {
	var sh threadShot
	if err := row.Scan(&sh.Id, &sh.ThreadId, &sh.Kind, &sh.Form, &sh.Turn, &sh.Port, &sh.Path, &sh.Mime, &sh.Width, &sh.Height, &sh.Size, &sh.Token, &sh.Note, &sh.CreatedAt); err != nil {
		return nil, err
	}
	sh.Url = "/api/shots/img/" + sh.Id
	return &sh, nil
}

func (s *Store) shotsOf(threadId string) ([]threadShot, error) {
	rows, err := s.db.Query(`SELECT `+shotColumns+` FROM thread_shots WHERE thread_id = ? ORDER BY created_at, id`, threadId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []threadShot{}
	for rows.Next() {
		sh, err := scanShot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sh)
	}
	return out, rows.Err()
}

// shotPut stores a picture. A "before" keeps the first one taken (unless
// replace is set); an "after" replaces the previous one of its form.
func (s *Store) shotPut(sh threadShot, data []byte, replace bool) (bool, error) {
	if sh.Kind == "before" && !replace {
		var n int
		s.db.QueryRow(`SELECT COUNT(*) FROM thread_shots WHERE thread_id = ? AND kind = 'before' AND form = ?`, sh.ThreadId, sh.Form).Scan(&n)
		if n > 0 {
			return false, nil
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM thread_shots WHERE thread_id = ? AND kind = ? AND form = ?`, sh.ThreadId, sh.Kind, sh.Form); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`INSERT INTO thread_shots (`+shotColumns+`, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		sh.Id, sh.ThreadId, sh.Kind, sh.Form, sh.Turn, sh.Port, sh.Path, sh.Mime, sh.Width, sh.Height, len(data), sh.Token, sh.Note, sh.CreatedAt, data); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// shotsPrune drops pictures of deleted sessions, then the oldest ones while
// the total is over the limit.
func (s *Store) shotsPrune() {
	s.db.Exec(`DELETE FROM thread_shots WHERE thread_id NOT IN (SELECT id FROM threads)`)
	s.db.Exec(`DELETE FROM thread_shot_info WHERE thread_id NOT IN (SELECT id FROM threads)`)
	for i := 0; i < 50; i++ {
		var total sql.NullInt64
		s.db.QueryRow(`SELECT SUM(size) FROM thread_shots`).Scan(&total)
		if total.Int64 <= shotsMaxTotal {
			return
		}
		s.db.Exec(`DELETE FROM thread_shots WHERE thread_id = (SELECT thread_id FROM thread_shots ORDER BY created_at LIMIT 1)`)
	}
}

func (s *Store) shotInfoOf(threadId string) shotInfo {
	var info shotInfo
	s.db.QueryRow(`SELECT status, note, pr_url, pr_state, pr_reason FROM thread_shot_info WHERE thread_id = ?`, threadId).
		Scan(&info.Status, &info.Note, &info.PR.Url, &info.PR.State, &info.PR.Reason)
	return info
}

func (s *Store) shotInfoSet(threadId, status, note string) {
	s.db.Exec(`INSERT INTO thread_shot_info (thread_id, status, note, updated_at) VALUES (?,?,?,?)
		ON CONFLICT(thread_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
		threadId, status, note, time.Now().Unix())
}

func (s *Store) shotInfoPR(threadId, prURL, state, reason string) {
	s.db.Exec(`INSERT INTO thread_shot_info (thread_id, pr_url, pr_state, pr_reason, updated_at) VALUES (?,?,?,?,?)
		ON CONFLICT(thread_id) DO UPDATE SET pr_url = excluded.pr_url, pr_state = excluded.pr_state, pr_reason = excluded.pr_reason, updated_at = excluded.updated_at`,
		threadId, prURL, state, reason, time.Now().Unix())
}

// ---- finding the preview ----

// shotCwdOK refuses a session folder so broad that "a server running inside
// it" says nothing: a home folder or a drive root.
func shotCwdOK(cwd string) bool {
	p := strings.ReplaceAll(strings.TrimSpace(cwd), "\\", "/")
	if len(p) >= 2 && p[1] == ':' {
		p = p[2:]
	}
	if strings.HasPrefix(p, "~/") {
		p = "/home/x/" + p[2:] // "~/app" is as deep as "/home/x/app"
	}
	parts := 0
	for _, seg := range strings.Split(p, "/") {
		if seg != "" {
			parts++
		}
	}
	return parts >= 3
}

// pathWithin reports whether p is dir or inside it, on any OS's paths.
func pathWithin(dir, p string) bool {
	norm := func(x string) string {
		x = strings.ReplaceAll(strings.TrimSpace(x), "\\", "/")
		if len(x) >= 2 && x[1] == ':' {
			x = strings.ToLower(x[:1]) + x[1:]
		}
		return strings.TrimRight(x, "/")
	}
	dir, p = norm(dir), norm(p)
	return dir != "" && (p == dir || strings.HasPrefix(p, dir+"/"))
}

// shotsDeviceHome finds a machine's home folder, to read "~/…" session folders.
func (s *Server) shotsDeviceHome(c *agentConn) string {
	s.shots.mu.Lock()
	home := s.shots.homes[c.deviceId]
	s.shots.mu.Unlock()
	if home != "" {
		return home
	}
	res, err := s.execOnDevice(c, "echo $HOME", "", 10)
	if err != nil || res.ExitCode != 0 {
		return ""
	}
	home = strings.TrimSpace(res.Stdout)
	if home == "" || strings.Contains(home, "\n") {
		return ""
	}
	s.shots.mu.Lock()
	if s.shots.homes == nil {
		s.shots.homes = map[string]string{}
	}
	s.shots.homes[c.deviceId] = home
	s.shots.mu.Unlock()
	return home
}

func (s *Server) shotsPorts(c *agentConn) ([]protocol.PortInfo, error) {
	s.shots.mu.Lock()
	cached, ok := s.shots.ports[c.deviceId]
	s.shots.mu.Unlock()
	if ok && time.Since(cached.at) < shotPortsTTL {
		return cached.ports, nil
	}
	ctx, cancel := contextWithTimeout(portsListTimeout)
	defer cancel()
	var ports []protocol.PortInfo
	if err := c.requestInto(ctx, protocol.TypePortsList, struct{}{}, &ports); err != nil {
		return nil, err
	}
	s.shots.mu.Lock()
	if s.shots.ports == nil {
		s.shots.ports = map[string]shotPorts{}
	}
	s.shots.ports[c.deviceId] = shotPorts{at: time.Now(), ports: ports}
	s.shots.mu.Unlock()
	return ports, nil
}

// shotsFindPreview returns the port of a web server running inside the
// session's folder. Servers elsewhere on the machine are never captured.
func (s *Server) shotsFindPreview(c *agentConn, t *Thread) (int, error) {
	if !shotCwdOK(t.Cwd) {
		return 0, nil
	}
	cwd := t.Cwd
	if strings.HasPrefix(cwd, "~") {
		home := s.shotsDeviceHome(c)
		if home == "" {
			return 0, nil
		}
		cwd = strings.TrimRight(home, "/") + strings.TrimPrefix(cwd, "~")
	}
	ports, err := s.shotsPorts(c)
	if err != nil {
		return 0, err
	}
	best, bestScore := 0, -1
	for _, p := range ports {
		if !p.Http || p.Cwd == "" || !pathWithin(cwd, p.Cwd) {
			continue
		}
		// A page with a title is more likely the app than its API; deeper
		// folders and lower ports break ties.
		score := 0
		if p.Title != "" {
			score += 1000
		}
		score -= p.Port / 100
		if score > bestScore {
			best, bestScore = p.Port, score
		}
	}
	return best, nil
}

// ---- capturing ----

type shotOutcome struct {
	Taken  []threadShot
	Status string // "", off, offline, no-preview, no-browser, error
	Note   string
}

// shotsCapture takes the pictures of one kind for a session: desktop, and a
// phone one when that is switched on. It never returns an error: what went
// wrong is in the outcome and in the session's shot info.
func (s *Server) shotsCapture(ctx context.Context, threadId, kind string, replace bool) shotOutcome {
	cfg := s.shotsConfig()
	if !cfg.Enabled {
		return shotOutcome{Status: "off"}
	}
	lock := s.shotsThreadLock(threadId)
	lock.Lock()
	defer lock.Unlock()
	if kind == "before" && !replace {
		// A second job queued behind the first finds the picture already taken.
		if shots, _ := s.store.shotsOf(threadId); len(shots) > 0 {
			return shotOutcome{}
		}
	}
	t, err := s.store.ThreadById(threadId)
	if err != nil || t == nil {
		return shotOutcome{Status: "error", Note: "The session is gone."}
	}
	c := s.registry.get(t.DeviceId)
	if c == nil {
		return shotOutcome{Status: "offline", Note: "The machine is offline."}
	}
	port, err := s.shotsFindPreview(c, t)
	if err != nil {
		return shotOutcome{Status: "error", Note: "Could not look for a preview: " + apOneLine(err.Error(), 120)}
	}
	if port == 0 {
		return shotOutcome{Status: "no-preview", Note: "No web server is running in this session's folder."}
	}

	dev := s.shotsDeviceLock(c.deviceId)
	dev.Lock()
	defer dev.Unlock()
	forms := []string{"desktop"}
	if cfg.Phone {
		forms = append(forms, "phone")
	}
	note := ""
	if kind == "before" {
		note = s.shotsDirtyNote(c, t)
	}
	turn := s.threads.currentTurn(threadId)
	var out shotOutcome
	for _, form := range forms {
		req := protocol.ScreenshotRequest{Url: fmt.Sprintf("http://localhost:%d/", port), Mobile: form == "phone"}
		var res protocol.ScreenshotResult
		rctx, cancel := context.WithTimeout(ctx, shotCallTimeout)
		err := c.requestInto(rctx, protocol.TypeScreenshot, req, &res)
		cancel()
		switch {
		case err != nil && strings.Contains(err.Error(), "unsupported request"):
			out.Status, out.Note = "error", "This machine's agent is too old to take screenshots; update it."
		case err != nil:
			out.Status, out.Note = "error", "The screenshot did not arrive: "+apOneLine(err.Error(), 120)
		case res.Status == protocol.ShotNoBrowser:
			out.Status, out.Note = "no-browser", "No Chrome, Chromium or Edge is installed on "+t.DeviceName+", so screenshots are skipped."
		case res.Status != protocol.ShotOK:
			out.Status, out.Note = "error", apOneLine(res.Message, 200)
		case len(res.Data) == 0 || len(res.Data) > shotMaxBytes:
			out.Status, out.Note = "error", "The screenshot was empty or too large."
		default:
			sh := threadShot{Id: randomToken()[:16], ThreadId: threadId, Kind: kind, Form: form, Turn: turn, Port: port, Path: "/", Mime: res.Mime,
				Width: res.Width, Height: res.Height, Note: note, CreatedAt: time.Now().Unix(), Token: randomToken()[:32]}
			if sh.Mime != "image/png" && sh.Mime != "image/jpeg" {
				out.Status, out.Note = "error", "The screenshot was not a picture."
				continue
			}
			if stored, err := s.store.shotPut(sh, res.Data, replace); err == nil && stored {
				sh.Url = "/api/shots/img/" + sh.Id
				sh.Size = len(res.Data)
				out.Taken = append(out.Taken, sh)
			} else if err != nil {
				out.Status, out.Note = "error", "Could not keep the screenshot."
			}
		}
		if out.Status == "no-browser" {
			break
		}
	}
	if len(out.Taken) > 0 {
		out.Status, out.Note = "", ""
		s.store.shotsPrune()
	}
	s.store.shotInfoSet(threadId, out.Status, out.Note)
	return out
}

// shotsDirtyNote says so when the agent had already edited files by the time
// the "before" picture was taken.
func (s *Server) shotsDirtyNote(c *agentConn, t *Thread) string {
	cwd := t.Cwd
	if strings.HasPrefix(cwd, "~") {
		if home := s.shotsDeviceHome(c); home != "" {
			cwd = strings.TrimRight(home, "/") + strings.TrimPrefix(cwd, "~")
		}
	}
	res, err := s.execOnDevice(c, "git status --porcelain", cwd, 10)
	if err != nil || res.ExitCode != 0 {
		return ""
	}
	n := 0
	for _, line := range strings.Split(res.Stdout, "\n") {
		if strings.TrimSpace(line) != "" {
			n++
		}
	}
	switch {
	case n == 1:
		return "Taken when the preview first appeared. 1 file had already changed."
	case n > 1:
		return fmt.Sprintf("Taken when the preview first appeared. %d files had already changed.", n)
	}
	return ""
}

// shotsEnsureAfter takes the "after" pictures for the session's latest turn
// unless they were already taken for it. The autopilot calls it before
// opening a pull request.
func (s *Server) shotsEnsureAfter(ctx context.Context, threadId string) {
	if !s.shotsConfig().Enabled {
		return
	}
	turn := s.threads.currentTurn(threadId)
	if shots, _ := s.store.shotsOf(threadId); turn != "" {
		for _, sh := range shots {
			if sh.Kind == "after" && sh.Turn == turn {
				return
			}
		}
	}
	s.shotsCapture(ctx, threadId, "after", false)
}

// ---- watching sessions ----

func (s *Server) runShots(ctx context.Context) {
	ticker := time.NewTicker(shotsTickEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.shotsTick(ctx)
	}
}

func shotActive(status string) bool {
	return status == "starting" || status == "working" || status == "waiting"
}

type shotThreadRow struct{ id, status string }

// shotsTick looks at the sessions that are running or just changed. It is
// cheap when nothing is happening: one small query.
func (s *Server) shotsTick(ctx context.Context) {
	if !s.shotsConfig().Enabled {
		return
	}
	rows, err := s.store.db.Query(`SELECT id, status FROM threads WHERE status IN ('starting','working','waiting') OR updated_at >= ?`, time.Now().Add(-30*time.Second).Unix())
	if err != nil {
		return
	}
	var threads []shotThreadRow
	for rows.Next() {
		var r shotThreadRow
		if rows.Scan(&r.id, &r.status) == nil {
			threads = append(threads, r)
		}
	}
	rows.Close()

	s.shots.mu.Lock()
	if s.shots.last == nil {
		s.shots.last = map[string]string{}
	}
	type job struct{ id, what string }
	var jobs []job
	now := time.Now()
	for _, r := range threads {
		prev, seen := s.shots.last[r.id]
		s.shots.last[r.id] = r.status
		switch {
		case shotActive(r.status):
			if s.shots.nextTry[r.id].After(now) || s.shots.tries[r.id] >= shotBeforeTries || s.shots.inflight[r.id] {
				continue
			}
			if s.shots.inflight == nil {
				s.shots.inflight = map[string]bool{}
			}
			s.shots.inflight[r.id] = true
			jobs = append(jobs, job{r.id, "before"})
		case seen && shotActive(prev) && r.status == "idle":
			jobs = append(jobs, job{r.id, "after"})
		}
	}
	listed := map[string]bool{}
	for _, r := range threads {
		listed[r.id] = true
	}
	for id := range s.shots.last { // forget sessions that have been quiet a while
		if !listed[id] {
			delete(s.shots.last, id)
			delete(s.shots.tries, id)
			delete(s.shots.nextTry, id)
		}
	}
	s.shots.mu.Unlock()

	for _, j := range jobs {
		j := j
		go s.shotsJob(ctx, j.id, j.what)
	}
}

func (s *Server) shotsJob(ctx context.Context, threadId, what string) {
	if what == "after" {
		s.shotsEnsureAfter(ctx, threadId)
		s.shotsAfterTurn(ctx, threadId)
		return
	}
	// "before": only while the session has no picture yet.
	defer func() {
		s.shots.mu.Lock()
		delete(s.shots.inflight, threadId)
		s.shots.mu.Unlock()
	}()
	if shots, _ := s.store.shotsOf(threadId); len(shots) > 0 {
		s.shots.mu.Lock()
		if s.shots.tries == nil {
			s.shots.tries = map[string]int{}
		}
		s.shots.tries[threadId] = shotBeforeTries
		s.shots.mu.Unlock()
		return
	}
	out := s.shotsCapture(ctx, threadId, "before", false)
	s.shots.mu.Lock()
	defer s.shots.mu.Unlock()
	if s.shots.tries == nil {
		s.shots.tries = map[string]int{}
		s.shots.nextTry = map[string]time.Time{}
	}
	if s.shots.nextTry == nil {
		s.shots.nextTry = map[string]time.Time{}
	}
	switch {
	case len(out.Taken) > 0 || out.Status == "no-browser":
		s.shots.tries[threadId] = shotBeforeTries // done, or pointless to try again
	case out.Status == "no-preview" || out.Status == "offline":
		s.shots.nextTry[threadId] = time.Now().Add(shotRetryAfter) // no server yet: keep looking, at no cost to the count
	default:
		s.shots.tries[threadId]++
		s.shots.nextTry[threadId] = time.Now().Add(shotRetryAfter)
	}
}

// ---- pull request comment ----

// publicShotBase is the address GitHub can load pictures from: the hub's own
// public https address. The reason is for the UI when there is none.
func (s *Server) publicShotBase() (base, reason string) {
	raw := strings.TrimRight(s.hubPublicURL(), "/")
	if raw == "" || raw == s.internalURL {
		return "", "This hub does not know a public address yet. Open it once at the address you normally use."
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "This hub's public address is not valid."
	}
	if u.Scheme != "https" {
		return "", "This hub is reached over http, so GitHub could not load pictures from it. It needs a public https address."
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil || !strings.Contains(host, ".") {
		return "", "This hub has no public https address (it is reached at " + host + "), so GitHub could not load pictures from it."
	}
	for _, suffix := range []string{".local", ".lan", ".internal", ".localhost", ".home.arpa", ".test", ".example", ".invalid"} {
		if strings.HasSuffix(host, suffix) {
			return "", "This hub's address (" + host + ") is only reachable on your own network, so GitHub could not load pictures from it."
		}
	}
	return u.Scheme + "://" + u.Host, ""
}

// shotsCommentBody is the markdown for the pull request.
func shotsCommentBody(base string, shots []threadShot) string {
	find := func(kind, form string) *threadShot {
		for i := range shots {
			if shots[i].Kind == kind && shots[i].Form == form {
				return &shots[i]
			}
		}
		return nil
	}
	img := func(sh *threadShot, alt string, width int) string {
		if sh == nil {
			return "_none_"
		}
		ext := ".png"
		if sh.Mime == "image/jpeg" {
			ext = ".jpg"
		}
		return fmt.Sprintf(`<img src="%s/api/shots/pub/%s%s" alt="%s" width="%d">`, base, sh.Token, ext, alt, width)
	}
	var b strings.Builder
	b.WriteString("### Before and after\n\n| Before | After |\n| :---: | :---: |\n")
	fmt.Fprintf(&b, "| %s | %s |\n", img(find("before", "desktop"), "Before", 440), img(find("after", "desktop"), "After", 440))
	if find("before", "phone") != nil || find("after", "phone") != nil {
		b.WriteString("\n**Phone**\n\n| Before | After |\n| :---: | :---: |\n")
		fmt.Fprintf(&b, "| %s | %s |\n", img(find("before", "phone"), "Before (phone)", 200), img(find("after", "phone"), "After (phone)", 200))
	}
	b.WriteString("\n<sub>Screenshots taken by [Overseer](https://overseer.sh) from the dev server the agent ran. They are served by the hub that ran this session.</sub>\n")
	return b.String()
}

// shotsOnPullRequest adds the pictures to a pull request, if they exist and
// the hub can host them. The reason it did not is kept for the UI.
func (s *Server) shotsOnPullRequest(ctx context.Context, threadId, repo string, number int) {
	t, err := s.store.ThreadById(threadId)
	if err != nil || t == nil {
		return
	}
	prURL := fmt.Sprintf("https://github.com/%s/pull/%d", repo, number)
	shots, _ := s.store.shotsOf(threadId)
	var before, after bool
	for _, sh := range shots {
		before = before || sh.Kind == "before"
		after = after || sh.Kind == "after"
	}
	if !before || !after {
		return // nothing to compare: say nothing
	}
	info := s.store.shotInfoOf(threadId)
	if info.PR.State == "commented" && info.PR.Url == prURL {
		return
	}
	cfg := s.shotsConfig()
	if !cfg.PRComment {
		s.store.shotInfoPR(threadId, prURL, "skipped", "Adding screenshots to pull requests is turned off.")
		return
	}
	base, reason := s.publicShotBase()
	if base == "" {
		s.store.shotInfoPR(threadId, prURL, "skipped", reason)
		return
	}
	_, err = s.apGh(t.DeviceId, []string{"pr", "comment", fmt.Sprint(number), "-R", repo, "--body-file", "-"}, shotsCommentBody(base, shots), t.Cwd, 45)
	if err != nil {
		s.store.shotInfoPR(threadId, prURL, "failed", "Could not comment on the pull request: "+apOneLine(err.Error(), 160))
		return
	}
	s.store.shotInfoPR(threadId, prURL, "commented", "")
}

// shotsAfterTurn looks for a pull request the session opened itself (the /pr
// command) and, if there is one, adds the pictures to it.
func (s *Server) shotsAfterTurn(ctx context.Context, threadId string) {
	shots, _ := s.store.shotsOf(threadId)
	if len(shots) == 0 {
		return
	}
	s.shots.mu.Lock()
	if s.shots.prCheck == nil {
		s.shots.prCheck = map[string]time.Time{}
	}
	if time.Since(s.shots.prCheck[threadId]) < shotPRCheckEvery {
		s.shots.mu.Unlock()
		return
	}
	s.shots.prCheck[threadId] = time.Now()
	s.shots.mu.Unlock()
	t, err := s.store.ThreadById(threadId)
	if err != nil || t == nil || s.registry.get(t.DeviceId) == nil {
		return
	}
	cwd := t.Cwd
	if strings.HasPrefix(cwd, "~") {
		if c := s.registry.get(t.DeviceId); c != nil {
			if home := s.shotsDeviceHome(c); home != "" {
				cwd = strings.TrimRight(home, "/") + strings.TrimPrefix(cwd, "~")
			}
		}
	}
	out, err := s.apGh(t.DeviceId, []string{"pr", "view", "--json", "number,url,state"}, "", cwd, 30)
	if err != nil {
		return // no pull request yet, or no gh here: nothing to say
	}
	repo, number, state := parsePRView(out)
	if repo == "" || state != "OPEN" {
		return
	}
	s.shotsOnPullRequest(ctx, threadId, repo, number)
}

// ---- HTTP ----

func (s *Server) routesShots(m *http.ServeMux) {
	m.HandleFunc("GET /api/threads/{id}/shots", s.requireAuth(s.handleShotsList))
	m.HandleFunc("POST /api/threads/{id}/shots", s.requireAuth(s.handleShotsCapture))
	m.HandleFunc("DELETE /api/threads/{id}/shots", s.requireAuth(s.handleShotsClear))
	m.HandleFunc("GET /api/shots/img/{id}", s.requireAuth(s.handleShotImage))
	m.HandleFunc("GET /api/shots/config", s.requireAuth(s.handleShotsConfigGet))
	m.HandleFunc("PUT /api/shots/config", s.requireAuth(s.handleShotsConfigPut))
	// Public: the token in the address is the only key.
	m.HandleFunc("GET /api/shots/pub/{file}", s.handleShotPublic)
}

type shotsReply struct {
	Shots        []threadShot `json:"shots"`
	Info         shotInfo     `json:"info"`
	Config       shotsConfig  `json:"config"`
	PublicBase   string       `json:"publicBase,omitempty"`
	PublicReason string       `json:"publicReason,omitempty"`
}

func (s *Server) shotsReplyFor(threadId string) (shotsReply, error) {
	shots, err := s.store.shotsOf(threadId)
	if err != nil {
		return shotsReply{}, err
	}
	reply := shotsReply{Shots: shots, Info: s.store.shotInfoOf(threadId), Config: s.shotsConfig()}
	reply.PublicBase, reply.PublicReason = s.publicShotBase()
	return reply, nil
}

func (s *Server) handleShotsList(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	reply, err := s.shotsReplyFor(t.Id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, reply)
}

// handleShotsCapture is the "Take one now" button: it captures the preview
// the same way the automatic path does, and answers when it is done.
func (s *Server) handleShotsCapture(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var body struct {
		Kind string `json:"kind"`
	}
	if err := readJSON(r, &body); err != nil || (body.Kind != "before" && body.Kind != "after") {
		httpError(w, http.StatusBadRequest, "kind must be before or after")
		return
	}
	if !s.shotsConfig().Enabled {
		httpError(w, http.StatusConflict, "screenshots are turned off")
		return
	}
	out := s.shotsCapture(r.Context(), t.Id, body.Kind, true)
	reply, err := s.shotsReplyFor(t.Id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(out.Taken) == 0 && out.Note != "" {
		reply.Info.Status, reply.Info.Note = out.Status, out.Note
	}
	if len(out.Taken) > 0 && body.Kind == "after" {
		go s.shotsAfterTurn(context.Background(), t.Id)
	}
	writeJSON(w, reply)
}

func (s *Server) handleShotsClear(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	s.store.db.Exec(`DELETE FROM thread_shots WHERE thread_id = ?`, t.Id)
	s.store.db.Exec(`DELETE FROM thread_shot_info WHERE thread_id = ?`, t.Id)
	s.shots.mu.Lock()
	delete(s.shots.tries, t.Id)
	s.shots.mu.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) serveShot(w http.ResponseWriter, mime string, data []byte, cache string) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", cache)
	w.Header().Set("Content-Security-Policy", "default-src 'none'")
	w.Write(data)
}

func (s *Server) handleShotImage(w http.ResponseWriter, r *http.Request) {
	var mime string
	var data []byte
	err := s.store.db.QueryRow(`SELECT mime, data FROM thread_shots WHERE id = ?`, r.PathValue("id")).Scan(&mime, &data)
	if errors.Is(err, sql.ErrNoRows) {
		httpError(w, http.StatusNotFound, "no such picture")
		return
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.serveShot(w, mime, data, "private, max-age=3600")
}

// handleShotPublic serves a picture to GitHub. The address holds a random
// 128-bit token; it works while the session exists and for 180 days.
func (s *Server) handleShotPublic(w http.ResponseWriter, r *http.Request) {
	file := r.PathValue("file")
	token := strings.TrimSuffix(strings.TrimSuffix(file, ".png"), ".jpg")
	if len(token) != 32 || strings.Trim(token, "0123456789abcdef") != "" {
		http.NotFound(w, r)
		return
	}
	var mime string
	var data []byte
	var created int64
	err := s.store.db.QueryRow(`SELECT s.mime, s.data, s.created_at FROM thread_shots s JOIN threads t ON t.id = s.thread_id WHERE s.token = ?`, token).Scan(&mime, &data, &created)
	if err != nil || time.Since(time.Unix(created, 0)) > shotPublicTTL {
		http.NotFound(w, r)
		return
	}
	s.serveShot(w, mime, data, "public, max-age=86400")
}

func (s *Server) handleShotsConfigGet(w http.ResponseWriter, r *http.Request) {
	reply := map[string]any{"config": s.shotsConfig()}
	base, reason := s.publicShotBase()
	reply["publicBase"], reply["publicReason"] = base, reason
	writeJSON(w, reply)
}

func (s *Server) handleShotsConfigPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled   *bool `json:"enabled"`
		Phone     *bool `json:"phone"`
		PRComment *bool `json:"prComment"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	set := func(key string, v *bool) {
		if v == nil {
			return
		}
		val := "0"
		if *v {
			val = "1"
		}
		s.store.SetSetting(key, val)
	}
	set(settingShotsEnabled, in.Enabled)
	set(settingShotsPRComment, in.PRComment)
	set(settingShotsPhone, in.Phone)
	s.handleShotsConfigGet(w, r)
}

// parsePRView reads `gh pr view --json number,url,state`.
func parsePRView(out string) (repo string, number int, state string) {
	var v struct {
		Number int    `json:"number"`
		Url    string `json:"url"`
		State  string `json:"state"`
	}
	if json.Unmarshal([]byte(out), &v) != nil {
		return "", 0, ""
	}
	m := prViewURLRe.FindStringSubmatch(v.Url)
	if m == nil || v.Number == 0 {
		return "", 0, ""
	}
	return m[1], v.Number, strings.ToUpper(v.State)
}

var prViewURLRe = regexp.MustCompile(`^https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9_.-]+)/pull/\d+`)
