package agent

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"

	"github.com/ErzenXz/overseer/internal/protocol"
)

const (
	execOutputCap  = 256 * 1024 // per stream (stdout/stderr)
	statsInterval  = 5 * time.Second
	fileChunkSize  = 64 * 1024
)

// --- stats ---

func (a *Agent) statsLoop(ctx context.Context) {
	ticker := time.NewTicker(statsInterval)
	defer ticker.Stop()
	for {
		a.sendStats(ctx)
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
	}
}

func (a *Agent) sendStats(ctx context.Context) {
	var s protocol.Stats
	if pcts, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(pcts) > 0 {
		s.CPUPercent = pcts[0]
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		s.MemUsed, s.MemTotal = vm.Used, vm.Total
	}
	if du, err := disk.Usage("/"); err == nil {
		s.DiskUsed, s.DiskTotal = du.Used, du.Total
	}
	if up, err := host.Uptime(); err == nil {
		s.UptimeSec = up
	}
	m, err := protocol.NewMsg(protocol.TypeStats, 0, 0, s)
	if err == nil {
		a.send(m)
	}
}

// --- exec ---

// cappedBuf collects up to limit bytes and records whether it overflowed.
type cappedBuf struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (c *cappedBuf) Write(p []byte) (int, error) {
	room := c.limit - c.buf.Len()
	if room <= 0 {
		c.truncated = true
		return len(p), nil
	}
	if len(p) > room {
		c.buf.Write(p[:room])
		c.truncated = true
		return len(p), nil
	}
	return c.buf.Write(p)
}

func (a *Agent) execCommand(req protocol.Exec) protocol.ExecResult {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	if timeout > 10*time.Minute {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.CommandContext(ctx, shell, "-c", req.Command)
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}
	stdout := &cappedBuf{limit: execOutputCap}
	stderr := &cappedBuf{limit: execOutputCap}
	cmd.Stdout, cmd.Stderr = stdout, stderr

	err := cmd.Run()
	res := protocol.ExecResult{
		Stdout:    stdout.buf.String(),
		Stderr:    stderr.buf.String(),
		Truncated: stdout.truncated || stderr.truncated,
	}
	if ctx.Err() == context.DeadlineExceeded {
		res.ExitCode = -1
		res.Stderr += fmt.Sprintf("\n[overseer] command timed out after %s", timeout)
		return res
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		res.ExitCode = exitErr.ExitCode()
	} else if err != nil {
		res.ExitCode = -1
		res.Stderr += "\n[overseer] " + err.Error()
	}
	return res
}

// --- file operations ---

func (a *Agent) fsList(path string) (protocol.FsListResult, error) {
	if path == "" || path == "~" {
		home, _ := os.UserHomeDir()
		path = home
	}
	path = filepath.Clean(path)
	entries, err := os.ReadDir(path)
	if err != nil {
		return protocol.FsListResult{}, err
	}
	res := protocol.FsListResult{Path: path}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		res.Entries = append(res.Entries, protocol.FsEntry{
			Name:    e.Name(),
			Dir:     e.IsDir(),
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().Unix(),
		})
	}
	sort.Slice(res.Entries, func(i, j int) bool {
		if res.Entries[i].Dir != res.Entries[j].Dir {
			return res.Entries[i].Dir
		}
		return res.Entries[i].Name < res.Entries[j].Name
	})
	return res, nil
}

// fsRead streams a file to the hub on channel, ending with fs.eof / fs.err.
func (a *Agent) fsRead(channel uint32, path string) {
	fail := func(err error) {
		m := protocol.Msg{Type: protocol.TypeFsErr, Channel: channel, Error: err.Error()}
		a.send(m)
	}
	f, err := os.Open(path)
	if err != nil {
		fail(err)
		return
	}
	defer f.Close()
	// Only stream regular files. Character devices (/dev/zero), FIFOs, and the
	// like would block or stream forever, pinning a goroutine.
	if info, err := f.Stat(); err != nil {
		fail(err)
		return
	} else if !info.Mode().IsRegular() {
		fail(fmt.Errorf("not a regular file"))
		return
	}
	buf := make([]byte, fileChunkSize)
	for {
		n, err := f.Read(buf)
		if n > 0 {
			if werr := a.sendBinary(channel, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			break
		}
	}
	a.send(protocol.Msg{Type: protocol.TypeFsEOF, Channel: channel})
}

// fileStream is an in-progress upload (hub -> agent).
type fileStream struct {
	channel uint32
	path    string
	tmp     *os.File
	mu      sync.Mutex
	err     error
}

func (f *fileStream) write(p []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return
	}
	if _, err := f.tmp.Write(p); err != nil {
		f.err = err
	}
}

func (f *fileStream) close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.tmp != nil {
		name := f.tmp.Name()
		f.tmp.Close()
		os.Remove(name)
		f.tmp = nil
	}
}

func (a *Agent) fsWriteStart(channel uint32, path string) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".overseer-upload-*")
	if err != nil {
		a.send(protocol.Msg{Type: protocol.TypeFsErr, Channel: channel, Error: err.Error()})
		return
	}
	a.mu.Lock()
	a.files[channel] = &fileStream{channel: channel, path: path, tmp: tmp}
	a.mu.Unlock()
}

// fsWriteFinish commits (errMsg == "") or aborts an upload.
func (a *Agent) fsWriteFinish(channel uint32, errMsg string) {
	a.mu.Lock()
	f := a.files[channel]
	delete(a.files, channel)
	a.mu.Unlock()
	if f == nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.tmp == nil {
		return
	}
	tmpName := f.tmp.Name()
	f.tmp.Close()
	f.tmp = nil
	if errMsg != "" || f.err != nil {
		os.Remove(tmpName)
		if f.err != nil {
			a.send(protocol.Msg{Type: protocol.TypeFsErr, Channel: channel, Error: f.err.Error()})
		}
		return
	}
	if err := os.Rename(tmpName, f.path); err != nil {
		os.Remove(tmpName)
		a.send(protocol.Msg{Type: protocol.TypeFsErr, Channel: channel, Error: err.Error()})
		return
	}
	a.send(protocol.Msg{Type: protocol.TypeFsEOF, Channel: channel})
	log.Printf("upload complete: %s", f.path)
}
