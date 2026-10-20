package agent

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	stderrTail   = 4 * 1024         // bytes of stderr kept for error reports
	maxLineBytes = 64 * 1024 * 1024 // one NDJSON line (tool results can be large)
)

// tailBuffer keeps the last limit bytes written to it.
type tailBuffer struct {
	mu    sync.Mutex
	limit int
	buf   []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if over := len(t.buf) - t.limit; over > 0 {
		t.buf = append([]byte(nil), t.buf[over:]...)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

// agentProcess is one coding-agent CLI speaking newline-delimited JSON on its
// stdio. A single goroutine reads stdout and hands each line to onLine in
// order; stderr is kept (tail only) for error reporting.
type agentProcess struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	wmu    sync.Mutex
	stderr *tailBuffer

	done    chan struct{} // closed after the process has been reaped
	waitErr error
}

// startAgentProcess spawns bin (already resolved via PATH) in cwd. The
// caller must then call readLines exactly once.
func startAgentProcess(bin string, args []string, cwd string, env []string) (*agentProcess, error) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = cwd
	cmd.Env = env
	// Bound Wait when grandchildren keep stderr open after the agent exits.
	cmd.WaitDelay = 3 * time.Second
	setProcGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	p := &agentProcess{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: &tailBuffer{limit: stderrTail},
		done:   make(chan struct{}),
	}
	cmd.Stderr = p.stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return p, nil
}

// readLines starts the stdout reader, handing each JSON line to onLine in
// order. done closes once stdout hits EOF and the process is reaped.
func (p *agentProcess) readLines(onLine func([]byte)) {
	stdout := p.stdout
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 256*1024), maxLineBytes)
		for sc.Scan() {
			line := bytes.TrimSpace(sc.Bytes())
			if len(line) == 0 || line[0] != '{' {
				continue // banners, progress output, blank lines
			}
			onLine(line)
		}
		// Drain anything left so the child never blocks on a full pipe.
		io.Copy(io.Discard, stdout)
		p.waitErr = p.cmd.Wait()
		close(p.done)
	}()
}

// writeJSON sends one JSON value as a line on stdin.
func (p *agentProcess) writeJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	p.wmu.Lock()
	defer p.wmu.Unlock()
	_, err = p.stdin.Write(append(b, '\n'))
	return err
}

func (p *agentProcess) alive() bool {
	select {
	case <-p.done:
		return false
	default:
		return true
	}
}

// kill stops the process tree and waits for it to be reaped.
func (p *agentProcess) kill() {
	p.stdin.Close()
	killProcessTree(p.cmd, p.done)
	<-p.done
}

// exitError describes why the process ended, with the stderr tail attached.
func (p *agentProcess) exitError() string {
	msg := "agent process exited"
	if p.waitErr != nil {
		msg = fmt.Sprintf("agent process exited: %v", p.waitErr)
	}
	if tail := p.stderr.String(); tail != "" {
		msg += "\n" + tail
	}
	return msg
}

// lookAgentBinary resolves a CLI on PATH with a friendly error.
func lookAgentBinary(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("%s is not installed on this machine (not found in PATH)", name)
	}
	return path, nil
}

// agentEnv is the environment for agent CLIs. Variables that make a CLI think
// it is nested inside another agent session are dropped.
func agentEnv() []string {
	out := make([]string, 0, len(os.Environ()))
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "CLAUDECODE=") || strings.HasPrefix(kv, "CLAUDE_CODE_ENTRYPOINT=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}
