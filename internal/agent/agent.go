// Package agent implements the device-side of Overseer: it dials out to the
// hub over a single WebSocket and serves terminal, exec, stats and file
// requests over it. It never listens on any port.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Config is what an enrolled agent needs to reach its hub.
type Config struct {
	HubURL   string `json:"hubUrl"`   // e.g. http://192.168.1.10:4200
	DeviceId string `json:"deviceId"`
	Token    string `json:"token"`
}

// Agent maintains the hub connection and dispatches requests.
type Agent struct {
	cfg     Config
	version string

	mu    sync.Mutex
	conn  *websocket.Conn
	terms map[uint32]*termStream
	files map[uint32]*fileStream
}

func New(cfg Config, version string) *Agent {
	return &Agent{
		cfg:     cfg,
		version: version,
		terms:   map[uint32]*termStream{},
		files:   map[uint32]*fileStream{},
	}
}

// Run connects and serves forever, reconnecting with backoff until ctx ends.
func (a *Agent) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := a.runOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
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

func (a *Agent) runOnce(ctx context.Context) error {
	wsURL := strings.Replace(strings.Replace(a.cfg.HubURL, "https://", "wss://", 1), "http://", "ws://", 1) + "/api/ws/agent"
	hdr := http.Header{"Authorization": {"Bearer " + a.cfg.Token}}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, wsURL, hdr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	hostname, _ := os.Hostname()
	hello, _ := protocol.NewMsg(protocol.TypeHello, 0, 0, protocol.Hello{
		Hostname: hostname,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Version:  a.version,
		Tmux:     tmuxAvailable(),
	})
	if err := conn.WriteJSON(hello); err != nil {
		return err
	}
	var welcome protocol.Msg
	if err := conn.ReadJSON(&welcome); err != nil {
		return fmt.Errorf("waiting for welcome: %w", err)
	}
	if welcome.Type != protocol.TypeWelcome {
		return fmt.Errorf("hub rejected connection: %s %s", welcome.Type, welcome.Error)
	}
	log.Printf("connected to hub %s", a.cfg.HubURL)

	a.mu.Lock()
	a.conn = conn
	a.mu.Unlock()
	defer a.teardown()

	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go a.statsLoop(cctx)
	go func() { // hub going away should unblock the read loop promptly
		<-cctx.Done()
		conn.Close()
	}()

	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		switch msgType {
		case websocket.TextMessage:
			var m protocol.Msg
			if err := json.Unmarshal(data, &m); err != nil {
				log.Printf("bad control message: %v", err)
				continue
			}
			go a.dispatch(m)
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

// send writes one JSON control message to the hub (safe for concurrent use).
func (a *Agent) send(m protocol.Msg) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn == nil {
		return
	}
	if err := a.conn.WriteJSON(m); err != nil {
		log.Printf("send %s: %v", m.Type, err)
	}
}

// sendBinary writes one binary frame to the hub (safe for concurrent use).
func (a *Agent) sendBinary(channel uint32, payload []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn == nil {
		return fmt.Errorf("not connected")
	}
	return a.conn.WriteMessage(websocket.BinaryMessage, protocol.EncodeFrame(channel, payload))
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

func (a *Agent) dispatch(m protocol.Msg) {
	switch m.Type {
	case protocol.TypeSessionsList:
		sessions, err := a.listSessions()
		a.reply(m.Id, protocol.SessionsListResult{Sessions: sessions}, err)
	case protocol.TypeSessionCreate:
		var req protocol.SessionCreate
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		a.reply(m.Id, nil, a.createSession(req))
	case protocol.TypeSessionKill:
		var req protocol.SessionKill
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		a.reply(m.Id, nil, a.killSession(req.Name))
	case protocol.TypeExec:
		var req protocol.Exec
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		res := a.execCommand(req)
		a.reply(m.Id, res, nil)
	case protocol.TypeFsList:
		var req protocol.FsList
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		res, err := a.fsList(req.Path)
		a.reply(m.Id, res, err)
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
