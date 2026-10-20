package hub

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The preview reverse proxy and the raw TCP endpoint behind `overseer
// forward`. Both ride the device's loopback-only tcp.open tunnel through
// dialDevice, which hands out an ordinary net.Conn per channel.

const (
	tunnelQueue      = 512              // device->hub chunks buffered per stream
	tunnelStall      = 15 * time.Second // a reader this far behind loses its stream
	tunnelDialWait   = 10 * time.Second
	portsListTimeout = 3 * time.Second
)

// tunnelDialError is the device's failure to connect to the local port.
type tunnelDialError struct{ msg string }

func (e *tunnelDialError) Error() string { return e.msg }

// openTunnel opens one tcp.open channel to host:port on the device and
// returns the caller's end of a net.Pipe bridged to it. The pipe gives the
// caller full net.Conn semantics (deadlines, Close) for free; a queue in
// front of it keeps a slow reader from blocking the device's read loop for
// more than tunnelStall.
func openTunnel(ctx context.Context, c *agentConn, host string, port int) (net.Conn, error) {
	local, pipe := net.Pipe()
	queue := make(chan []byte, tunnelQueue)
	opened := make(chan struct{})
	remoteDone := make(chan struct{}) // the device ended the stream
	localDone := make(chan struct{})  // our side stopped (caller closed)
	var remoteOnce, openOnce sync.Once
	var remoteErr string
	endRemote := func(reason string) {
		remoteOnce.Do(func() {
			remoteErr = reason
			close(remoteDone)
		})
	}

	ch := c.openChannel(&hubChannel{
		onBinary: func(p []byte) {
			select {
			case queue <- p:
				return
			case <-localDone:
				return
			default:
			}
			t := time.NewTimer(tunnelStall)
			defer t.Stop()
			select {
			case queue <- p:
			case <-localDone:
			case <-t.C:
				pipe.Close() // reader stalled; drop the stream rather than the device
			}
		},
		onControl: func(m protocol.Msg) {
			switch m.Type {
			case protocol.TypeTcpOpened:
				openOnce.Do(func() { close(opened) })
			case protocol.TypeTcpClose:
				endRemote(m.Error)
			case protocol.TypeTermExit: // device connection dropped
				endRemote(errDeviceOffline.Error())
			}
		},
	})
	sendClose := func() {
		m, _ := protocol.NewMsg(protocol.TypeTcpClose, 0, ch, nil)
		c.sendJSON(m)
	}
	open, _ := protocol.NewMsg(protocol.TypeTcpOpen, 0, ch, protocol.TcpOpen{Host: host, Port: port})
	if err := c.sendJSON(open); err != nil {
		c.closeChannel(ch)
		return nil, errDeviceOffline
	}

	wait := time.NewTimer(tunnelDialWait)
	defer wait.Stop()
	select {
	case <-opened:
	case <-remoteDone:
		c.closeChannel(ch)
		if remoteErr == errDeviceOffline.Error() {
			return nil, errDeviceOffline
		}
		if remoteErr == "" {
			remoteErr = "connection closed"
		}
		return nil, &tunnelDialError{msg: remoteErr}
	case <-ctx.Done():
		c.closeChannel(ch)
		sendClose()
		return nil, ctx.Err()
	case <-wait.C:
		c.closeChannel(ch)
		sendClose()
		return nil, &tunnelDialError{msg: "timed out connecting"}
	}

	// device -> caller: drain the queue into the pipe; after the device
	// closes, deliver what is buffered and then EOF.
	go func() {
		defer pipe.Close()
		for {
			select {
			case p := <-queue:
				if _, err := pipe.Write(p); err != nil {
					return
				}
			case <-remoteDone:
				for {
					select {
					case p := <-queue:
						if _, err := pipe.Write(p); err != nil {
							return
						}
					default:
						return
					}
				}
			case <-localDone:
				return
			}
		}
	}()
	// caller -> device; ends when the caller closes its end.
	go func() {
		defer func() {
			close(localDone)
			c.closeChannel(ch)
			select {
			case <-remoteDone:
			default:
				sendClose()
			}
		}()
		buf := make([]byte, 32*1024)
		for {
			n, err := pipe.Read(buf)
			if n > 0 {
				if c.sendBinary(ch, buf[:n]) != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
	return local, nil
}

// dialDevice connects to localhost:port on a device: 127.0.0.1 first, then
// [::1] (many dev servers bind only one of them). The address that worked
// is remembered per device and port so later connections need one try.
func (s *Server) dialDevice(ctx context.Context, deviceId string, port int) (net.Conn, error) {
	c := s.registry.get(deviceId)
	if c == nil {
		return nil, errDeviceOffline
	}
	key := deviceId + ":" + strconv.Itoa(port)
	hosts := []string{"127.0.0.1", "::1"}
	if v, ok := s.tunnelHosts.Load(key); ok && v.(string) == "::1" {
		hosts = []string{"::1", "127.0.0.1"}
	}
	var firstErr error
	for _, h := range hosts {
		conn, err := openTunnel(ctx, c, h, port)
		if err == nil {
			s.tunnelHosts.Store(key, h)
			return conn, nil
		}
		var de *tunnelDialError
		if !errors.As(err, &de) {
			return nil, err // offline or cancelled: no point trying again
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	return nil, firstErr
}

// newPreviewTransport pools upstream connections per device and port. The
// URL host is "{deviceId}:{port}"; the Host header sent is localhost:{port}.
func (s *Server) newPreviewTransport() *http.Transport {
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			id, portStr, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			port, err := strconv.Atoi(portStr)
			if err != nil {
				return nil, err
			}
			return s.dialDevice(ctx, id, port)
		},
		MaxIdleConns:        256,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  true, // pass the dev server's encoding through untouched
	}
}

// servePreview handles every request whose Host is a preview origin.
func (s *Server) servePreview(w http.ResponseWriter, r *http.Request, ph previewHost) {
	rawQuery, token := withoutQueryParam(r.URL.RawQuery, previewTokenParam)
	authed := false
	if c, err := r.Cookie(previewCookie); err == nil {
		authed = s.previewAuth.cookieValid(c.Value, ph.host)
	}

	// Step 3 of the handoff: trade the one-time token for a cookie and drop
	// it from the address bar.
	if _, hasToken := r.URL.Query()[previewTokenParam]; hasToken {
		if s.previewAuth.consumeToken(token, ph.host) {
			http.SetCookie(w, &http.Cookie{
				Name: previewCookie, Value: s.previewAuth.mintCookie(ph.host), Path: "/",
				HttpOnly: true, Secure: requestScheme(r) == "https", SameSite: http.SameSiteLaxMode,
				MaxAge: int(previewCookieTTL.Seconds()),
			})
			authed = true
		}
		if authed {
			loc := r.URL.EscapedPath()
			if rawQuery != "" {
				loc += "?" + rawQuery
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Referrer-Policy", "no-referrer")
			http.Redirect(w, r, loc, http.StatusFound)
			return
		}
	}
	if !authed {
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && !isUpgrade(r) {
			s.previewAuthRedirect(w, r, ph, rawQuery)
			return
		}
		http.Error(w, "not authenticated: open this preview in the browser first", http.StatusUnauthorized)
		return
	}

	device, err := s.previewDevice(ph.slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if device == nil {
		previewPage(w, http.StatusNotFound, "No such machine",
			fmt.Sprintf("No machine in Overseer is called %q.", ph.slug), false)
		return
	}
	if isUpgrade(r) && !s.previewOriginAllowed(r) {
		http.Error(w, "cross-origin WebSocket refused", http.StatusForbidden)
		return
	}
	r.URL.RawQuery = rawQuery
	s.previewProxy(device, ph, requestScheme(r)).ServeHTTP(w, r)
}

func isUpgrade(r *http.Request) bool {
	return r.Header.Get("Upgrade") != "" && headerHasToken(r.Header, "Connection", "upgrade")
}

func headerHasToken(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, t := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(t), token) {
				return true
			}
		}
	}
	return false
}

// previewOriginAllowed lets WebSockets in only from preview origins of this
// hub (the page itself, or a sibling port such as a frontend talking to its
// API), so other sites on the same registrable domain can't ride the cookie.
func (s *Server) previewOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // not a browser
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	_, ok := s.matchPreviewHost(u.Host)
	return ok
}

// previewProxy builds the reverse proxy for one preview request.
func (s *Server) previewProxy(device *Device, ph previewHost, scheme string) *httputil.ReverseProxy {
	port := strconv.Itoa(ph.port)
	local := "localhost:" + port
	previewOrigin := scheme + "://" + ph.host
	return &httputil.ReverseProxy{
		Transport:     s.previewTransport,
		FlushInterval: -1,
		ErrorLog:      log.New(io.Discard, "", 0),
		Rewrite: func(pr *httputil.ProxyRequest) {
			out := pr.Out
			out.URL.Scheme = "http"
			out.URL.Host = device.Id + ":" + port
			out.Host = local
			pr.SetXForwarded()
			out.Header.Set("X-Forwarded-Host", pr.In.Host)
			out.Header.Set("X-Forwarded-Proto", scheme)
			if out.Header.Get("Origin") != "" {
				out.Header.Set("Origin", "http://"+local)
			}
			if ref, err := url.Parse(out.Header.Get("Referer")); err == nil && ref.Host != "" && strings.EqualFold(ref.Host, pr.In.Host) {
				ref.Scheme, ref.Host = "http", local
				out.Header.Set("Referer", ref.String())
			}
			s.stripHubCredentials(out.Header)
		},
		ModifyResponse: func(resp *http.Response) error {
			h := resp.Header
			h.Del("X-Frame-Options")
			for _, k := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
				if vals := h.Values(k); len(vals) > 0 {
					h.Del(k)
					for _, v := range vals {
						if v = dropFrameAncestors(v); v != "" {
							h.Add(k, v)
						}
					}
				}
			}
			if loc := h.Get("Location"); loc != "" {
				h.Set("Location", rewritePreviewLocation(loc, ph.port, previewOrigin))
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if r.Context().Err() != nil {
				return // the browser went away
			}
			name := html.EscapeString(device.Name)
			if errors.Is(err, errDeviceOffline) {
				previewPage(w, http.StatusServiceUnavailable, "Machine offline",
					fmt.Sprintf("<b>%s</b> is offline. This page reloads by itself when it reconnects.", name), true)
				return
			}
			var de *tunnelDialError
			if errors.As(err, &de) {
				previewPage(w, http.StatusBadGateway, fmt.Sprintf("Waiting for port %d", ph.port),
					fmt.Sprintf("Nothing is listening on port %d on <b>%s</b> yet. Start the dev server and this page will load by itself.", ph.port, name), true)
				return
			}
			previewPage(w, http.StatusBadGateway, fmt.Sprintf("Port %d didn't answer", ph.port),
				fmt.Sprintf("The server on port %d on <b>%s</b> closed the connection. Retrying…", ph.port, name), true)
		},
	}
}

// stripHubCredentials removes Overseer's own cookies and a hub API token
// before a request leaves for the dev server. The app's own cookies and
// Authorization headers pass through.
func (s *Server) stripHubCredentials(h http.Header) {
	if vals := h.Values("Cookie"); len(vals) > 0 {
		var keep []string
		for _, v := range vals {
			for _, part := range strings.Split(v, ";") {
				part = strings.TrimSpace(part)
				name, _, _ := strings.Cut(part, "=")
				if part == "" || name == previewCookie || name == sessionCookie {
					continue
				}
				keep = append(keep, part)
			}
		}
		h.Del("Cookie")
		if len(keep) > 0 {
			h.Set("Cookie", strings.Join(keep, "; "))
		}
	}
	if auth := h.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		if ok, _ := s.store.ValidApiToken(strings.TrimPrefix(auth, "Bearer ")); ok {
			h.Del("Authorization")
		}
	}
}

// dropFrameAncestors removes the frame-ancestors directive from a CSP so the
// Preview panel can frame the page; every other directive is kept.
func dropFrameAncestors(csp string) string {
	var keep []string
	for _, d := range strings.Split(csp, ";") {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		name, _, _ := strings.Cut(d, " ")
		if strings.EqualFold(name, "frame-ancestors") {
			continue
		}
		keep = append(keep, d)
	}
	return strings.Join(keep, "; ")
}

// rewritePreviewLocation points redirects at localhost:{port},
// 127.0.0.1:{port} or [::1]:{port} back at the preview origin.
func rewritePreviewLocation(loc string, port int, previewOrigin string) string {
	u, err := url.Parse(loc)
	if err != nil || u.Host == "" {
		return loc
	}
	p := strconv.Itoa(port)
	switch strings.ToLower(u.Host) {
	case "localhost:" + p, "127.0.0.1:" + p, "[::1]:" + p:
	default:
		return loc
	}
	o, err := url.Parse(previewOrigin)
	if err != nil {
		return loc
	}
	u.Scheme, u.Host = o.Scheme, o.Host
	return u.String()
}

// previewPage writes a small self-contained status page; reload makes it
// retry every 2 s so a preview opened early appears once the server is up.
func previewPage(w http.ResponseWriter, code int, title, bodyHTML string, reload bool) {
	refresh := ""
	if reload {
		refresh = `<meta http-equiv="refresh" content="2">`
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">%s<title>%s</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,sans-serif;background:Canvas;color:CanvasText}
main{max-width:28rem;padding:24px;text-align:center}h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;opacity:.7}</style></head>
<body><main><h1>%s</h1><p>%s</p></main></body></html>`, refresh, html.EscapeString(title), html.EscapeString(title), bodyHTML)
}

// --- device ports + raw TCP endpoint ---

// handleDevicePorts lists the device's listening ports, live, with the
// preview URL each one would have.
func (s *Server) handleDevicePorts(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(portsListTimeout)
	defer cancel()
	var ports []protocol.PortInfo
	if err := c.requestInto(ctx, protocol.TypePortsList, struct{}{}, &ports); err != nil {
		if strings.Contains(err.Error(), "unsupported request") {
			err = fmt.Errorf("this machine's agent is too old to list ports; update it")
		}
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if ports == nil {
		ports = []protocol.PortInfo{}
	}
	url := s.previewBase(r, c.deviceId)
	for i := range ports {
		ports[i].PreviewUrl = url(ports[i].Port)
	}
	writeJSON(w, ports)
}

// handleDeviceTCPWS bridges a WebSocket to localhost:{port} on the device:
// binary frames carry the raw TCP stream both ways (used by `overseer
// forward`). Closing either side closes the other.
func (s *Server) handleDeviceTCPWS(w http.ResponseWriter, r *http.Request) {
	port, err := strconv.Atoi(r.PathValue("port"))
	if err != nil || port < 1 || port > 65535 {
		httpError(w, http.StatusBadRequest, "port must be 1-65535")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), tunnelDialWait)
	conn, err := s.dialDevice(ctx, r.PathValue("id"), port)
	cancel()
	if errors.Is(err, errDeviceOffline) {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	done := make(chan struct{}, 2)
	go func() { // device -> client
		buf := make([]byte, 32*1024)
		for {
			n, err := conn.Read(buf)
			if n > 0 {
				ws.SetWriteDeadline(time.Now().Add(30 * time.Second))
				if ws.WriteMessage(websocket.BinaryMessage, buf[:n]) != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		done <- struct{}{}
	}()
	go func() { // client -> device
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				break
			}
			if msgType == websocket.BinaryMessage {
				if _, err := conn.Write(data); err != nil {
					break
				}
			}
		}
		done <- struct{}{}
	}()
	<-done
	conn.Close()
	ws.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
}
