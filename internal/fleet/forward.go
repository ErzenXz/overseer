package fleet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// tcpURL is the hub's raw TCP WebSocket for localhost:port on a device.
func (c *Client) tcpURL(deviceId string, port int) string {
	base := c.HubURL
	switch {
	case strings.HasPrefix(base, "https://"):
		base = "wss://" + strings.TrimPrefix(base, "https://")
	case strings.HasPrefix(base, "http://"):
		base = "ws://" + strings.TrimPrefix(base, "http://")
	}
	return fmt.Sprintf("%s/api/ws/devices/%s/tcp/%d", base, url.PathEscape(deviceId), port)
}

// DialTCP opens one tunnelled connection to localhost:port on a device.
func (c *Client) DialTCP(ctx context.Context, deviceId string, port int) (*websocket.Conn, error) {
	d := websocket.Dialer{HandshakeTimeout: 15 * time.Second, Proxy: http.ProxyFromEnvironment}
	ws, resp, err := d.DialContext(ctx, c.tcpURL(deviceId, port), http.Header{"Authorization": {"Bearer " + c.Token}})
	if err != nil {
		if resp != nil {
			defer resp.Body.Close()
			var e struct {
				Error string `json:"error"`
			}
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
			if json.Unmarshal(body, &e) == nil && e.Error != "" {
				return nil, fmt.Errorf("%s", e.Error)
			}
			return nil, fmt.Errorf("hub refused the tunnel: %s", resp.Status)
		}
		return nil, err
	}
	return ws, nil
}

// Forward accepts connections on ln and tunnels each one, over its own
// WebSocket, to localhost:port on the device until ctx ends. Errors for
// individual connections go to logf; the listener keeps running.
func (c *Client) Forward(ctx context.Context, ln net.Listener, deviceId string, port int, logf func(string, ...any)) error {
	var mu sync.Mutex
	active := map[net.Conn]struct{}{}
	track := func(conn net.Conn, add bool) {
		mu.Lock()
		if add {
			active[conn] = struct{}{}
		} else {
			delete(active, conn)
		}
		mu.Unlock()
	}
	go func() {
		<-ctx.Done()
		ln.Close()
		mu.Lock()
		for conn := range active {
			conn.Close()
		}
		mu.Unlock()
	}()

	for {
		local, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		track(local, true)
		go func() {
			defer track(local, false)
			defer local.Close()
			ws, err := c.DialTCP(ctx, deviceId, port)
			if err != nil {
				if ctx.Err() == nil {
					logf("connection failed: %v", err)
				}
				return
			}
			defer ws.Close()
			pipeWebSocket(local, ws)
		}()
	}
}

// pipeWebSocket copies local <-> ws (binary frames) until either side ends.
func pipeWebSocket(local net.Conn, ws *websocket.Conn) {
	done := make(chan struct{}, 2)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := local.Read(buf)
			if n > 0 {
				if ws.WriteMessage(websocket.BinaryMessage, buf[:n]) != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
		done <- struct{}{}
	}()
	go func() {
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				break
			}
			if msgType == websocket.BinaryMessage {
				if _, err := local.Write(data); err != nil {
					break
				}
			}
		}
		done <- struct{}{}
	}()
	<-done
	local.Close()
	ws.Close()
	<-done
}
