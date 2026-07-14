package hub

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
	"github.com/ErzenXz/overseer/internal/updater"
)

// --- setup & auth ---

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.Setting("password_hash")
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing != "" {
		httpError(w, http.StatusConflict, "already set up")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil || len(req.Password) < 8 {
		httpError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if err := s.store.SetSetting("password_hash", hashPassword(req.Password)); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.issueSession(w, r)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.loginRL.allow(r.RemoteAddr) {
		httpError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	stored, err := s.store.Setting("password_hash")
	if err != nil || stored == "" || !verifyPassword(stored, req.Password) {
		httpError(w, http.StatusUnauthorized, "wrong password")
		return
	}
	s.issueSession(w, r)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) issueSession(w http.ResponseWriter, r *http.Request) {
	token := s.sessions.create()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil, // set when served over HTTPS (e.g. behind a TLS proxy terminating here)
		MaxAge: int(sessionTTL.Seconds()),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.sessions.revoke(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]bool{"ok": true})
}

// handleMe reports auth/setup state so the UI knows which screen to show.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	stored, _ := s.store.Setting("password_hash")
	authed := false
	if c, err := r.Cookie(sessionCookie); err == nil && s.sessions.valid(c.Value) {
		authed = true
	}
	writeJSON(w, map[string]any{
		"setupDone":     stored != "",
		"authenticated": authed,
		"version":       s.opts.Version,
	})
}

// --- enrollment ---

func (s *Server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Hostname string `json:"hostname"`
		OS       string `json:"os"`
		Arch     string `json:"arch"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	ok, err := s.store.ConsumeEnrollToken(req.Token)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusForbidden, "enrollment token is invalid, expired, or already used — create a new one in the UI")
		return
	}
	name := req.Hostname
	if name == "" {
		name = "device"
	}
	id, token, err := s.store.CreateDevice(name, req.Hostname, req.OS, req.Arch, false)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]string{"deviceId": id, "deviceToken": token})
}

func (s *Server) handleCreateEnrollToken(w http.ResponseWriter, r *http.Request) {
	token, err := s.store.CreateEnrollToken(15 * time.Minute)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	base := fmt.Sprintf("%s://%s", scheme, r.Host)
	writeJSON(w, map[string]string{
		"token":          token,
		"command":        fmt.Sprintf("curl -fsSL %s/install/%s.sh | sh", base, token),
		"windowsCommand": fmt.Sprintf("powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm %s/install/%s.ps1 | iex\"", base, token),
	})
}

// --- devices ---

type deviceView struct {
	Device
	Online          bool            `json:"online"`
	Stats           *protocol.Stats `json:"stats,omitempty"`
	Tmux            bool            `json:"tmux"`
	AgentVersion    string          `json:"agentVersion,omitempty"`
	Platform        string          `json:"platform,omitempty"`
	PlatformVersion string          `json:"platformVersion,omitempty"`
	KernelVersion   string          `json:"kernelVersion,omitempty"`
}

func (s *Server) deviceViews() ([]deviceView, error) {
	devices, err := s.store.ListDevices()
	if err != nil {
		return nil, err
	}
	out := make([]deviceView, 0, len(devices))
	for _, d := range devices {
		v := deviceView{Device: d}
		if c := s.registry.get(d.Id); c != nil {
			v.Online = true
			v.Tmux = c.hello.Tmux
			v.AgentVersion = c.hello.Version
			v.Platform = c.hello.Platform
			v.PlatformVersion = c.hello.PlatformVersion
			v.KernelVersion = c.hello.KernelVersion
			c.mu.Lock()
			v.Stats = c.stats
			c.mu.Unlock()
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	views, err := s.deviceViews()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, views)
}

func (s *Server) handleRenameDevice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		httpError(w, http.StatusBadRequest, "name required")
		return
	}
	if err := s.store.RenameDevice(r.PathValue("id"), strings.TrimSpace(req.Name)); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, err := s.store.DeviceById(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if d == nil {
		httpError(w, http.StatusNotFound, "no such device")
		return
	}
	if d.IsHub {
		httpError(w, http.StatusBadRequest, "cannot remove the hub itself")
		return
	}
	if err := s.store.DeleteDevice(id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if c := s.registry.get(id); c != nil {
		c.ws.Close() // token is gone; reconnect will be refused
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// --- software updates ---

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := s.updates.snapshot(ctx)
	views, err := s.deviceViews()
	if err == nil {
		for _, device := range views {
			if device.IsHub {
				continue
			}
			status.FleetTotal++
			if device.AgentVersion == "" || updater.IsNewer(s.opts.Version, device.AgentVersion) {
				status.FleetOutdated++
			}
		}
	}
	writeJSON(w, status)
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if err := s.updates.check(ctx, false); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, s.updates.snapshot(ctx))
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AutoUpdate *bool `json:"autoUpdate"`
	}
	if err := readJSON(r, &req); err != nil || req.AutoUpdate == nil {
		httpError(w, http.StatusBadRequest, "autoUpdate is required")
		return
	}
	if err := s.updates.setAuto(*req.AutoUpdate); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	status := s.updates.snapshot(r.Context())
	if !status.Managed {
		httpError(w, http.StatusConflict, "this hub is not running as a managed service; run `overseer update` on the host")
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		_ = s.updates.install(ctx)
	}()
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleUpdateRollback(w http.ResponseWriter, r *http.Request) {
	status := s.updates.snapshot(r.Context())
	if !status.Managed {
		httpError(w, http.StatusConflict, "this hub is not running as a managed service; run `overseer rollback` on the host")
		return
	}
	if status.RollbackVersion == "" {
		httpError(w, http.StatusConflict, "no previous version is available")
		return
	}
	go func() { _ = s.updates.rollback() }()
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]bool{"ok": true})
}

// deviceConn resolves the path {id} to a live connection or writes an error.
func (s *Server) deviceConn(w http.ResponseWriter, r *http.Request) *agentConn {
	id := r.PathValue("id")
	c := s.registry.get(id)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return nil
	}
	return c
}

// --- sessions ---

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	var res protocol.SessionsListResult
	if err := c.requestInto(ctx, protocol.TypeSessionsList, nil, &res); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.Sessions == nil {
		res.Sessions = []protocol.Session{}
	}
	writeJSON(w, res.Sessions)
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	var req protocol.SessionCreate
	if err := readJSON(r, &req); err != nil || req.Name == "" {
		httpError(w, http.StatusBadRequest, "session name required")
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	if err := c.requestInto(ctx, protocol.TypeSessionCreate, req, nil); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	s.events.publish(event{Type: "sessions.changed", DeviceId: c.deviceId})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleKillSession(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	err := c.requestInto(ctx, protocol.TypeSessionKill, protocol.SessionKill{Name: r.PathValue("name")}, nil)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	s.events.publish(event{Type: "sessions.changed", DeviceId: c.deviceId})
	writeJSON(w, map[string]bool{"ok": true})
}

// shellQuote makes a string safe as a single sh word.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// handleSessionInput types text into a tmux session (used by MCP/CLI to steer
// agents without holding a live terminal open).
func (s *Server) handleSessionInput(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	var req struct {
		Text  string `json:"text"`
		Enter bool   `json:"enter"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	name := r.PathValue("name")
	cmd := ""
	if req.Text != "" {
		cmd = fmt.Sprintf("tmux send-keys -t %s -l %s", shellQuote(name), shellQuote(req.Text))
	}
	if req.Enter {
		if cmd != "" {
			cmd += " && "
		}
		cmd += fmt.Sprintf("tmux send-keys -t %s Enter", shellQuote(name))
	}
	if cmd == "" {
		httpError(w, http.StatusBadRequest, "nothing to send")
		return
	}
	res, err := s.execOnDevice(c, cmd, "", 15)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.ExitCode != 0 {
		httpError(w, http.StatusBadGateway, strings.TrimSpace(res.Stderr+res.Stdout))
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// handleSessionOutput captures the last N lines of a tmux session's pane.
func (s *Server) handleSessionOutput(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	lines := 200
	if l, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && l > 0 && l <= 10000 {
		lines = l
	}
	name := r.PathValue("name")
	cmd := fmt.Sprintf("tmux capture-pane -p -t %s -S -%d", shellQuote(name), lines)
	res, err := s.execOnDevice(c, cmd, "", 15)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.ExitCode != 0 {
		httpError(w, http.StatusBadGateway, strings.TrimSpace(res.Stderr+res.Stdout))
		return
	}
	writeJSON(w, map[string]string{"output": res.Stdout})
}

// --- exec ---

func (s *Server) execOnDevice(c *agentConn, command, cwd string, timeoutSec int) (protocol.ExecResult, error) {
	// Give the device its own timeout plus slack for the round trip.
	d := 75 * time.Second
	if timeoutSec > 0 {
		d = time.Duration(timeoutSec+15) * time.Second
	}
	ctx, cancel := contextWithTimeout(d)
	defer cancel()
	var res protocol.ExecResult
	err := c.requestInto(ctx, protocol.TypeExec, protocol.Exec{Command: command, Cwd: cwd, TimeoutSec: timeoutSec}, &res)
	return res, err
}

func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	var req protocol.Exec
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Command) == "" {
		httpError(w, http.StatusBadRequest, "command required")
		return
	}
	res, err := s.execOnDevice(c, req.Command, req.Cwd, req.TimeoutSec)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, res)
}

// --- fleet-wide agent sessions ---

type fleetSession struct {
	protocol.Session
	DeviceId   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleFleetAgents(w http.ResponseWriter, r *http.Request) {
	devices, err := s.store.ListDevices()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	nameById := map[string]string{}
	for _, d := range devices {
		nameById[d.Id] = d.Name
	}
	conns := s.registry.all()
	var mu sync.Mutex
	var out []fleetSession
	var wg sync.WaitGroup
	for _, c := range conns {
		wg.Add(1)
		go func(c *agentConn) {
			defer wg.Done()
			ctx, cancel := contextWithTimeout(10 * time.Second)
			defer cancel()
			var res protocol.SessionsListResult
			if err := c.requestInto(ctx, protocol.TypeSessionsList, nil, &res); err != nil {
				return
			}
			mu.Lock()
			for _, sess := range res.Sessions {
				out = append(out, fleetSession{Session: sess, DeviceId: c.deviceId, DeviceName: nameById[c.deviceId]})
			}
			mu.Unlock()
		}(c)
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool {
		if out[i].DeviceName != out[j].DeviceName {
			return out[i].DeviceName < out[j].DeviceName
		}
		return out[i].Name < out[j].Name
	})
	if out == nil {
		out = []fleetSession{}
	}
	writeJSON(w, out)
}

// --- presets ---

func (s *Server) handleListPresets(w http.ResponseWriter, r *http.Request) {
	presets, err := s.store.ListPresets()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, presets)
}

func (s *Server) handleCreatePreset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Command string `json:"command"`
		Kind    string `json:"kind"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		httpError(w, http.StatusBadRequest, "name required")
		return
	}
	if req.Kind == "" {
		req.Kind = strings.ToLower(strings.Fields(req.Command + " shell")[0])
	}
	id, err := s.store.CreatePreset(req.Name, req.Command, req.Kind)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]int64{"id": id})
}

func (s *Server) handleDeletePreset(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.store.DeletePreset(id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// --- API tokens ---

func (s *Server) handleListApiTokens(w http.ResponseWriter, r *http.Request) {
	tokens, err := s.store.ListApiTokens()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tokens == nil {
		tokens = []ApiToken{}
	}
	writeJSON(w, tokens)
}

func (s *Server) handleCreateApiToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		httpError(w, http.StatusBadRequest, "name required")
		return
	}
	token, err := s.store.CreateApiToken(strings.TrimSpace(req.Name))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The plaintext token is shown exactly once.
	writeJSON(w, map[string]string{"token": token})
}

func (s *Server) handleDeleteApiToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.store.DeleteApiToken(id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// --- file browser ---

func (s *Server) handleFsList(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	var res protocol.FsListResult
	err := c.requestInto(ctx, protocol.TypeFsList, protocol.FsList{Path: r.URL.Query().Get("path")}, &res)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.Entries == nil {
		res.Entries = []protocol.FsEntry{}
	}
	writeJSON(w, res)
}

func (s *Server) handleFsDownload(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		httpError(w, http.StatusBadRequest, "path required")
		return
	}

	done := make(chan string, 1)
	pr, pw := io.Pipe()
	// Closing the reader when we return (e.g. the download client disconnected)
	// makes the onBinary pw.Write calls fail fast instead of blocking forever
	// inside the agent's single read loop, which would otherwise wedge the
	// entire device connection.
	defer pr.Close()
	ch := c.openChannel(&hubChannel{
		onBinary: func(p []byte) {
			buf := make([]byte, len(p))
			copy(buf, p)
			pw.Write(buf)
		},
		onControl: func(m protocol.Msg) {
			switch m.Type {
			case protocol.TypeFsEOF:
				done <- ""
			case protocol.TypeFsErr, protocol.TypeTermExit:
				done <- m.Error
			}
		},
	})
	defer c.closeChannel(ch)

	req, _ := protocol.NewMsg(protocol.TypeFsRead, 0, ch, protocol.FsTransfer{Path: path})
	if err := c.sendJSON(req); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	go func() {
		errMsg := <-done
		if errMsg != "" {
			pw.CloseWithError(fmt.Errorf("%s", errMsg))
		} else {
			pw.Close()
		}
	}()

	base := path[strings.LastIndex(path, "/")+1:]
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base))
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, pr)
}

func (s *Server) handleFsUpload(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	dir := r.URL.Query().Get("dir")
	if dir == "" {
		httpError(w, http.StatusBadRequest, "dir required")
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		httpError(w, http.StatusBadRequest, "expected multipart upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpError(w, http.StatusBadRequest, "file field required")
		return
	}
	defer file.Close()
	name := header.Filename
	if name == "" || strings.ContainsAny(name, "/\\") {
		httpError(w, http.StatusBadRequest, "bad filename")
		return
	}
	target := strings.TrimRight(dir, "/") + "/" + name

	done := make(chan string, 1)
	ch := c.openChannel(&hubChannel{
		onControl: func(m protocol.Msg) {
			switch m.Type {
			case protocol.TypeFsEOF:
				done <- ""
			case protocol.TypeFsErr, protocol.TypeTermExit:
				done <- m.Error
			}
		},
	})
	defer c.closeChannel(ch)

	start, _ := protocol.NewMsg(protocol.TypeFsWrite, 0, ch, protocol.FsTransfer{Path: target})
	if err := c.sendJSON(start); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	buf := make([]byte, 64*1024)
	for {
		n, rerr := file.Read(buf)
		if n > 0 {
			if err := c.sendBinary(ch, buf[:n]); err != nil {
				// Tell the agent to discard the partial temp file rather than
				// leaving it until the whole connection drops.
				c.sendJSON(protocol.Msg{Type: protocol.TypeFsErr, Channel: ch, Error: err.Error()})
				httpError(w, http.StatusBadGateway, err.Error())
				return
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			c.sendJSON(protocol.Msg{Type: protocol.TypeFsErr, Channel: ch, Error: rerr.Error()})
			httpError(w, http.StatusInternalServerError, rerr.Error())
			return
		}
	}
	c.sendJSON(protocol.Msg{Type: protocol.TypeFsEOF, Channel: ch})

	select {
	case errMsg := <-done:
		if errMsg != "" {
			httpError(w, http.StatusBadGateway, errMsg)
			return
		}
	case <-time.After(60 * time.Second):
		httpError(w, http.StatusGatewayTimeout, "device did not confirm upload")
		return
	}
	writeJSON(w, map[string]string{"path": target})
}
