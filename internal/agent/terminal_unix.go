//go:build !windows

package agent

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixTerminal struct {
	cmd *exec.Cmd
	pty *os.File
}

func startTerminal(cmd *exec.Cmd, cols, rows uint16) (terminalBackend, error) {
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, err
	}
	return &unixTerminal{cmd: cmd, pty: f}, nil
}

func (t *unixTerminal) Read(p []byte) (int, error)  { return t.pty.Read(p) }
func (t *unixTerminal) Write(p []byte) (int, error) { return t.pty.Write(p) }
func (t *unixTerminal) Close() error                { return t.pty.Close() }
func (t *unixTerminal) Resize(cols, rows uint16) error {
	return pty.Setsize(t.pty, &pty.Winsize{Cols: cols, Rows: rows})
}
func (t *unixTerminal) KillWait() {
	if t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	_ = t.cmd.Wait()
}
