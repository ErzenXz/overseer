package hub

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Shared sign-ins: someone signed in to Claude Code or Codex on one machine
// reuses that sign-in on their other machines, and new machines can get it
// as soon as they connect. Only the vendors' documented headless paths are
// used: the one-year OAuth token `claude setup-token` prints (pasted in the
// UI; the hub never runs setup-token), and a copy of Codex's auth.json read
// from a signed-in machine. Secrets live only in this hub's database, like
// the cloud API tokens (cloud.go); they leave it only to a device in
// login.apply, and never reach a response, a log line or the activity log.

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS shared_logins (
	agent         TEXT PRIMARY KEY,
	kind          TEXT NOT NULL,
	secret        TEXT NOT NULL,
	account       TEXT NOT NULL DEFAULT '',
	source_device TEXT NOT NULL DEFAULT '',
	created_at    INTEGER NOT NULL,
	auto          INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shared_login_devices (
	agent      TEXT NOT NULL,
	device_id  TEXT NOT NULL,
	applied_at INTEGER NOT NULL,
	state      TEXT NOT NULL,
	message    TEXT NOT NULL DEFAULT '',
	sha256     TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (agent, device_id)
);`)
}

const (
	sharedLoginClaudeLife = 365 * 24 * time.Hour // a setup-token lasts a year
	sharedLoginAutoDelay  = 3 * time.Second      // after a device connects, before looking at it
	sharedLoginTimeout    = 30 * time.Second     // per device round trip
	sharedLoginMaxDevices = 200
	maxCodexAuthSize      = 64 << 10

	loginOK     = "ok"
	loginFailed = "failed"
	// loginStale marks a device that got an earlier shared sign-in for the
	// agent: not "applied" for the current one, but its hash still says what
	// Overseer last wrote there, so a backup of the person's own sign-in is
	// never overwritten and removal still recognises the file.
	loginStale   = "stale"
	loginSkipped = "skipped"

	claudeTokenPrefix = "sk-ant-oat"
)

// sharedLoginSpec is one agent whose sign-in can be shared.
type sharedLoginSpec struct{ id, name, kind string }

var sharedLoginSpecs = []sharedLoginSpec{
	{"claude", "Claude Code", "oauth-token"},
	{"codex", "Codex", "auth-file"},
}

func sharedLoginSpecFor(id string) (sharedLoginSpec, bool) {
	for _, sp := range sharedLoginSpecs {
		if sp.id == id {
			return sp, true
		}
	}
	return sharedLoginSpec{}, false
}

// sharedLoginState is the in-memory side (zero value is ready to use).
type sharedLoginState struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex // agent/device: one apply at a time

	autoDelay time.Duration // test seam: 0 means sharedLoginAutoDelay
}

// lock serialises applies of one agent's sign-in to one device.
func (st *sharedLoginState) lock(agent, deviceId string) func() {
	st.mu.Lock()
	if st.locks == nil {
		st.locks = map[string]*sync.Mutex{}
	}
	key := agent + "/" + deviceId
	l := st.locks[key]
	if l == nil {
		l = &sync.Mutex{}
		st.locks[key] = l
	}
	st.mu.Unlock()
	l.Lock()
	return l.Unlock
}

// --- validation ---

// validateClaudeToken checks a pasted `claude setup-token` token and returns
// it trimmed.
func validateClaudeToken(raw string) (string, error) {
	t := strings.TrimSpace(raw)
	switch {
	case t == "":
		return "", errors.New("Paste the token that `claude setup-token` printed")
	case strings.IndexFunc(t, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0:
		return "", errors.New("The token can't contain spaces or line breaks. Copy it again as one line")
	case !strings.HasPrefix(t, claudeTokenPrefix):
		return "", errors.New("That isn't a Claude Code token. Run `claude setup-token` and paste the token it prints (it starts with " + claudeTokenPrefix + ")")
	case len(t) < 40:
		return "", errors.New("That token is too short. Copy the whole token `claude setup-token` printed")
	case len(t) > 512:
		return "", errors.New("That token is too long to be a Claude Code token")
	}
	return t, nil
}

// codexAuthAccount checks that secret is a Codex auth.json holding a sign-in
// (a tokens object or an API key) and returns the account's email from the
// id_token, when it has one. The token is decoded, not verified: the email is
// only a label.
func codexAuthAccount(secret string) (string, error) {
	if len(secret) > maxCodexAuthSize {
		return "", errors.New("That machine's auth.json is too large to be a Codex sign-in")
	}
	var f struct {
		APIKey *string          `json:"OPENAI_API_KEY"`
		Tokens *json.RawMessage `json:"tokens"`
	}
	if err := json.Unmarshal([]byte(secret), &f); err != nil {
		return "", errors.New("That machine's auth.json isn't valid JSON, so it can't be shared")
	}
	hasTokens := f.Tokens != nil && strings.HasPrefix(strings.TrimSpace(string(*f.Tokens)), "{")
	hasKey := f.APIKey != nil && *f.APIKey != ""
	if !hasTokens && !hasKey {
		return "", errors.New("Codex on that machine isn't signed in (its auth.json holds no sign-in)")
	}
	if !hasTokens {
		return "", nil
	}
	var t struct {
		IdToken string `json:"id_token"`
	}
	json.Unmarshal(*f.Tokens, &t)
	return jwtEmail(t.IdToken), nil
}

// jwtEmail reads the email claim from a JWT's payload without verifying it:
// the top-level "email", else OpenAI's profile claim.
func jwtEmail(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return ""
	}
	var claims struct {
		Email   string `json:"email"`
		Profile struct {
			Email string `json:"email"`
		} `json:"https://api.openai.com/profile"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return ""
	}
	if claims.Email != "" {
		return claims.Email
	}
	return claims.Profile.Email
}

// redactSecret keeps a secret out of a message that might echo it.
func redactSecret(text, secret string) string {
	if secret != "" {
		text = strings.ReplaceAll(text, secret, "•••")
	}
	return text
}

// --- store ---

type sharedLogin struct {
	Agent, Kind, Secret   string
	Account, SourceDevice string
	CreatedAt             int64
	Auto                  bool
}

type sharedLoginDevice struct {
	Agent, DeviceId string
	AppliedAt       int64
	State, Message  string
	Sha256          string // of what was written there; kept from the last success
}

func (s *Store) SharedLogin(agent string) (*sharedLogin, error) {
	var l sharedLogin
	var auto int
	err := s.db.QueryRow(`SELECT agent, kind, secret, account, source_device, created_at, auto FROM shared_logins WHERE agent = ?`, agent).
		Scan(&l.Agent, &l.Kind, &l.Secret, &l.Account, &l.SourceDevice, &l.CreatedAt, &auto)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l.Auto = auto == 1
	return &l, nil
}

func (s *Store) SharedLogins() ([]sharedLogin, error) {
	var out []sharedLogin
	for _, sp := range sharedLoginSpecs {
		l, err := s.SharedLogin(sp.id)
		if err != nil {
			return nil, err
		}
		if l != nil {
			out = append(out, *l)
		}
	}
	return out, nil
}

// SaveSharedLogin stores l in place of any earlier sign-in for that agent.
// The devices the earlier one went to don't have this one, so they turn
// stale, keeping the hash of what was written there.
func (s *Store) SaveSharedLogin(l sharedLogin) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO shared_logins (agent, kind, secret, account, source_device, created_at, auto) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(agent) DO UPDATE SET kind = excluded.kind, secret = excluded.secret, account = excluded.account,
		source_device = excluded.source_device, created_at = excluded.created_at, auto = excluded.auto`,
		l.Agent, l.Kind, l.Secret, l.Account, l.SourceDevice, l.CreatedAt, boolInt(l.Auto)); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE shared_login_devices SET state = ?, message = '' WHERE agent = ?`, loginStale, l.Agent); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetSharedLoginAuto(agent string, auto bool) error {
	_, err := s.db.Exec(`UPDATE shared_logins SET auto = ? WHERE agent = ?`, boolInt(auto), agent)
	return err
}

func (s *Store) DeleteSharedLogin(agent string) error {
	if _, err := s.db.Exec(`DELETE FROM shared_login_devices WHERE agent = ?`, agent); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM shared_logins WHERE agent = ?`, agent)
	return err
}

func (s *Store) SharedLoginDevices(agent string) ([]sharedLoginDevice, error) {
	rows, err := s.db.Query(`SELECT agent, device_id, applied_at, state, message, sha256 FROM shared_login_devices WHERE agent = ?`, agent)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sharedLoginDevice
	for rows.Next() {
		var d sharedLoginDevice
		if err := rows.Scan(&d.Agent, &d.DeviceId, &d.AppliedAt, &d.State, &d.Message, &d.Sha256); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) SharedLoginDevice(agent, deviceId string) (*sharedLoginDevice, error) {
	var d sharedLoginDevice
	err := s.db.QueryRow(`SELECT agent, device_id, applied_at, state, message, sha256 FROM shared_login_devices WHERE agent = ? AND device_id = ?`,
		agent, deviceId).Scan(&d.Agent, &d.DeviceId, &d.AppliedAt, &d.State, &d.Message, &d.Sha256)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// RecordSharedLoginDevice saves one apply's outcome. A failure keeps the hash
// of an earlier success, which is still what that device may hold.
func (s *Store) RecordSharedLoginDevice(d sharedLoginDevice) error {
	_, err := s.db.Exec(`INSERT INTO shared_login_devices (agent, device_id, applied_at, state, message, sha256) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(agent, device_id) DO UPDATE SET applied_at = excluded.applied_at, state = excluded.state, message = excluded.message,
		sha256 = CASE WHEN excluded.sha256 != '' THEN excluded.sha256 ELSE shared_login_devices.sha256 END`,
		d.Agent, d.DeviceId, d.AppliedAt, d.State, d.Message, d.Sha256)
	return err
}

// --- the list ---

type sharedLoginApplied struct {
	DeviceId   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	AppliedAt  int64  `json:"appliedAt"`
	State      string `json:"state"`
	Message    string `json:"message"`
}

// sharedLoginItem is one row of GET /api/shared-logins. It never carries the
// secret.
type sharedLoginItem struct {
	Agent        string               `json:"agent"`
	Name         string               `json:"name"`
	Kind         string               `json:"kind"`
	Account      string               `json:"account"`
	SourceDevice string               `json:"sourceDevice"`
	CreatedAt    int64                `json:"createdAt"`
	ExpiresAt    int64                `json:"expiresAt"`
	Auto         bool                 `json:"auto"`
	Applied      []sharedLoginApplied `json:"applied"`
}

type sharedLoginsBody struct {
	Items []sharedLoginItem `json:"items"`
}

type sharedLoginResult struct {
	DeviceId   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	State      string `json:"state"`
	Message    string `json:"message"`
}

func (s *Server) sharedLoginsBody() (sharedLoginsBody, error) {
	body := sharedLoginsBody{Items: []sharedLoginItem{}}
	logins, err := s.store.SharedLogins()
	if err != nil {
		return body, err
	}
	names := map[string]string{}
	if len(logins) > 0 {
		devs, err := s.store.ListDevices()
		if err != nil {
			return body, err
		}
		for _, d := range devs {
			names[d.Id] = d.Name
		}
	}
	for _, l := range logins {
		sp, _ := sharedLoginSpecFor(l.Agent)
		it := sharedLoginItem{Agent: l.Agent, Name: sp.name, Kind: l.Kind, Account: l.Account, SourceDevice: l.SourceDevice,
			CreatedAt: l.CreatedAt, Auto: l.Auto, Applied: []sharedLoginApplied{}}
		if l.Agent == "claude" {
			it.ExpiresAt = time.Unix(l.CreatedAt, 0).Add(sharedLoginClaudeLife).Unix()
		}
		rows, err := s.store.SharedLoginDevices(l.Agent)
		if err != nil {
			return body, err
		}
		for _, d := range rows {
			name, ok := names[d.DeviceId]
			if !ok || d.State == loginStale {
				continue // the device was removed, or only had an earlier sign-in
			}
			it.Applied = append(it.Applied, sharedLoginApplied{DeviceId: d.DeviceId, DeviceName: name, AppliedAt: d.AppliedAt,
				State: d.State, Message: d.Message})
		}
		sort.Slice(it.Applied, func(i, j int) bool {
			a, b := it.Applied[i], it.Applied[j]
			if a.DeviceName != b.DeviceName {
				return a.DeviceName < b.DeviceName
			}
			return a.DeviceId < b.DeviceId
		})
		body.Items = append(body.Items, it)
	}
	return body, nil
}

func (s *Server) writeSharedLogins(w http.ResponseWriter) {
	body, err := s.sharedLoginsBody()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, body)
}

// --- applying ---

// pushSharedLogin sends l to a connected device, records the outcome and,
// after a success, refreshes the device's agent detections so the new
// sign-in shows. The caller holds the agent/device lock.
func (s *Server) pushSharedLogin(c *agentConn, l *sharedLogin) (string, string) {
	req := protocol.LoginApplyRequest{Agent: l.Agent, Secret: l.Secret}
	if prev, _ := s.store.SharedLoginDevice(l.Agent, c.deviceId); prev != nil {
		req.Replaces = prev.Sha256
	}
	ctx, cancel := contextWithTimeout(sharedLoginTimeout)
	defer cancel()
	var res protocol.LoginApplyResult
	err := c.requestInto(ctx, protocol.TypeLoginApply, req, &res)
	rec := sharedLoginDevice{Agent: l.Agent, DeviceId: c.deviceId, AppliedAt: time.Now().Unix(), State: loginOK, Sha256: res.Sha256}
	if err != nil {
		rec.State, rec.Message, rec.Sha256 = loginFailed, redactSecret(err.Error(), l.Secret), ""
	}
	if err := s.store.RecordSharedLoginDevice(rec); err != nil {
		log.Printf("shared sign-ins: recording %s on %s: %v", l.Agent, c.deviceId, err)
	}
	if rec.State == loginOK {
		s.deviceAgents(c, true)
	}
	return rec.State, rec.Message
}

// applySharedLogin is one device of POST /api/shared-logins/{agent}/apply.
// Unless replace is set, a device where the agent is already signed in is
// left alone.
func (s *Server) applySharedLogin(l *sharedLogin, d Device, replace bool) sharedLoginResult {
	out := sharedLoginResult{DeviceId: d.Id, DeviceName: d.Name}
	c := s.registry.get(d.Id)
	if c == nil {
		out.State, out.Message = loginFailed, "Offline"
		return out
	}
	unlock := s.sharedLogins.lock(l.Agent, d.Id)
	defer unlock()
	if !replace {
		agents, err := s.deviceAgents(c, false)
		if err != nil {
			out.State, out.Message = loginFailed, "Couldn't check the sign-in there: "+err.Error()
			return out
		}
		for _, a := range agents {
			if a.Id == l.Agent && a.Installed && a.Auth == "ok" {
				out.State, out.Message = loginSkipped, "Already signed in"
				return out
			}
		}
	}
	out.State, out.Message = s.pushSharedLogin(c, l)
	return out
}

// autoApplySharedLogins runs when a device connects (ws.go): each shared
// sign-in with auto on that has never gone to this device is applied once the
// device's agents are known, but only where that agent is installed and
// signed out. A working sign-in is never replaced automatically.
func (s *Server) autoApplySharedLogins(c *agentConn) {
	logins, err := s.store.SharedLogins()
	if err != nil {
		log.Printf("shared sign-ins: %v", err)
		return
	}
	var todo []sharedLogin
	for _, l := range logins {
		if !l.Auto {
			continue
		}
		if prev, err := s.store.SharedLoginDevice(l.Agent, c.deviceId); err == nil && (prev == nil || prev.State == loginStale) {
			todo = append(todo, l)
		}
	}
	if len(todo) == 0 {
		return
	}
	delay := s.sharedLogins.autoDelay
	if delay <= 0 {
		delay = sharedLoginAutoDelay
	}
	var agents []protocol.AgentInfo
	for try := 0; try < 3; try++ {
		time.Sleep(delay)
		if s.registry.get(c.deviceId) != c {
			return // gone, or reconnected (that connection gets its own pass)
		}
		if agents, err = s.deviceAgents(c, false); err == nil {
			break
		}
	}
	if err != nil {
		log.Printf("shared sign-ins: no agent detections from %s: %v", c.deviceId, err)
		return
	}
	name := c.hello.Hostname
	if d, _ := s.store.DeviceById(c.deviceId); d != nil {
		name = d.Name
	}
	for i := range todo {
		l := &todo[i]
		var info protocol.AgentInfo
		for _, a := range agents {
			if a.Id == l.Agent {
				info = a
			}
		}
		if !info.Installed || info.Auth != "signed-out" {
			continue
		}
		unlock := s.sharedLogins.lock(l.Agent, c.deviceId)
		// Look again under the lock: a manual apply may have just done it,
		// or the sign-in may have been replaced or turned off.
		cur, _ := s.store.SharedLogin(l.Agent)
		prev, err := s.store.SharedLoginDevice(l.Agent, c.deviceId)
		if cur == nil || !cur.Auto || cur.CreatedAt != l.CreatedAt || err != nil || (prev != nil && prev.State != loginStale) {
			unlock()
			continue
		}
		state, msg := s.pushSharedLogin(c, cur)
		unlock()
		sp, _ := sharedLoginSpecFor(l.Agent)
		detail := "automatic, " + state
		if msg != "" {
			detail += ": " + msg
			log.Printf("shared sign-ins: automatic %s on %s: %s", l.Agent, name, msg)
		}
		s.auditAs("", "Overseer", "login.share.apply", sp.name+" on "+name, detail)
	}
}

// --- HTTP ---

// routesSharedLogins registers the shared sign-in routes. All of them are
// owner-only.
func (s *Server) routesSharedLogins(m *http.ServeMux) {
	m.HandleFunc("GET /api/shared-logins", s.requireOwner(s.handleListSharedLogins))
	m.HandleFunc("POST /api/shared-logins", s.requireOwner(s.handleCreateSharedLogin))
	m.HandleFunc("POST /api/shared-logins/{agent}/apply", s.requireOwner(s.handleApplySharedLogin))
	m.HandleFunc("PUT /api/shared-logins/{agent}", s.requireOwner(s.handlePutSharedLogin))
	m.HandleFunc("DELETE /api/shared-logins/{agent}", s.requireOwner(s.handleDeleteSharedLogin))
}

func (s *Server) handleListSharedLogins(w http.ResponseWriter, r *http.Request) {
	s.writeSharedLogins(w)
}

func (s *Server) handleCreateSharedLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Agent    string `json:"agent"`
		Token    string `json:"token"`
		DeviceId string `json:"deviceId"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	sp, ok := sharedLoginSpecFor(in.Agent)
	if !ok {
		httpError(w, http.StatusBadRequest, "Only Claude Code and Codex sign-ins can be shared")
		return
	}
	l := sharedLogin{Agent: sp.id, Kind: sp.kind, CreatedAt: time.Now().Unix()}
	if old, _ := s.store.SharedLogin(sp.id); old != nil {
		l.Auto = old.Auto // replacing the sign-in keeps the setting
	}
	detail := "pasted token"
	switch sp.id {
	case "claude":
		token, err := validateClaudeToken(in.Token)
		if err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		l.Secret = token
	case "codex":
		if in.DeviceId == "" {
			httpError(w, http.StatusBadRequest, "Choose the machine where Codex is signed in")
			return
		}
		d, err := s.store.DeviceById(in.DeviceId)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if d == nil {
			httpError(w, http.StatusNotFound, "device not found")
			return
		}
		c := s.registry.get(d.Id)
		if c == nil {
			httpError(w, http.StatusBadRequest, d.Name+" is offline")
			return
		}
		ctx, cancel := contextWithTimeout(sharedLoginTimeout)
		var res protocol.LoginReadResult
		err = c.requestInto(ctx, protocol.TypeLoginRead, protocol.LoginReadRequest{Agent: sp.id}, &res)
		cancel()
		if err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		account, err := codexAuthAccount(res.Secret)
		if err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		l.Secret, l.Account, l.SourceDevice = res.Secret, account, d.Name
		detail = "from " + d.Name
	}
	if err := s.store.SaveSharedLogin(l); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "login.share", sp.name, detail)
	s.writeSharedLogins(w)
}

func (s *Server) handleApplySharedLogin(w http.ResponseWriter, r *http.Request) {
	sp, ok := sharedLoginSpecFor(r.PathValue("agent"))
	if !ok {
		httpError(w, http.StatusBadRequest, "Only Claude Code and Codex sign-ins can be shared")
		return
	}
	var in struct {
		DeviceIds []string `json:"deviceIds"`
		Replace   bool     `json:"replace"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	var ids []string
	seen := map[string]bool{}
	for _, id := range in.DeviceIds {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		httpError(w, http.StatusBadRequest, "Choose at least one machine")
		return
	}
	if len(ids) > sharedLoginMaxDevices {
		httpError(w, http.StatusBadRequest, "too many machines at once")
		return
	}
	l, err := s.store.SharedLogin(sp.id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if l == nil {
		httpError(w, http.StatusNotFound, "No "+sp.name+" sign-in is shared yet")
		return
	}
	devs := make([]Device, len(ids))
	for i, id := range ids {
		d, err := s.store.DeviceById(id)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if d == nil {
			httpError(w, http.StatusNotFound, "device not found")
			return
		}
		devs[i] = *d
	}
	results := make([]sharedLoginResult, len(devs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, d := range devs {
		wg.Add(1)
		go func(i int, d Device) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = s.applySharedLogin(l, d, in.Replace)
		}(i, d)
	}
	wg.Wait()
	byState := map[string][]string{}
	for _, res := range results {
		byState[res.State] = append(byState[res.State], res.DeviceName)
	}
	var parts []string
	for _, st := range []string{loginOK, loginSkipped, loginFailed} {
		if len(byState[st]) > 0 {
			parts = append(parts, st+": "+strings.Join(byState[st], ", "))
		}
	}
	detail := strings.Join(parts, "; ")
	if in.Replace {
		detail += " (replacing)"
	}
	s.audit(r, "login.share.apply", sp.name, detail)
	body, err := s.sharedLoginsBody()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, struct {
		Results []sharedLoginResult `json:"results"`
		Items   []sharedLoginItem   `json:"items"`
	}{results, body.Items})
}

func (s *Server) handlePutSharedLogin(w http.ResponseWriter, r *http.Request) {
	sp, ok := sharedLoginSpecFor(r.PathValue("agent"))
	if !ok {
		httpError(w, http.StatusBadRequest, "Only Claude Code and Codex sign-ins can be shared")
		return
	}
	var in struct {
		Auto *bool `json:"auto"`
	}
	if err := readJSON(r, &in); err != nil || in.Auto == nil {
		httpError(w, http.StatusBadRequest, "auto is required")
		return
	}
	l, err := s.store.SharedLogin(sp.id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if l == nil {
		httpError(w, http.StatusNotFound, "No "+sp.name+" sign-in is shared yet")
		return
	}
	if err := s.store.SetSharedLoginAuto(sp.id, *in.Auto); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "login.share.auto", sp.name, map[bool]string{true: "on", false: "off"}[*in.Auto])
	s.writeSharedLogins(w)
}

func (s *Server) handleDeleteSharedLogin(w http.ResponseWriter, r *http.Request) {
	sp, ok := sharedLoginSpecFor(r.PathValue("agent"))
	if !ok {
		httpError(w, http.StatusBadRequest, "Only Claude Code and Codex sign-ins can be shared")
		return
	}
	var detail string
	if r.URL.Query().Get("devices") == "1" {
		detail = s.removeSharedLoginFromDevices(sp)
	}
	if err := s.store.DeleteSharedLogin(sp.id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "login.share.delete", sp.name, detail)
	s.writeSharedLogins(w)
}

// removeSharedLoginFromDevices sends login.remove to every online device the
// sign-in was written to, and sums up what happened for the activity log.
func (s *Server) removeSharedLoginFromDevices(sp sharedLoginSpec) string {
	rows, err := s.store.SharedLoginDevices(sp.id)
	if err != nil {
		log.Printf("shared sign-ins: %v", err)
		return ""
	}
	var mu sync.Mutex
	var removed, kept, offline []string
	var wg sync.WaitGroup
	for _, row := range rows {
		if row.Sha256 == "" {
			continue // nothing of ours was ever written there
		}
		d, _ := s.store.DeviceById(row.DeviceId)
		if d == nil {
			continue // the device was removed
		}
		name := d.Name
		c := s.registry.get(row.DeviceId)
		if c == nil {
			offline = append(offline, name)
			continue
		}
		wg.Add(1)
		go func(c *agentConn, row sharedLoginDevice, name string) {
			defer wg.Done()
			unlock := s.sharedLogins.lock(sp.id, row.DeviceId)
			defer unlock()
			ctx, cancel := contextWithTimeout(sharedLoginTimeout)
			defer cancel()
			var res protocol.LoginRemoveResult
			err := c.requestInto(ctx, protocol.TypeLoginRemove, protocol.LoginRemoveRequest{Agent: sp.id, Sha256: row.Sha256}, &res)
			if err == nil && res.Removed {
				s.deviceAgents(c, true)
			}
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil:
				kept = append(kept, name)
				log.Printf("shared sign-ins: removing %s from %s: %v", sp.id, name, err)
			case res.Removed:
				removed = append(removed, name)
			default:
				kept = append(kept, name)
				if res.Note != "" {
					log.Printf("shared sign-ins: %s on %s: %s", sp.id, name, res.Note)
				}
			}
		}(c, row, name)
	}
	wg.Wait()
	var parts []string
	for _, p := range []struct {
		label string
		names []string
	}{{"removed from", removed}, {"left on", kept}, {"offline", offline}} {
		if len(p.names) > 0 {
			sort.Strings(p.names)
			parts = append(parts, p.label+" "+strings.Join(p.names, ", "))
		}
	}
	return strings.Join(parts, "; ")
}
