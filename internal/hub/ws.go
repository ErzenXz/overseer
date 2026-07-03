package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	CheckOrigin:     checkOrigin,
}

// checkOrigin allows same-origin browser connections and header-less clients
// (native agents send no Origin). Rejecting cross-origin requests is what
// prevents cross-site WebSocket hijacking of the cookie-authenticated term/
// events endpoints, and it blocks DNS-rebinding attacks (the rebound attacker
// host won't match r.Host). LAN access by IP still works because the browser's
// Origin host and the Host header match.
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client (agent, curl, CLI)
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

// handleAgentWS accepts a device agent connection.
func (s *Server) handleAgentWS(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		httpError(w, http.StatusUnauthorized, "missing device token")
		return
	}
	device, err := s.store.DeviceByToken(strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if device == nil {
		httpError(w, http.StatusForbidden, "unknown device token")
		return
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	ws.SetReadDeadline(time.Now().Add(15 * time.Second))
	var hello protocol.Msg
	if err := ws.ReadJSON(&hello); err != nil || hello.Type != protocol.TypeHello {
		ws.Close()
		return
	}
	var h protocol.Hello
	json.Unmarshal(hello.Data, &h)
	ws.SetReadDeadline(time.Time{})

	s.store.UpdateDeviceOnConnect(device.Id, h.Hostname, h.OS, h.Arch)

	conn := newAgentConn(device.Id, h, ws)
	welcome, _ := protocol.NewMsg(protocol.TypeWelcome, 0, 0, protocol.Welcome{DeviceId: device.Id, Version: s.opts.Version})
	if err := conn.sendJSON(welcome); err != nil {
		ws.Close()
		return
	}
	log.Printf("device %s (%s) connected", device.Name, device.Id)
	s.serveAgent(conn)
}

// handleTermWS bridges a browser terminal to a device session.
// Browser sends binary frames (raw keystrokes) and JSON text frames
// {"type":"resize","cols":N,"rows":N}. It receives raw binary output and a
// final JSON {"type":"exit","error":?}.
func (s *Server) handleTermWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	deviceId := q.Get("device")
	session := q.Get("session")
	cols := clampInt(q.Get("cols"), 80, 10, 500)
	rows := clampInt(q.Get("rows"), 24, 5, 300)
	if deviceId == "" || session == "" {
		httpError(w, http.StatusBadRequest, "device and session required")
		return
	}
	c := s.registry.get(deviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	browser, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer browser.Close()

	var browserMu sync.Mutex
	sendBrowser := func(msgType int, data []byte) error {
		browserMu.Lock()
		defer browserMu.Unlock()
		return browser.WriteMessage(msgType, data)
	}
	exit := make(chan string, 2)

	ch := c.openChannel(&hubChannel{
		onBinary: func(p []byte) {
			if err := sendBrowser(websocket.BinaryMessage, p); err != nil {
				select {
				case exit <- "": // browser gone
				default:
				}
			}
		},
		onControl: func(m protocol.Msg) {
			if m.Type == protocol.TypeTermExit {
				select {
				case exit <- m.Error:
				default:
				}
			}
		},
	})
	defer c.closeChannel(ch)
	defer func() {
		// Ask the agent to detach the PTY whichever side ended first.
		closeMsg, _ := protocol.NewMsg(protocol.TypeTermClose, 0, ch, nil)
		c.sendJSON(closeMsg)
	}()

	open, _ := protocol.NewMsg(protocol.TypeTermOpen, 0, ch, protocol.TermOpen{Session: session, Cols: cols, Rows: rows})
	if err := c.sendJSON(open); err != nil {
		sendBrowser(websocket.TextMessage, exitJSON("device connection lost"))
		return
	}

	// Browser -> agent pump.
	go func() {
		for {
			msgType, data, err := browser.ReadMessage()
			if err != nil {
				select {
				case exit <- "":
				default:
				}
				return
			}
			switch msgType {
			case websocket.BinaryMessage:
				if err := c.sendBinary(ch, data); err != nil {
					return
				}
			case websocket.TextMessage:
				var m struct {
					Type string `json:"type"`
					Cols int    `json:"cols"`
					Rows int    `json:"rows"`
				}
				if json.Unmarshal(data, &m) == nil && m.Type == "resize" {
					resize, _ := protocol.NewMsg(protocol.TypeTermResize, 0, ch, protocol.TermResize{Cols: m.Cols, Rows: m.Rows})
					c.sendJSON(resize)
				}
			}
		}
	}()

	errMsg := <-exit
	sendBrowser(websocket.TextMessage, exitJSON(errMsg))
}

func exitJSON(errMsg string) []byte {
	b, _ := json.Marshal(map[string]string{"type": "exit", "error": errMsg})
	return b
}

// handleEventsWS pushes device online/offline/stats and session-change events.
func (s *Server) handleEventsWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	events, unsubscribe := s.events.subscribe()
	defer unsubscribe()

	// Drain (and discard) client messages so pings/pongs work and closes are noticed.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case e := <-events:
			if err := ws.WriteJSON(e); err != nil {
				return
			}
		case <-ticker.C:
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func clampInt(s string, def, lo, hi int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}
