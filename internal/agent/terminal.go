package agent

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// termStream is one live PTY bridged to a hub channel.
type termStream struct {
	channel uint32
	cmd     *exec.Cmd
	pty     *os.File
	once    sync.Once
}

func (t *termStream) write(p []byte) {
	if _, err := t.pty.Write(p); err != nil {
		log.Printf("term %d: pty write: %v", t.channel, err)
	}
}

// close closes the PTY, which makes pumpTerm's Read return so the process
// tears down. It deliberately does NOT Kill or Wait the process: those happen
// only in pumpTerm, so Kill and Wait never race across goroutines.
func (t *termStream) close() {
	t.once.Do(func() {
		t.pty.Close()
	})
}

// clampDim keeps hub-supplied terminal dimensions within a sane uint16 range.
func clampDim(v int) uint16 {
	if v < 1 {
		return 1
	}
	if v > 1000 {
		return 1000
	}
	return uint16(v)
}

// termOpen attaches a PTY to the named session and streams it on channel.
//
// With tmux available the PTY runs `tmux attach` (or new-session -A for
// ephemeral-less flows); without tmux this attaches to an in-memory ephemeral
// session created by createSession's fallback.
func (a *Agent) termOpen(channel uint32, req protocol.TermOpen) {
	fail := func(err error) {
		m, _ := protocol.NewMsg(protocol.TypeTermExit, 0, channel, nil)
		m.Error = err.Error()
		a.send(m)
	}

	var cmd *exec.Cmd
	if eph := a.ephemeral(req.Session); eph != nil {
		a.attachEphemeral(channel, eph, req)
		return
	}
	if !tmuxAvailable() {
		fail(fmt.Errorf("session %q not found and tmux is not installed", req.Session))
		return
	}
	// Reject a duplicate open on a channel already in use, so a buggy/hostile
	// hub can't orphan the first PTY and its goroutine.
	a.mu.Lock()
	_, busy := a.terms[channel]
	a.mu.Unlock()
	if busy {
		fail(fmt.Errorf("channel %d already open", channel))
		return
	}

	// -A creates the session if it doesn't exist, so opening a terminal for a
	// brand-new name "just works".
	cmd = exec.Command("tmux", "new-session", "-A", "-s", req.Session)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: clampDim(req.Cols), Rows: clampDim(req.Rows)})
	if err != nil {
		fail(fmt.Errorf("starting pty: %w", err))
		return
	}
	t := &termStream{channel: channel, cmd: cmd, pty: f}

	a.mu.Lock()
	a.terms[channel] = t
	a.mu.Unlock()

	opened, _ := protocol.NewMsg(protocol.TypeTermOpened, 0, channel, nil)
	a.send(opened)

	go a.pumpTerm(t)
}

// pumpTerm copies PTY output to the hub until the PTY dies.
func (a *Agent) pumpTerm(t *termStream) {
	buf := make([]byte, 32*1024)
	for {
		n, err := t.pty.Read(buf)
		if n > 0 {
			if werr := a.sendBinary(t.channel, buf[:n]); werr != nil {
				break
			}
		}
		if err != nil {
			break
		}
	}
	// Kill and Wait here (and only here) so they never race with close().
	if t.cmd.Process != nil {
		t.cmd.Process.Kill()
	}
	t.cmd.Wait()
	t.close() // idempotent; ensures the PTY is closed if we exited via read error
	a.mu.Lock()
	delete(a.terms, t.channel)
	a.mu.Unlock()
	exit, _ := protocol.NewMsg(protocol.TypeTermExit, 0, t.channel, nil)
	a.send(exit)
}

func (a *Agent) termResize(channel uint32, req protocol.TermResize) {
	a.mu.Lock()
	t := a.terms[channel]
	a.mu.Unlock()
	if t == nil {
		return
	}
	pty.Setsize(t.pty, &pty.Winsize{Cols: clampDim(req.Cols), Rows: clampDim(req.Rows)})
}

func (a *Agent) termClose(channel uint32) {
	a.mu.Lock()
	t := a.terms[channel]
	delete(a.terms, channel)
	a.mu.Unlock()
	if t != nil {
		// Detach politely: closing the PTY ends `tmux attach` without killing
		// the underlying session.
		t.close()
	}
}
