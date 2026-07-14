package agent

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	psnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/ErzenXz/overseer/internal/protocol"
)

const (
	execOutputCap = 256 * 1024 // per stream (stdout/stderr)
	statsInterval = 5 * time.Second
	fileChunkSize = 64 * 1024
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
	s.CPUCores, _ = cpu.CountsWithContext(ctx, true)
	if pcts, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(pcts) > 0 {
		s.CPUPercent = pcts[0]
	}
	if avg, err := load.AvgWithContext(ctx); err == nil {
		s.Load1, s.Load5, s.Load15 = avg.Load1, avg.Load5, avg.Load15
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		s.MemUsed, s.MemTotal = vm.Used, vm.Total
	}
	if swap, err := mem.SwapMemoryWithContext(ctx); err == nil {
		s.SwapUsed, s.SwapTotal = swap.Used, swap.Total
	}
	diskRoot := "/"
	if runtime.GOOS == "windows" {
		diskRoot = os.Getenv("SystemDrive")
		if diskRoot == "" {
			diskRoot = "C:"
		}
		diskRoot += `\`
	}
	if du, err := disk.Usage(diskRoot); err == nil {
		s.DiskUsed, s.DiskTotal = du.Used, du.Total
	}
	if up, err := host.Uptime(); err == nil {
		s.UptimeSec = up
	}
	if counters, err := psnet.IOCountersWithContext(ctx, false); err == nil && len(counters) > 0 {
		s.NetRxBytes, s.NetTxBytes = counters[0].BytesRecv, counters[0].BytesSent
	}
	if pids, err := process.PidsWithContext(ctx); err == nil {
		s.ProcessCount = uint64(len(pids))
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

	cmd := shellCommandContext(ctx, req.Command, false)
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

func shellCommandContext(ctx context.Context, command string, login bool) *exec.Cmd {
	if runtime.GOOS == "windows" {
		if command == "" {
			return exec.CommandContext(ctx, "powershell.exe", "-NoLogo")
		}
		return exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-Command", command)
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	if command != "" {
		return exec.CommandContext(ctx, shell, "-c", command)
	}
	if login {
		return exec.CommandContext(ctx, shell, "-l")
	}
	return exec.CommandContext(ctx, shell)
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
