package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// A phone-size screenshot needs a real mobile viewport. Headless Chrome will
// not make a window narrower than about 500px (a 390px window still lays the
// page out at 500), so for phones the browser is driven over its DevTools
// socket instead: set the device metrics, load the page, capture. This is
// about 100 lines of the protocol, with the websocket library the agent
// already uses; no driver or extra download.

// cdpPage is one page of a browser started with --remote-debugging-port.
type cdpPage struct {
	ws     *websocket.Conn
	nextId atomic.Int64

	mu      sync.Mutex
	waiters map[int64]chan json.RawMessage
	events  map[string][]chan struct{}
	failed  error
}

func dialCDP(ctx context.Context, wsURL string) (*cdpPage, error) {
	d := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	ws, _, err := d.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(64 * 1024 * 1024)
	p := &cdpPage{ws: ws, waiters: map[int64]chan json.RawMessage{}, events: map[string][]chan struct{}{}}
	go p.readLoop()
	return p, nil
}

func (p *cdpPage) readLoop() {
	for {
		_, data, err := p.ws.ReadMessage()
		if err != nil {
			p.mu.Lock()
			p.failed = err
			for id, ch := range p.waiters {
				close(ch)
				delete(p.waiters, id)
			}
			p.mu.Unlock()
			return
		}
		var m struct {
			Id     int64           `json:"id"`
			Method string          `json:"method"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		p.mu.Lock()
		switch {
		case m.Id != 0:
			if ch := p.waiters[m.Id]; ch != nil {
				if m.Error != nil {
					ch <- json.RawMessage(`{"error":` + jsonString(m.Error.Message) + `}`)
				} else {
					ch <- m.Result
				}
				delete(p.waiters, m.Id)
			}
		case m.Method != "":
			for _, ch := range p.events[m.Method] {
				close(ch)
			}
			delete(p.events, m.Method)
		}
		p.mu.Unlock()
	}
}

func jsonString(s string) string { b, _ := json.Marshal(s); return string(b) }

// once returns a channel closed the next time the page sends event.
func (p *cdpPage) once(event string) <-chan struct{} {
	ch := make(chan struct{})
	p.mu.Lock()
	p.events[event] = append(p.events[event], ch)
	p.mu.Unlock()
	return ch
}

// call sends one command and waits for its reply.
func (p *cdpPage) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := p.nextId.Add(1)
	ch := make(chan json.RawMessage, 1)
	p.mu.Lock()
	if p.failed != nil {
		err := p.failed
		p.mu.Unlock()
		return nil, err
	}
	p.waiters[id] = ch
	p.mu.Unlock()
	if err := p.ws.WriteJSON(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	select {
	case res, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("the browser closed the connection")
		}
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(res, &e) == nil && e.Error != "" {
			return nil, fmt.Errorf("%s: %s", method, e.Error)
		}
		return res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (p *cdpPage) close() { p.ws.Close() }

// phoneShot loads pageURL at a 390x844 phone viewport and returns the PNG.
func phoneShot(ctx context.Context, p *cdpPage, pageURL string, width, height, settleMs int) ([]byte, error) {
	if _, err := p.call(ctx, "Page.enable", map[string]any{}); err != nil {
		return nil, err
	}
	if _, err := p.call(ctx, "Emulation.setDeviceMetricsOverride", map[string]any{
		"width": width, "height": height, "deviceScaleFactor": 1, "mobile": true,
	}); err != nil {
		return nil, err
	}
	p.call(ctx, "Emulation.setUserAgentOverride", map[string]any{"userAgent": phoneUserAgent})
	p.call(ctx, "Emulation.setTouchEmulationEnabled", map[string]any{"enabled": true})
	loaded := p.once("Page.loadEventFired")
	if _, err := p.call(ctx, "Page.navigate", map[string]any{"url": pageURL}); err != nil {
		return nil, err
	}
	select {
	case <-loaded:
	case <-ctx.Done():
		return nil, fmt.Errorf("The page took too long to load.")
	}
	// Single-page apps draw after the load event.
	select {
	case <-time.After(time.Duration(settleMs) * time.Millisecond):
	case <-ctx.Done():
	}
	res, err := p.call(ctx, "Page.captureScreenshot", map[string]any{"format": "png"})
	if err != nil {
		return nil, err
	}
	var shot struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(res, &shot); err != nil || shot.Data == "" {
		return nil, fmt.Errorf("the browser sent no picture")
	}
	return base64.StdEncoding.DecodeString(shot.Data)
}

// captureMobile starts the browser with a debugging port, drives it to a phone
// screenshot and stops it.
func captureMobile(ctx context.Context, b browser, pageURL string, width, height, waitMs int) protocol.ScreenshotResult {
	fail := func(format string, args ...any) protocol.ScreenshotResult {
		return protocol.ScreenshotResult{Status: protocol.ShotError, Message: fmt.Sprintf(format, args...)}
	}
	tmp, err := os.MkdirTemp("", "overseer-shot-")
	if err != nil {
		return fail("Could not make a temporary folder: %v", err)
	}
	defer os.RemoveAll(tmp)
	profile := filepath.Join(tmp, "profile")
	args := []string{
		"--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
		"--no-first-run", "--no-default-browser-check", "--disable-extensions",
		"--disable-background-networking", "--disable-component-update", "--disable-sync",
		"--user-data-dir=" + profile, "--remote-debugging-port=0", "about:blank",
	}
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		args = append([]string{"--no-sandbox"}, args...)
	}
	cmd := exec.Command(b.Path, args...)
	var log bytes.Buffer
	cmd.Stdout, cmd.Stderr = &log, &log
	cmd.WaitDelay = 3 * time.Second
	setProcGroup(cmd)
	if err := cmd.Start(); err != nil {
		return fail("Could not start %s: %v", b.Name, err)
	}
	done := make(chan struct{})
	go func() { cmd.Wait(); close(done) }()
	defer func() {
		killProcessTree(cmd, done)
	}()

	// The browser writes its port to <profile>/DevToolsActivePort once ready.
	var port string
	deadline := time.Now().Add(20 * time.Second)
	for port == "" {
		if data, err := os.ReadFile(filepath.Join(profile, "DevToolsActivePort")); err == nil {
			if lines := strings.Split(string(data), "\n"); len(lines) > 0 && strings.TrimSpace(lines[0]) != "" {
				port = strings.TrimSpace(lines[0])
				break
			}
		}
		select {
		case <-done:
			return fail("%s stopped before it was ready: %s", b.Name, lastLine(log.String()))
		case <-ctx.Done():
			return fail("%s took too long to start.", b.Name)
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			return fail("%s took too long to start.", b.Name)
		}
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodPut, "http://127.0.0.1:"+port+"/json/new?about:blank", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fail("Could not reach %s: %v", b.Name, err)
	}
	var target struct {
		WebSocketDebuggerUrl string `json:"webSocketDebuggerUrl"`
	}
	err = json.NewDecoder(resp.Body).Decode(&target)
	resp.Body.Close()
	if err != nil || target.WebSocketDebuggerUrl == "" {
		return fail("%s did not open a page.", b.Name)
	}
	page, err := dialCDP(ctx, target.WebSocketDebuggerUrl)
	if err != nil {
		return fail("Could not talk to %s: %v", b.Name, err)
	}
	defer page.close()
	settle := min(waitMs, 2500)
	data, err := phoneShot(ctx, page, pageURL, width, height, settle)
	if err != nil {
		return fail("%v", err)
	}
	return packShot(data, b.Name)
}
