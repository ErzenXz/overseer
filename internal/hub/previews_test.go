package hub

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/fleet"
	"github.com/ErzenXz/overseer/internal/protocol"
)

const fakeHTTPEnv = "OVERSEER_HUB_FAKE_HTTP"

// fakeHTTPApp is a dev server in its own process (the agent skips its own
// pid when listing ports). It prints its port and runs until stdin closes.
func fakeHTTPApp() {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	fmt.Println(ln.Addr().(*net.TCPAddr).Port)
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<html><title>Fake App</title></html>")
	}))
	io.Copy(io.Discard, os.Stdin)
}

func TestPreviewSlugs(t *testing.T) {
	cases := map[string]string{
		"erzen-dev":                    "erzen-dev",
		"Erzen's Mac":                  "erzen-s-mac",
		"  --Box__42 ":                 "box-42",
		"Ünïcode host":                 "n-code-host",
		"!!!":                          "machine",
		"MacBook-Pro.local":            "macbook-pro-local",
		strings.Repeat("a", 39) + "-b": strings.Repeat("a", 39),
	}
	for in, want := range cases {
		if got := previewSlug(in); got != want {
			t.Errorf("previewSlug(%q) = %q, want %q", in, got, want)
		}
	}

	devices := []Device{
		{Id: "ffff000011112222", Name: "Erzen Dev", CreatedAt: 300},
		{Id: "aaaa000011112222", Name: "erzen-dev", CreatedAt: 100},
		{Id: "bbbb000011112222", Name: "laptop", CreatedAt: 200},
		{Id: "cccc000011112222", Name: "ERZEN dev", CreatedAt: 300},
	}
	got := previewSlugs(devices)
	want := map[string]string{
		"aaaa000011112222": "erzen-dev",      // earliest keeps the slug
		"bbbb000011112222": "laptop",         //
		"cccc000011112222": "erzen-dev-cccc", // same createdAt: id breaks the tie
		"ffff000011112222": "erzen-dev-ffff",
	}
	for id, slug := range want {
		if got[id] != slug {
			t.Errorf("slug for %s = %q, want %q", id, got[id], slug)
		}
	}
	// The longest label still fits in one DNS label.
	long := previewSlug(strings.Repeat("x", 80)) + "-abcd"
	if label := "65535-" + long; len(label) > 63 {
		t.Errorf("label %q is %d chars", label, len(label))
	}
}

func TestParsePreviewLabel(t *testing.T) {
	ok := map[string][2]string{
		"5173-erzen-dev":      {"5173", "erzen-dev"},
		"80-box":              {"80", "box"},
		"65535-a":             {"65535", "a"},
		"3000-erzen-dev-ab12": {"3000", "erzen-dev-ab12"},
	}
	for label, want := range ok {
		port, slug, good := parsePreviewLabel(label)
		if !good || strconv.Itoa(port) != want[0] || slug != want[1] {
			t.Errorf("parsePreviewLabel(%q) = %d %q %v", label, port, slug, good)
		}
	}
	for _, label := range []string{"overseer", "erzen-dev", "0-box", "05173-box", "65536-box", "5173-", "5173--box", "5173-box-", "5173-Box", "5173-b_x", "12a-box", "5173-" + strings.Repeat("a", 60)} {
		if _, _, good := parsePreviewLabel(label); good {
			t.Errorf("parsePreviewLabel(%q) accepted", label)
		}
	}
}

func TestPreviewDomainDerivation(t *testing.T) {
	cases := map[string]string{
		"overseer.example.com":      "example.com",
		"overseer.example.com:4200": "example.com",
		"hub.dev.example.co.uk":     "dev.example.co.uk",
		"localhost":                 "localhost",
		"localhost:4200":            "localhost",
		"127.0.0.1":                 "localhost",
		"127.0.0.1:4200":            "localhost",
		"[::1]:4200":                "localhost",
		"192.168.1.10:4200":         "",
		"[2001:db8::1]:443":         "",
		"example.com":               "",
		"myhub":                     "",
		"":                          "",
	}
	for host, want := range cases {
		if got := derivePreviewDomain(host); got != want {
			t.Errorf("derivePreviewDomain(%q) = %q, want %q", host, got, want)
		}
	}
	valid := map[string]string{"Example.COM.": "example.com", "*.example.com": "example.com", "localhost": "localhost", " ": ""}
	for in, want := range valid {
		if got, err := normalizePreviewDomain(in); err != nil || got != want {
			t.Errorf("normalizePreviewDomain(%q) = %q, %v", in, got, err)
		}
	}
	for _, in := range []string{"1.2.3.4", "::1", "[::1]", "exa mple.com", "-bad.com", "https://example.com", "a..b"} {
		if _, err := normalizePreviewDomain(in); err == nil {
			t.Errorf("normalizePreviewDomain(%q) accepted", in)
		}
	}
}

func TestPreviewTokens(t *testing.T) {
	p := newPreviewAuth()
	tok := p.mintToken("5173-box.example.com")
	if p.consumeToken(tok, "3000-box.example.com") {
		t.Error("token accepted on the wrong host")
	}
	if p.consumeToken(tok, "5173-box.example.com") {
		t.Error("token survived a wrong-host attempt")
	}
	tok = p.mintToken("5173-box.example.com")
	if !p.consumeToken(tok, "5173-BOX.example.com") {
		t.Error("fresh token refused")
	}
	if p.consumeToken(tok, "5173-box.example.com") {
		t.Error("token replayed")
	}
	tok = p.mintToken("5173-box.example.com")
	for k, g := range p.tokens {
		g.exp = time.Now().Add(-time.Second)
		p.tokens[k] = g
	}
	if p.consumeToken(tok, "5173-box.example.com") {
		t.Error("expired token accepted")
	}

	c := p.mintCookie("5173-box.example.com")
	if !p.cookieValid(c, "5173-box.example.com") || p.cookieValid(c, "3000-box.example.com") || p.cookieValid("nope", "5173-box.example.com") {
		t.Error("cookie host binding broken")
	}
	p.revokeAll()
	if p.cookieValid(c, "5173-box.example.com") {
		t.Error("cookie survived revokeAll")
	}
}

func TestPreviewRewrites(t *testing.T) {
	origin := "https://5173-box.example.com"
	cases := map[string]string{
		"http://localhost:5173/login?x=1": "https://5173-box.example.com/login?x=1",
		"http://127.0.0.1:5173/":          "https://5173-box.example.com/",
		"http://[::1]:5173/a#b":           "https://5173-box.example.com/a#b",
		"http://localhost:3000/":          "http://localhost:3000/",
		"/relative":                       "/relative",
		"https://github.com/login":        "https://github.com/login",
	}
	for in, want := range cases {
		if got := rewritePreviewLocation(in, 5173, origin); got != want {
			t.Errorf("rewritePreviewLocation(%q) = %q, want %q", in, got, want)
		}
	}
	if got := dropFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *"); got != "default-src 'self'; img-src *" {
		t.Errorf("dropFrameAncestors = %q", got)
	}
	if got := dropFrameAncestors("frame-ancestors 'self'"); got != "" {
		t.Errorf("dropFrameAncestors = %q", got)
	}
	q, v := withoutQueryParam("b=2&__overseer_preview=abc&a=1", previewTokenParam)
	if q != "b=2&a=1" || v != "abc" {
		t.Errorf("withoutQueryParam = %q %q", q, v)
	}
	if got := withQueryParam("b=2&a=1", previewTokenParam, "t"); got != "b=2&a=1&__overseer_preview=t" {
		t.Errorf("withQueryParam = %q", got)
	}
}

// previewClient sends requests to the hub with an arbitrary Host header and
// never follows redirects.
type previewClient struct {
	t    *testing.T
	base string // http://127.0.0.1:port
}

func (c previewClient) get(host, path string, hdr http.Header) *http.Response {
	c.t.Helper()
	req, _ := http.NewRequest("GET", c.base+path, nil)
	req.Host = host
	for k, v := range hdr {
		req.Header[k] = v
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	c.t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func cookieNamed(resp *http.Response, name string) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestPreviewProxyEndToEnd(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	apiToken, _ := srv.store.CreateApiToken("preview-test")
	api := apiClient{t: t, base: base, token: apiToken}
	hubPort := hostPort(strings.TrimPrefix(base, "http://"))
	pc := previewClient{t: t, base: base}

	// The dev server: echoes what it received, sets framing headers,
	// redirects to its own localhost address, and echoes WebSockets.
	var upstreamPort int
	wsUpgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == fmt.Sprintf("http://localhost:%d", upstreamPort)
	}}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, fmt.Sprintf("http://localhost:%d/landed", upstreamPort), http.StatusFound)
		case "/ws":
			ws, err := wsUpgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer ws.Close()
			for {
				mt, data, err := ws.ReadMessage()
				if err != nil {
					return
				}
				ws.WriteMessage(mt, append([]byte("echo:"), data...))
			}
		default:
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"host": r.Host, "origin": r.Header.Get("Origin"), "referer": r.Header.Get("Referer"),
				"cookie": r.Header.Get("Cookie"), "authorization": r.Header.Get("Authorization"),
				"xfh": r.Header.Get("X-Forwarded-Host"), "xfp": r.Header.Get("X-Forwarded-Proto"),
				"xff": r.Header.Get("X-Forwarded-For"), "query": r.URL.RawQuery,
			})
		}
	}))
	defer upstream.Close()
	upstreamPort = upstream.Listener.Addr().(*net.TCPAddr).Port

	// Config: the hub is reached on 127.0.0.1, so previews derive to localhost.
	var cfg previewConfigView
	api.do("GET", "/api/previews/config", nil, &cfg)
	if cfg.Domain != "localhost" || cfg.Source != "derived" || cfg.Secure {
		t.Fatalf("config = %+v", cfg)
	}
	if code := api.do("PUT", "/api/previews/config", map[string]string{"domain": "10.0.0.1"}, nil); code != http.StatusBadRequest {
		t.Errorf("IP domain accepted: %d", code)
	}
	api.do("PUT", "/api/previews/config", map[string]string{"domain": "Example.COM"}, &cfg)
	if cfg.Domain != "example.com" || cfg.Source != "setting" {
		t.Errorf("after PUT: %+v", cfg)
	}
	api.do("PUT", "/api/previews/config", map[string]string{"domain": ""}, &cfg)
	if cfg.Domain != "localhost" || cfg.Source != "derived" {
		t.Errorf("after reset: %+v", cfg)
	}

	previewHost := fmt.Sprintf("%d-test-device.localhost:%s", upstreamPort, hubPort)
	previewURL := "http://" + previewHost

	t.Run("hub host is not a preview", func(t *testing.T) {
		if _, ok := srv.matchPreviewHost("localhost:" + hubPort); ok {
			t.Error("hub host matched")
		}
		if _, ok := srv.matchPreviewHost("5173-test-device.evil.com"); ok {
			t.Error("foreign domain matched")
		}
	})

	var session string
	t.Run("auth handoff", func(t *testing.T) {
		// 1. No cookie: off to the hub for a token.
		resp := pc.get(previewHost, "/page?x=1", nil)
		wantAuth := fmt.Sprintf("http://localhost:%s/api/previews/auth?return=%s", hubPort, url.QueryEscape(previewURL+"/page?x=1"))
		if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != wantAuth {
			t.Fatalf("no cookie: %d %q, want %q", resp.StatusCode, resp.Header.Get("Location"), wantAuth)
		}
		authPath := "/api/previews/auth?return=" + url.QueryEscape(previewURL+"/page?x=1")

		// 2a. No hub session: to the login page, then back.
		resp = pc.get("127.0.0.1:"+hubPort, authPath, nil)
		if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusFound || !strings.HasPrefix(loc, "/login?next=") {
			t.Fatalf("no session: %d %q", resp.StatusCode, loc)
		}

		// 2b. Signed in: a token for that host.
		session = srv.sessions.create()
		withSession := http.Header{"Cookie": {sessionCookie + "=" + session}}
		resp = pc.get("127.0.0.1:"+hubPort, authPath, withSession)
		loc, _ := url.Parse(resp.Header.Get("Location"))
		if resp.StatusCode != http.StatusFound || loc == nil || loc.Host != previewHost || loc.Path != "/page" {
			t.Fatalf("auth: %d %q", resp.StatusCode, resp.Header.Get("Location"))
		}
		token := loc.Query().Get(previewTokenParam)
		if loc.Query().Get("x") != "1" || len(token) != 64 {
			t.Fatalf("auth redirect query: %q", loc.RawQuery)
		}

		// Open-redirect and token-theft attempts.
		for _, ret := range []string{
			"https://evil.com/",
			"//evil.com/",
			"http://evil.com@" + previewHost + "/",
			fmt.Sprintf("http://%d-test-device.evil.com:%s/", upstreamPort, hubPort),
			fmt.Sprintf("http://%d-test-device.localhost:9/", upstreamPort), // other port, other listener
			"https://" + previewHost + "/",                                  // scheme downgrade/upgrade
			"http://localhost:" + hubPort + "/",                             // the hub itself
			"javascript:alert(1)",
			"/relative",
			"",
		} {
			r := pc.get("127.0.0.1:"+hubPort, "/api/previews/auth?return="+url.QueryEscape(ret), withSession)
			if r.StatusCode != http.StatusBadRequest {
				t.Errorf("return %q: %d %q", ret, r.StatusCode, r.Header.Get("Location"))
			}
		}

		// 3a. Wrong host: refused, and the token is burned.
		otherHost := fmt.Sprintf("%d-test-device.localhost:%s", upstreamPort+1, hubPort)
		r := pc.get(otherHost, "/?"+previewTokenParam+"="+token, nil)
		if cookieNamed(r, previewCookie) != nil || r.StatusCode != http.StatusFound || !strings.Contains(r.Header.Get("Location"), "/api/previews/auth") {
			t.Errorf("wrong host: %d %q", r.StatusCode, r.Header.Get("Location"))
		}
		r = pc.get(previewHost, "/page?x=1&"+previewTokenParam+"="+token, nil)
		if cookieNamed(r, previewCookie) != nil {
			t.Error("token reused after a wrong-host attempt")
		}

		// 3b. A fresh token on the right host: cookie, then the clean URL.
		resp = pc.get("127.0.0.1:"+hubPort, authPath, withSession)
		loc, _ = url.Parse(resp.Header.Get("Location"))
		token = loc.Query().Get(previewTokenParam)
		r = pc.get(previewHost, loc.RequestURI(), nil)
		c := cookieNamed(r, previewCookie)
		if r.StatusCode != http.StatusFound || r.Header.Get("Location") != "/page?x=1" || c == nil {
			t.Fatalf("token exchange: %d %q cookie=%v", r.StatusCode, r.Header.Get("Location"), c)
		}
		if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/" || c.Domain != "" || c.Secure {
			t.Errorf("cookie attributes: %+v", c)
		}

		// 3c. Replay: no new cookie.
		r = pc.get(previewHost, "/?"+previewTokenParam+"="+token, nil)
		if cookieNamed(r, previewCookie) != nil {
			t.Error("token replay minted a cookie")
		}

		// The cookie is bound to its host.
		cookieHdr := http.Header{"Cookie": {previewCookie + "=" + c.Value}}
		if r := pc.get(otherHost, "/", cookieHdr); r.StatusCode != http.StatusFound {
			t.Errorf("cookie worked on another host: %d", r.StatusCode)
		}
		if r := pc.get(previewHost, "/", cookieHdr); r.StatusCode != http.StatusOK {
			t.Errorf("cookie refused on its host: %d", r.StatusCode)
		}
	})

	cookieValue := srv.previewAuth.mintCookie(previewHost)
	authed := func(extra ...string) http.Header {
		h := http.Header{"Cookie": {strings.Join(append([]string{previewCookie + "=" + cookieValue}, extra...), "; ")}}
		return h
	}

	t.Run("proxy rewrites", func(t *testing.T) {
		h := authed("app=1", sessionCookie+"="+session)
		h.Set("Origin", previewURL)
		h.Set("Referer", previewURL+"/from?q=1")
		h.Set("Authorization", "Bearer "+apiToken) // a hub token never leaves
		resp := pc.get(previewHost, "/data?y=2", h)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status %d", resp.StatusCode)
		}
		var got map[string]string
		json.NewDecoder(resp.Body).Decode(&got)
		local := fmt.Sprintf("localhost:%d", upstreamPort)
		want := map[string]string{
			"host": local, "origin": "http://" + local, "referer": "http://" + local + "/from?q=1",
			"cookie": "app=1", "authorization": "", "xfh": previewHost, "xfp": "http", "query": "y=2",
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("upstream saw %s = %q, want %q", k, got[k], v)
			}
		}
		if got["xff"] == "" {
			t.Error("X-Forwarded-For missing")
		}
		if resp.Header.Get("X-Frame-Options") != "" {
			t.Error("X-Frame-Options not removed")
		}
		if csp := resp.Header.Get("Content-Security-Policy"); csp != "default-src 'self'" {
			t.Errorf("CSP = %q", csp)
		}

		// The app's own bearer token passes through.
		h = authed()
		h.Set("Authorization", "Bearer app-token")
		got = nil
		json.NewDecoder(pc.get(previewHost, "/", h).Body).Decode(&got)
		if got["authorization"] != "Bearer app-token" {
			t.Errorf("app Authorization = %q", got["authorization"])
		}
	})

	t.Run("location rewrite", func(t *testing.T) {
		resp := pc.get(previewHost, "/redirect", authed())
		if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusFound || loc != previewURL+"/landed" {
			t.Errorf("redirect: %d %q", resp.StatusCode, loc)
		}
	})

	dialWS := func(origin string, hdr http.Header) (*websocket.Conn, *http.Response, error) {
		d := websocket.Dialer{
			NetDialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, "127.0.0.1:"+hubPort)
			},
			HandshakeTimeout: 10 * time.Second,
		}
		h := hdr.Clone()
		if origin != "" {
			h.Set("Origin", origin)
		}
		return d.Dial("ws://"+previewHost+"/ws", h)
	}

	t.Run("websocket", func(t *testing.T) {
		ws, _, err := dialWS(previewURL, authed())
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer ws.Close()
		for i := 0; i < 3; i++ {
			msg := fmt.Sprintf("hmr-%d", i)
			ws.WriteMessage(websocket.TextMessage, []byte(msg))
			ws.SetReadDeadline(time.Now().Add(5 * time.Second))
			_, data, err := ws.ReadMessage()
			if err != nil || string(data) != "echo:"+msg {
				t.Fatalf("echo %d: %q %v", i, data, err)
			}
		}
		if _, resp, err := dialWS(previewURL, http.Header{}); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("unauthenticated upgrade: %v %v", err, resp)
		}
		if _, resp, err := dialWS("https://evil.example", authed()); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Errorf("cross-site upgrade: %v %v", err, resp)
		}
	})

	t.Run("concurrent requests", func(t *testing.T) {
		errs := make(chan error, 24)
		for i := 0; i < 24; i++ {
			go func(i int) {
				req, _ := http.NewRequest("GET", fmt.Sprintf("%s/c%d", base, i), nil)
				req.Host = previewHost
				req.Header = authed()
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					errs <- err
					return
				}
				defer resp.Body.Close()
				var got map[string]string
				if err := json.NewDecoder(resp.Body).Decode(&got); err != nil || resp.StatusCode != 200 {
					errs <- fmt.Errorf("request %d: %d %v", i, resp.StatusCode, err)
					return
				}
				errs <- nil
			}(i)
		}
		for i := 0; i < 24; i++ {
			if err := <-errs; err != nil {
				t.Error(err)
			}
		}
	})

	t.Run("large streamed body", func(t *testing.T) {
		big := bytes.Repeat([]byte("0123456789abcdef"), 512*1024) // 8 MiB
		bigSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(big) }))
		defer bigSrv.Close()
		host := fmt.Sprintf("%d-test-device.localhost:%s", bigSrv.Listener.Addr().(*net.TCPAddr).Port, hubPort)
		c := srv.previewAuth.mintCookie(host)
		resp := pc.get(host, "/", http.Header{"Cookie": {previewCookie + "=" + c}})
		got, err := io.ReadAll(resp.Body)
		if err != nil || !bytes.Equal(got, big) {
			t.Errorf("body: %d bytes, err %v", len(got), err)
		}
	})

	t.Run("ipv6 only dev server", func(t *testing.T) {
		ln, err := net.Listen("tcp", "[::1]:0")
		if err != nil {
			t.Skip("no IPv6 loopback")
		}
		v6 := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "v6 ok") }))
		v6.Listener = ln
		v6.Start()
		defer v6.Close()
		host := fmt.Sprintf("%d-test-device.localhost:%s", ln.Addr().(*net.TCPAddr).Port, hubPort)
		c := srv.previewAuth.mintCookie(host)
		for i := 0; i < 2; i++ { // second request uses the remembered address
			resp := pc.get(host, "/", http.Header{"Cookie": {previewCookie + "=" + c}})
			if body, _ := io.ReadAll(resp.Body); resp.StatusCode != 200 || string(body) != "v6 ok" {
				t.Errorf("v6: %d %q", resp.StatusCode, body)
			}
		}
	})

	t.Run("nothing listening", func(t *testing.T) {
		ln, _ := net.Listen("tcp", "127.0.0.1:0")
		closed := ln.Addr().(*net.TCPAddr).Port
		ln.Close()
		host := fmt.Sprintf("%d-test-device.localhost:%s", closed, hubPort)
		c := srv.previewAuth.mintCookie(host)
		resp := pc.get(host, "/", http.Header{"Cookie": {previewCookie + "=" + c}})
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusBadGateway || !bytes.Contains(body, []byte("Nothing is listening on port "+strconv.Itoa(closed))) ||
			!bytes.Contains(body, []byte(`http-equiv="refresh" content="2"`)) {
			t.Errorf("502 page: %d %s", resp.StatusCode, body)
		}
	})

	t.Run("machine offline and unknown", func(t *testing.T) {
		if _, _, err := srv.store.CreateDevice("Offline Box", "offline", "linux", "amd64", false); err != nil {
			t.Fatal(err)
		}
		host := "3000-offline-box.localhost:" + hubPort
		c := srv.previewAuth.mintCookie(host)
		resp := pc.get(host, "/", http.Header{"Cookie": {previewCookie + "=" + c}})
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusServiceUnavailable || !bytes.Contains(body, []byte("offline")) {
			t.Errorf("offline: %d %s", resp.StatusCode, body)
		}
		host = "3000-nobody.localhost:" + hubPort
		c = srv.previewAuth.mintCookie(host)
		if resp := pc.get(host, "/", http.Header{"Cookie": {previewCookie + "=" + c}}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown machine: %d", resp.StatusCode)
		}
	})

	t.Run("ports", func(t *testing.T) {
		app := exec.Command(os.Args[0], "-test.run=^$")
		app.Env = append(os.Environ(), fakeHTTPEnv+"=1")
		stdin, _ := app.StdinPipe()
		stdout, _ := app.StdoutPipe()
		if err := app.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { stdin.Close(); app.Wait() }()
		line, err := bufio.NewReader(stdout).ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		appPort, _ := strconv.Atoi(strings.TrimSpace(line))

		var ports []protocol.PortInfo
		api.do("GET", "/api/devices/"+deviceId+"/ports", nil, &ports)
		var found *protocol.PortInfo
		for i := range ports {
			if ports[i].Port == appPort {
				found = &ports[i]
			}
			if ports[i].Port == upstreamPort {
				t.Errorf("the agent's own listener %d was listed", upstreamPort)
			}
		}
		if found == nil {
			t.Fatalf("port %d not listed in %+v", appPort, ports)
		}
		wantURL := fmt.Sprintf("http://%d-test-device.localhost:%s/", appPort, hubPort)
		if !found.Http || found.Title != "Fake App" || found.PreviewUrl != wantURL || found.Pid != app.Process.Pid {
			t.Errorf("port info = %+v (want previewUrl %s, pid %d)", *found, wantURL, app.Process.Pid)
		}
		if code := api.do("GET", "/api/devices/nope/ports", nil, nil); code != http.StatusServiceUnavailable {
			t.Errorf("offline device ports: %d", code)
		}
	})

	t.Run("forward endpoint", func(t *testing.T) {
		ln, _ := net.Listen("tcp", "127.0.0.1:0")
		defer ln.Close()
		go func() {
			for {
				conn, err := ln.Accept()
				if err != nil {
					return
				}
				go func() { defer conn.Close(); io.Copy(conn, conn) }()
			}
		}()
		port := ln.Addr().(*net.TCPAddr).Port
		ws := api.dial(fmt.Sprintf("/api/ws/devices/%s/tcp/%d", deviceId, port))
		ws.WriteMessage(websocket.BinaryMessage, []byte("ping"))
		ws.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, data, err := ws.ReadMessage(); err != nil || string(data) != "ping" {
			t.Errorf("echo: %q %v", data, err)
		}
		for _, bad := range []string{"0", "65536", "x"} {
			if code := api.do("GET", fmt.Sprintf("/api/ws/devices/%s/tcp/%s", deviceId, bad), nil, nil); code != http.StatusBadRequest {
				t.Errorf("port %s: %d", bad, code)
			}
		}
		closed, _ := net.Listen("tcp", "127.0.0.1:0")
		closedPort := closed.Addr().(*net.TCPAddr).Port
		closed.Close()
		if code := api.do("GET", fmt.Sprintf("/api/ws/devices/%s/tcp/%d", deviceId, closedPort), nil, nil); code != http.StatusBadGateway {
			t.Errorf("closed port: %d", code)
		}
		req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/ws/devices/%s/tcp/%d", base, deviceId, port), nil)
		if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("unauthenticated forward: %v %v", err, resp)
		}

		// The CLI side: overseer forward over a local listener.
		local, _ := net.Listen("tcp", "127.0.0.1:0")
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- fleet.New(base, apiToken).Forward(ctx, local, deviceId, port, t.Logf) }()
		conn, err := net.Dial("tcp", local.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		conn.Write([]byte("through the CLI"))
		buf := make([]byte, 64)
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, err := io.ReadAtLeast(conn, buf, len("through the CLI"))
		if err != nil || string(buf[:n]) != "through the CLI" {
			t.Errorf("forward echo: %q %v", buf[:n], err)
		}
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Forward: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("Forward did not stop on cancel")
		}
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, err := conn.Read(buf); err == nil {
			t.Error("local connection still open after cancel")
		}
	})

	t.Run("preview pages can't write to the hub API", func(t *testing.T) {
		for origin, want := range map[string]int{previewURL: http.StatusForbidden, base: http.StatusOK} {
			req, _ := http.NewRequest("PUT", base+"/api/previews/config", strings.NewReader(`{"domain":""}`))
			req.Header.Set("Content-Type", "text/plain")
			req.Header.Set("Origin", origin)
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session})
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != want {
				t.Errorf("PUT from %s: %d, want %d", origin, resp.StatusCode, want)
			}
		}
	})

	t.Run("writes through a Host-rewriting proxy still work", func(t *testing.T) {
		for _, tc := range []struct {
			forwarded, origin string
			want              int
		}{
			{"overseer.example.org", "https://overseer.example.org", http.StatusOK},
			{"overseer.example.org", "https://evil.example.org", http.StatusForbidden},
		} {
			req, _ := http.NewRequest("PUT", base+"/api/previews/config", strings.NewReader(`{"domain":""}`))
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-Forwarded-Host", tc.forwarded)
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session})
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != tc.want {
				t.Errorf("PUT from %s via %s: %d, want %d", tc.origin, tc.forwarded, resp.StatusCode, tc.want)
			}
		}
	})

	t.Run("logout revokes", func(t *testing.T) {
		req, _ := http.NewRequest("POST", base+"/api/logout", nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if r := pc.get(previewHost, "/", authed()); r.StatusCode != http.StatusFound {
			t.Errorf("preview cookie survived logout: %d", r.StatusCode)
		}
	})
}
