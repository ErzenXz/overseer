package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// workingWindow: a session with tmux activity within this window is shown as
// "working" (e.g. a coding agent producing output), otherwise "idle".
const workingWindow = 10 * time.Second

var (
	sessionNameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,64}$`)
	kindRe        = regexp.MustCompile(`[^a-z0-9_-]+`)
)

// sanitizeKind keeps @overseer_kind parseable in list-sessions output.
func sanitizeKind(kind string) string {
	return kindRe.ReplaceAllString(strings.ToLower(kind), "")
}

// --- tmux-backed sessions ---

func (a *Agent) listSessions() ([]protocol.Session, error) {
	sessions := a.listEphemeral()
	if !tmuxAvailable() {
		return sessions, nil
	}
	// Name goes last: it is the only field that may contain spaces, and tmux
	// sanitizes exotic separators (tabs become '_') in -F output. The kind
	// field is safe because createSession restricts it to [a-z0-9_-].
	out, err := exec.Command("tmux", "list-sessions", "-F",
		"#{session_created} #{session_activity} #{session_attached} k=#{@overseer_kind} #{session_name}").Output()
	if err != nil {
		// "no server running" (exit 1) simply means zero sessions.
		return sessions, nil
	}
	now := time.Now().Unix()
	for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
		parts := strings.SplitN(line, " ", 5)
		if len(parts) < 5 {
			continue
		}
		created, _ := strconv.ParseInt(parts[0], 10, 64)
		activity, _ := strconv.ParseInt(parts[1], 10, 64)
		attached, _ := strconv.Atoi(parts[2])
		kind := strings.TrimPrefix(parts[3], "k=")
		status := "idle"
		if now-activity <= int64(workingWindow.Seconds()) {
			status = "working"
		}
		sessions = append(sessions, protocol.Session{
			Name:         parts[4],
			Kind:         kind,
			Status:       status,
			CreatedAt:    created,
			LastActivity: activity,
			Attached:     attached > 0,
		})
	}
	return sessions, nil
}

func (a *Agent) createSession(req protocol.SessionCreate) error {
	if !sessionNameRe.MatchString(req.Name) {
		return fmt.Errorf("invalid session name %q (use letters, digits, . _ -)", req.Name)
	}
	if !tmuxAvailable() {
		return a.createEphemeral(req)
	}
	args := []string{"new-session", "-d", "-s", req.Name}
	if req.Cwd != "" {
		args = append(args, "-c", req.Cwd)
	}
	if out, err := exec.Command("tmux", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("tmux new-session: %s", strings.TrimSpace(string(out)))
	}
	if kind := sanitizeKind(req.Kind); kind != "" {
		exec.Command("tmux", "set-option", "-t", req.Name, "@overseer_kind", kind).Run()
	}
	if req.Command != "" {
		// send-keys instead of passing the command to new-session, so the
		// shell (and final output) survives after the command exits.
		if out, err := exec.Command("tmux", "send-keys", "-t", req.Name, req.Command, "Enter").CombinedOutput(); err != nil {
			return fmt.Errorf("tmux send-keys: %s", strings.TrimSpace(string(out)))
		}
	}
	return nil
}

func (a *Agent) killSession(name string) error {
	if a.killEphemeral(name) {
		return nil
	}
	if !tmuxAvailable() {
		return fmt.Errorf("session %q not found", name)
	}
	if out, err := exec.Command("tmux", "kill-session", "-t", name).CombinedOutput(); err != nil {
		return fmt.Errorf("tmux kill-session: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// --- ephemeral fallback (no tmux): sessions live in this agent process ---
//
// Without tmux the agent itself keeps the PTY. The process starts on first
// attach and keeps running when the browser detaches; a new attach takes the
// session over and replays recent output. It ends when its process exits, the
// session is killed, or the agent restarts.

const ephemeralScrollback = 128 * 1024

type ephemeralSession struct {
	name      string
	cwd       string
	command   string
	kind      string
	createdAt int64

	mu        sync.Mutex
	backend   terminalBackend // nil until first attach
	channel   uint32          // 0 when detached
	starting  bool            // reserved between the attach check and pty start
	activity  int64
	scroll    []byte
	closeOnce sync.Once
}

var (
	ephMu     sync.Mutex
	ephByName = map[string]*ephemeralSession{}
)

func (a *Agent) ephemeral(name string) *ephemeralSession {
	ephMu.Lock()
	defer ephMu.Unlock()
	return ephByName[name]
}

func (a *Agent) listEphemeral() []protocol.Session {
	ephMu.Lock()
	defer ephMu.Unlock()
	var out []protocol.Session
	now := time.Now().Unix()
	for _, e := range ephByName {
		e.mu.Lock()
		status := "idle"
		if now-e.activity <= int64(workingWindow.Seconds()) {
			status = "working"
		}
		out = append(out, protocol.Session{
			Name: e.name, Kind: e.kind, Status: status,
			CreatedAt: e.createdAt, LastActivity: e.activity,
			Attached: e.channel != 0, Ephemeral: true,
		})
		e.mu.Unlock()
	}
	return out
}

func (a *Agent) createEphemeral(req protocol.SessionCreate) error {
	ephMu.Lock()
	defer ephMu.Unlock()
	if _, exists := ephByName[req.Name]; exists {
		return fmt.Errorf("session %q already exists", req.Name)
	}
	ephByName[req.Name] = &ephemeralSession{
		name: req.Name, cwd: req.Cwd, command: req.Command, kind: req.Kind,
		createdAt: time.Now().Unix(), activity: time.Now().Unix(),
	}
	return nil
}

func (a *Agent) killEphemeral(name string) bool {
	ephMu.Lock()
	e := ephByName[name]
	delete(ephByName, name)
	ephMu.Unlock()
	if e == nil {
		return false
	}
	e.mu.Lock()
	backend := e.backend
	e.mu.Unlock()
	if backend != nil {
		// Closing the PTY ends pumpEphemeral, which reaps the process.
		e.closeOnce.Do(func() { backend.Close() })
	}
	return true
}

// detach drops the browser view on channel without touching the process.
func (e *ephemeralSession) detach(channel uint32) {
	e.mu.Lock()
	if e.channel == channel {
		e.channel = 0
	}
	e.mu.Unlock()
}

// attachEphemeral binds channel to the session, starting its process on the
// first attach. A second attach takes over: the previous view is told the
// session moved and stops receiving output.
func (a *Agent) attachEphemeral(channel uint32, e *ephemeralSession, req protocol.TermOpen) {
	fail := func(ch uint32, err error) {
		m, _ := protocol.NewMsg(protocol.TypeTermExit, 0, ch, nil)
		m.Error = err.Error()
		a.send(m)
	}

	e.mu.Lock()
	if e.starting {
		e.mu.Unlock()
		fail(channel, fmt.Errorf("session %q is starting, try again", e.name))
		return
	}
	if e.backend == nil {
		e.starting = true
		e.mu.Unlock()
		var cmd *exec.Cmd
		if e.command != "" {
			cmd = shellCommandContext(context.Background(), e.command, false)
		} else {
			cmd = shellCommandContext(context.Background(), "", true)
		}
		if e.cwd != "" {
			if dir, err := resolveCwd(e.cwd); err == nil {
				cmd.Dir = dir
			}
		}
		cmd.Env = append(os.Environ(), "TERM=xterm-256color")
		backend, err := startTerminal(cmd, clampDim(req.Cols), clampDim(req.Rows))
		e.mu.Lock()
		e.starting = false
		if err != nil {
			e.mu.Unlock()
			fail(channel, fmt.Errorf("starting pty: %w", err))
			return
		}
		e.backend = backend
		go a.pumpEphemeral(e)
	}
	previous := e.channel
	e.channel = channel
	e.activity = time.Now().Unix()
	backend := e.backend
	replay := append([]byte(nil), e.scroll...)
	e.mu.Unlock()

	a.mu.Lock()
	if previous != 0 {
		delete(a.terms, previous)
	}
	a.terms[channel] = &termStream{channel: channel, backend: backend, eph: e}
	a.mu.Unlock()
	if previous != 0 && previous != channel {
		fail(previous, fmt.Errorf("opened in another window"))
	}

	_ = backend.Resize(clampDim(req.Cols), clampDim(req.Rows))
	opened, _ := protocol.NewMsg(protocol.TypeTermOpened, 0, channel, nil)
	a.send(opened)
	if len(replay) > 0 {
		_ = a.sendBinary(channel, replay)
	}
}

// pumpEphemeral owns the session's PTY for its whole life, forwarding output
// to whichever channel is attached and keeping recent output for replay.
func (a *Agent) pumpEphemeral(e *ephemeralSession) {
	buf := make([]byte, 32*1024)
	for {
		n, err := e.backend.Read(buf)
		if n > 0 {
			e.mu.Lock()
			e.scroll = append(e.scroll, buf[:n]...)
			if over := len(e.scroll) - ephemeralScrollback; over > 0 {
				e.scroll = append([]byte(nil), e.scroll[over:]...)
			}
			e.activity = time.Now().Unix()
			channel := e.channel
			e.mu.Unlock()
			if channel != 0 {
				_ = a.sendBinary(channel, buf[:n])
			}
		}
		if err != nil {
			break
		}
	}
	e.backend.KillWait()
	e.closeOnce.Do(func() { e.backend.Close() })

	ephMu.Lock()
	if ephByName[e.name] == e {
		delete(ephByName, e.name)
	}
	ephMu.Unlock()

	e.mu.Lock()
	channel := e.channel
	e.channel = 0
	e.mu.Unlock()
	if channel != 0 {
		a.mu.Lock()
		delete(a.terms, channel)
		a.mu.Unlock()
		exit, _ := protocol.NewMsg(protocol.TypeTermExit, 0, channel, nil)
		a.send(exit)
	}
}
