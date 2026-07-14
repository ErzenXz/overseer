//go:build windows

package agent

import (
	"os/exec"
	"syscall"

	"github.com/charmbracelet/x/conpty"
	"golang.org/x/sys/windows"
)

type windowsTerminal struct {
	pty    *conpty.ConPty
	handle windows.Handle
}

func startTerminal(cmd *exec.Cmd, cols, rows uint16) (terminalBackend, error) {
	p, err := conpty.New(int(cols), int(rows), 0)
	if err != nil {
		return nil, err
	}
	_, rawHandle, err := p.Spawn(cmd.Path, cmd.Args, &syscall.ProcAttr{Dir: cmd.Dir, Env: cmd.Env})
	if err != nil {
		_ = p.Close()
		return nil, err
	}
	return &windowsTerminal{pty: p, handle: windows.Handle(rawHandle)}, nil
}

func (t *windowsTerminal) Read(p []byte) (int, error)  { return t.pty.Read(p) }
func (t *windowsTerminal) Write(p []byte) (int, error) { return t.pty.Write(p) }
func (t *windowsTerminal) Close() error                { return t.pty.Close() }
func (t *windowsTerminal) Resize(cols, rows uint16) error {
	return t.pty.Resize(int(cols), int(rows))
}
func (t *windowsTerminal) KillWait() {
	if t.handle == 0 {
		return
	}
	// Closing ConPTY normally ends the attached process tree. Terminate is a
	// best-effort fallback for shells that outlive the pseudo console.
	_, _ = windows.WaitForSingleObject(t.handle, 1500)
	_ = windows.TerminateProcess(t.handle, 1)
	_, _ = windows.WaitForSingleObject(t.handle, windows.INFINITE)
	_ = windows.CloseHandle(t.handle)
	t.handle = 0
}
