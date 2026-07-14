// Package agent implements the device-side of Overseer: it dials out to the
// hub over a single WebSocket and serves terminal, exec, stats and file
// requests over it. It never listens on any port.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v4/host"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Config is what an enrolled agent needs to reach its hub.
type Config struct {
	HubURL   string `json:"hubUrl"` // e.g. http://192.168.1.10:4200
	DeviceId string `json:"deviceId"`
	Token    string `json:"token"`
}

// Agent maintains the hub connection and dispatches requests.
type Agent struct {
	cfg     Config
	version string

	// writeMu serializes websocket writes (gorilla forbids concurrent writers)
	// and is intentionally separate from mu: a blocking write must not freeze
	// state access (terms/files/conn) for every other goroutine.
	writeMu sync.Mutex

	mu                sync.Mutex
	conn              *websocket.Conn
	terms             map[uint32]*termStream
	files             map[uint32]*fileStream
	nextUpdateAttempt time.Time
	updateApplied     bool
}

func New(cfg Config, version string) *Agent {
	augmentManagedPath()
	return &Agent{
		cfg:     cfg,
		version: version,
		terms:   map[uint32]*termStream{},
		files:   map[uint32]*fileStream{},
	}
}

// augmentManagedPath makes tools installed through Overseer's setup center
// available to background agents too. Service managers often start with a
// much smaller PATH than an interactive shell, especially on macOS/Windows.
func augmentManagedPath() {
	home, _ := os.UserHomeDir()
	paths := filepath.SplitList(os.Getenv("PATH"))
	if runtime.GOOS == "windows" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		paths = append([]string{
			filepath.Join(base, "Overseer", "bin"),
			filepath.Join(base, "Overseer", "tools", "node_modules", ".bin"),
			filepath.Join(home, ".local", "bin"),
		}, paths...)
	} else {
		paths = append([]string{
			filepath.Join(home, ".overseer", "bin"),
			filepath.Join(home, ".overseer", "tools", "node_modules", ".bin"),
			filepath.Join(home, ".local", "bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
		}, paths...)
	}
	os.Setenv("PATH", strings.Join(paths, string(os.PathListSeparator)))
}

// errUpdated signals that the agent replaced its own binary and should exit so
// the service manager restarts into the new build.
var errUpdated = errors.New("self-updated; restarting")

// Run connects and serves forever, reconnecting with backoff until ctx ends.
func (a *Agent) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		connected, err := a.runOnce(ctx)
		if errors.Is(err, errUpdated) {
			return nil // exit cleanly; the service restarts the new binary
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// A connection that actually came up resets the backoff, so a long-lived
		// session that later drops reconnects quickly instead of waiting ~30s.
		if connected {
			backoff = time.Second
		}
		log.Printf("hub connection lost: %v — reconnecting in %s", err, backoff)
		select {
		case <-time.After(backoff + time.Duration(rand.Int64N(int64(backoff/2+1)))):
		case <-ctx.Done():
			return ctx.Err()
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

// runOnce dials the hub and serves until the connection drops. The bool
// reports whether a connection was actually established (used to reset the
// reconnect backoff).
func (a *Agent) runOnce(ctx context.Context) (bool, error) {
	wsURL := strings.Replace(strings.Replace(a.cfg.HubURL, "https://", "wss://", 1), "http://", "ws://", 1) + "/api/ws/agent"
	hdr := http.Header{"Authorization": {"Bearer " + a.cfg.Token}}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, wsURL, hdr)
	if err != nil {
		return false, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	hostname, _ := os.Hostname()
	info, _ := host.Info()
	if info == nil {
		info = &host.InfoStat{}
	}
	hello, _ := protocol.NewMsg(protocol.TypeHello, 0, 0, protocol.Hello{
		Hostname:        hostname,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		Version:         a.version,
		Tmux:            tmuxAvailable(),
		Platform:        info.Platform,
		PlatformVersion: info.PlatformVersion,
		KernelVersion:   info.KernelVersion,
	})
	if err := conn.WriteJSON(hello); err != nil {
		return false, err
	}
	var welcome protocol.Msg
	if err := conn.ReadJSON(&welcome); err != nil {
		return false, fmt.Errorf("waiting for welcome: %w", err)
	}
	if welcome.Type != protocol.TypeWelcome {
		return false, fmt.Errorf("hub rejected connection: %s %s", welcome.Type, welcome.Error)
	}
	log.Printf("connected to hub %s", a.cfg.HubURL)

	// If the hub is running a newer released version, self-update and restart
	// (managed service only). Do this before serving so we don't drop live work.
	var w protocol.Welcome
	if json.Unmarshal(welcome.Data, &w) == nil && a.maybeSelfUpdate(ctx, w.Version, w.Repo) {
		return true, errUpdated
	}

	a.mu.Lock()
	a.conn = conn
	a.mu.Unlock()
	defer a.teardown()

	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go a.statsLoop(cctx)
	go a.autoUpdateLoop(cctx, w.Version, w.Repo)
	go func() { // hub going away should unblock the read loop promptly
		<-cctx.Done()
		conn.Close()
	}()

	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			a.mu.Lock()
			updated := a.updateApplied
			a.updateApplied = false
			a.mu.Unlock()
			if updated {
				return true, errUpdated
			}
			return true, err
		}
		switch msgType {
		case websocket.TextMessage:
			var m protocol.Msg
			if err := json.Unmarshal(data, &m); err != nil {
				log.Printf("bad control message: %v", err)
				continue
			}
			// Dispatch inline so channel-setup messages (term.open, fs.write)
			// are ordered ahead of the binary frames that follow them on the
			// same read loop. Handlers that block offload to their own
			// goroutine internally.
			a.dispatch(m)
		case websocket.BinaryMessage:
			ch, payload, err := protocol.DecodeFrame(data)
			if err != nil {
				continue
			}
			a.handleBinary(ch, payload)
		}
	}
}

func (a *Agent) teardown() {
	a.mu.Lock()
	terms := a.terms
	files := a.files
	a.terms = map[uint32]*termStream{}
	a.files = map[uint32]*fileStream{}
	a.conn = nil
	a.mu.Unlock()
	for _, t := range terms {
		t.close()
	}
	for _, f := range files {
		f.close()
	}
}

// writeDeadline bounds a single websocket write so a stuck/slow hub can't wedge
// the agent's write path forever.
const writeDeadline = 30 * time.Second

// conn snapshots the current connection under mu (held only briefly).
func (a *Agent) currentConn() *websocket.Conn {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conn
}

// send writes one JSON control message to the hub (safe for concurrent use).
func (a *Agent) send(m protocol.Msg) {
	conn := a.currentConn()
	if conn == nil {
		return
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	if err := conn.WriteJSON(m); err != nil {
		log.Printf("send %s: %v", m.Type, err)
	}
}

// sendBinary writes one binary frame to the hub (safe for concurrent use).
func (a *Agent) sendBinary(channel uint32, payload []byte) error {
	conn := a.currentConn()
	if conn == nil {
		return fmt.Errorf("not connected")
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	return conn.WriteMessage(websocket.BinaryMessage, protocol.EncodeFrame(channel, payload))
}

func (a *Agent) reply(id uint64, v any, err error) {
	m := protocol.Msg{Type: protocol.TypeResult, Id: id}
	if err != nil {
		m.Error = err.Error()
	} else if v != nil {
		b, jerr := json.Marshal(v)
		if jerr != nil {
			m.Error = jerr.Error()
		} else {
			m.Data = b
		}
	}
	a.send(m)
}

// dispatch handles one control message. It runs inline on the read loop so
// that channel-setup messages are ordered with the binary frames that follow;
// the request/reply handlers below can block (tmux, exec), so each runs in its
// own goroutine to keep the read loop moving.
func (a *Agent) dispatch(m protocol.Msg) {
	switch m.Type {
	case protocol.TypeSessionsList:
		go func() {
			sessions, err := a.listSessions()
			a.reply(m.Id, protocol.SessionsListResult{Sessions: sessions}, err)
		}()
	case protocol.TypeSessionCreate:
		var req protocol.SessionCreate
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go a.reply(m.Id, nil, a.createSession(req))
	case protocol.TypeSessionKill:
		var req protocol.SessionKill
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go a.reply(m.Id, nil, a.killSession(req.Name))
	case protocol.TypeExec:
		var req protocol.Exec
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go func() {
			res := a.execCommand(req)
			a.reply(m.Id, res, nil)
		}()
	case protocol.TypeFsList:
		var req protocol.FsList
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go func() {
			res, err := a.fsList(req.Path)
			a.reply(m.Id, res, err)
		}()
	case protocol.TypeTermOpen:
		var req protocol.TermOpen
		if err := json.Unmarshal(m.Data, &req); err == nil {
			a.termOpen(m.Channel, req)
		}
	case protocol.TypeTermResize:
		var req protocol.TermResize
		if err := json.Unmarshal(m.Data, &req); err == nil {
			a.termResize(m.Channel, req)
		}
	case protocol.TypeTermClose:
		a.termClose(m.Channel)
	case protocol.TypeFsRead:
		var req protocol.FsTransfer
		if err := json.Unmarshal(m.Data, &req); err == nil {
			go a.fsRead(m.Channel, req.Path)
		}
	case protocol.TypeFsWrite:
		var req protocol.FsTransfer
		if err := json.Unmarshal(m.Data, &req); err == nil {
			a.fsWriteStart(m.Channel, req.Path)
		}
	case protocol.TypeFsEOF:
		a.fsWriteFinish(m.Channel, "")
	case protocol.TypeFsErr:
		a.fsWriteFinish(m.Channel, m.Error)
	}
}

func (a *Agent) handleBinary(channel uint32, payload []byte) {
	a.mu.Lock()
	t := a.terms[channel]
	f := a.files[channel]
	a.mu.Unlock()
	if t != nil {
		t.write(payload)
	} else if f != nil {
		f.write(payload)
	}
}

func tmuxAvailable() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}
