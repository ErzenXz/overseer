package agent

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"

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

// --- ephemeral fallback (no tmux): sessions exist only while attached ---

type ephemeralSession struct {
	name      string
	cwd       string
	command   string
	kind      string
	createdAt int64

	mu       sync.Mutex
	stream   *termStream
	activity int64
}

var (
	ephMu   sync.Mutex
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
			Attached: e.stream != nil, Ephemeral: true,
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
	if e.stream != nil {
		e.stream.close()
	}
	e.mu.Unlock()
	return true
}

// attachEphemeral starts the session's process directly on a PTY. Without
// tmux there is nothing to reattach to — the process lives and dies with the
// terminal channel.
func (a *Agent) attachEphemeral(channel uint32, e *ephemeralSession, req protocol.TermOpen) {
	fail := func(err error) {
		m, _ := protocol.NewMsg(protocol.TypeTermExit, 0, channel, nil)
		m.Error = err.Error()
		a.send(m)
	}
	e.mu.Lock()
	if e.stream != nil {
		e.mu.Unlock()
		fail(fmt.Errorf("ephemeral session %q is already attached elsewhere", e.name))
		return
	}
	e.mu.Unlock()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	var cmd *exec.Cmd
	if e.command != "" {
		cmd = exec.Command(shell, "-c", e.command)
	} else {
		cmd = exec.Command(shell, "-l")
	}
	if e.cwd != "" {
		cmd.Dir = e.cwd
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(req.Cols), Rows: uint16(req.Rows)})
	if err != nil {
		fail(fmt.Errorf("starting pty: %w", err))
		return
	}
	t := &termStream{channel: channel, cmd: cmd, pty: f}

	e.mu.Lock()
	e.stream = t
	e.activity = time.Now().Unix()
	e.mu.Unlock()

	a.mu.Lock()
	a.terms[channel] = t
	a.mu.Unlock()

	opened, _ := protocol.NewMsg(protocol.TypeTermOpened, 0, channel, nil)
	a.send(opened)

	go func() {
		a.pumpTerm(t)
		// The process is gone; the ephemeral session goes with it.
		ephMu.Lock()
		if ephByName[e.name] != nil && ephByName[e.name] == e {
			delete(ephByName, e.name)
		}
		ephMu.Unlock()
	}()
}
