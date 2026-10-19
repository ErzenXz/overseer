package hub

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// desktopUpgrader is the default upgrader plus the "binary" subprotocol that
// noVNC (websockify-compatible clients) asks for.
var desktopUpgrader = websocket.Upgrader{
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
	CheckOrigin:     checkOrigin,
	Subprotocols:    []string{"binary"},
}

// handleDeviceDesktop reports whether the device runs a reachable VNC server.
func (s *Server) handleDeviceDesktop(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(15 * time.Second)
	defer cancel()
	var res protocol.DesktopProbeResult
	if err := c.requestInto(ctx, protocol.TypeDesktopProbe, struct{}{}, &res); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, res)
}

// handleDesktopWS bridges a browser WebSocket to the device's local VNC port
// through the agent connection. Each binary frame is a chunk of the TCP
// stream in either direction, so noVNC can drive it directly.
func (s *Server) handleDesktopWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	deviceId := q.Get("device")
	port, err := strconv.Atoi(q.Get("port"))
	if q.Get("port") == "" {
		port, err = 5900, nil
	}
	if deviceId == "" || err != nil || port < 1 || port > 65535 {
		httpError(w, http.StatusBadRequest, "device and a valid port are required")
		return
	}
	c := s.registry.get(deviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	browser, err := desktopUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer browser.Close()

	var browserMu sync.Mutex
	sendBrowser := func(msgType int, data []byte) error {
		browserMu.Lock()
		defer browserMu.Unlock()
		// Bounded so a stalled browser can't wedge the device's read loop.
		browser.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return browser.WriteMessage(msgType, data)
	}
	exit := make(chan string, 3)
	signal := func(msg string) {
		select {
		case exit <- msg:
		default:
		}
	}

	ch := c.openChannel(&hubChannel{
		onBinary: func(p []byte) {
			if err := sendBrowser(websocket.BinaryMessage, p); err != nil {
				signal("")
			}
		},
		onControl: func(m protocol.Msg) {
			switch m.Type {
			case protocol.TypeTcpClose, protocol.TypeTermExit:
				signal(m.Error)
			}
		},
	})
	defer c.closeChannel(ch)
	defer func() {
		closeMsg, _ := protocol.NewMsg(protocol.TypeTcpClose, 0, ch, nil)
		c.sendJSON(closeMsg)
	}()

	open, _ := protocol.NewMsg(protocol.TypeTcpOpen, 0, ch, protocol.TcpOpen{Host: "127.0.0.1", Port: port})
	if err := c.sendJSON(open); err != nil {
		signal("device connection lost")
	}

	// Browser -> agent pump.
	go func() {
		for {
			msgType, data, err := browser.ReadMessage()
			if err != nil {
				signal("")
				return
			}
			if msgType == websocket.BinaryMessage {
				if err := c.sendBinary(ch, data); err != nil {
					signal("device connection lost")
					return
				}
			}
		}
	}()

	reason := <-exit
	if len(reason) > 120 {
		reason = reason[:120]
	}
	browserMu.Lock()
	browser.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason), time.Now().Add(time.Second))
	browserMu.Unlock()
}
