package hub

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Live previews: every dev server gets its own origin,
// {port}-{slug}.{previewDomain}, which the hub routes by Host and
// reverse-proxies over the device's loopback TCP tunnel. This file holds the
// domain config, slugs, host matching and the auth handoff; the proxy itself
// is in preview_proxy.go. Contract: docs/agent-sessions-api.md.

const (
	settingPreviewDomain = "preview_domain"
	previewCookie        = "overseer_preview"
	previewTokenParam    = "__overseer_preview"
	previewTokenTTL      = 60 * time.Second
	previewCookieTTL     = 12 * time.Hour
	maxPreviewSlug       = 40
	previewDomainTTL     = 5 * time.Second // how long a resolved domain is cached
)

// --- preview domain ---

// normalizePreviewDomain validates a configured preview domain: a hostname
// (or "localhost"), never an IP. "" means "derive it".
func normalizePreviewDomain(in string) (string, error) {
	d := strings.ToLower(strings.TrimSpace(in))
	d = strings.TrimPrefix(d, "*.")
	d = strings.TrimSuffix(d, ".")
	if d == "" {
		return "", nil
	}
	if net.ParseIP(strings.Trim(d, "[]")) != nil {
		return "", fmt.Errorf("the preview domain must be a hostname, not an IP address")
	}
	if len(d) > 253 {
		return "", fmt.Errorf("the preview domain is too long")
	}
	for _, label := range strings.Split(d, ".") {
		if !validDNSLabel(label) {
			return "", fmt.Errorf("%q is not a valid hostname", in)
		}
	}
	return d, nil
}

func validDNSLabel(l string) bool {
	if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
		return false
	}
	for i := 0; i < len(l); i++ {
		c := l[i]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// derivePreviewDomain guesses the preview domain from the hub's public host:
// overseer.example.com → example.com; localhost or a loopback IP →
// localhost; any other IP, or a host with fewer than three labels, → "".
func derivePreviewDomain(host string) string {
	h := strings.ToLower(hostWithoutPort(host))
	h = strings.TrimSuffix(h, ".")
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return "localhost"
	}
	if ip := net.ParseIP(h); ip != nil {
		if ip.IsLoopback() {
			return "localhost"
		}
		return ""
	}
	labels := strings.Split(h, ".")
	if len(labels) < 3 {
		return ""
	}
	d, err := normalizePreviewDomain(strings.Join(labels[1:], "."))
	if err != nil {
		return ""
	}
	return d
}

// hostWithoutPort strips an optional :port (and IPv6 brackets).
func hostWithoutPort(hostport string) string {
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		return h
	}
	return strings.Trim(hostport, "[]")
}

// hostPort returns the explicit port of a Host header, or "".
func hostPort(hostport string) string {
	if _, p, err := net.SplitHostPort(hostport); err == nil {
		return p
	}
	return ""
}

type previewDomainCache struct {
	mu     sync.Mutex
	at     time.Time
	domain string
	source string
}

// publicHubHost is the host browsers reach the hub at, or "" when unknown
// (never the internal loopback listener).
func (s *Server) publicHubHost() string {
	if s.opts.TLSDomain != "" {
		return s.opts.TLSDomain
	}
	if raw, _ := s.store.Setting(settingHubPublicURL); raw != "" {
		if u, err := url.Parse(raw); err == nil {
			return u.Host
		}
	}
	return ""
}

// previewDomain resolves the preview domain and where it came from: the
// --preview-domain flag, the setting, derived from the public URL, or none.
func (s *Server) previewDomain() (domain, source string) {
	c := &s.previewDomainCache
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < previewDomainTTL {
		return c.domain, c.source
	}
	switch {
	case s.opts.PreviewDomain != "":
		domain, source = s.opts.PreviewDomain, "flag"
	default:
		if v, _ := s.store.Setting(settingPreviewDomain); v != "" {
			domain, source = v, "setting"
		} else if d := derivePreviewDomain(s.publicHubHost()); d != "" {
			domain, source = d, "derived"
		} else {
			source = "none"
		}
	}
	c.at, c.domain, c.source = time.Now(), domain, source
	return domain, source
}

func (s *Server) invalidatePreviewDomain() {
	s.previewDomainCache.mu.Lock()
	s.previewDomainCache.at = time.Time{}
	s.previewDomainCache.mu.Unlock()
}

// --- slugs ---

// previewSlug lowercases a device name, turns runs of anything outside
// [a-z0-9] into "-", trims dashes and caps the length.
func previewSlug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
		} else if !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if len(s) > maxPreviewSlug {
		s = strings.TrimRight(s[:maxPreviewSlug], "-")
	}
	if s == "" {
		s = "machine"
	}
	return s
}

// previewSlugs assigns each device its slug. When devices share a slug the
// earliest (by createdAt, then id) keeps it and later ones get "-" plus the
// first four characters of their id.
func previewSlugs(devices []Device) map[string]string {
	sorted := slices.Clone(devices)
	slices.SortStableFunc(sorted, func(a, b Device) int {
		if a.CreatedAt != b.CreatedAt {
			if a.CreatedAt < b.CreatedAt {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Id, b.Id)
	})
	out := map[string]string{}
	taken := map[string]bool{}
	for _, d := range sorted {
		slug := previewSlug(d.Name)
		if taken[slug] {
			slug += "-" + strings.ToLower(d.Id[:min(4, len(d.Id))])
		}
		taken[slug] = true
		out[d.Id] = slug
	}
	return out
}

// parsePreviewLabel splits "{port}-{slug}" (one DNS label, ≤ 63 chars).
func parsePreviewLabel(label string) (int, string, bool) {
	if len(label) > 63 {
		return 0, "", false
	}
	portStr, slug, ok := strings.Cut(label, "-")
	if !ok || portStr == "" || len(portStr) > 5 || portStr[0] == '0' || !validDNSLabel(slug) {
		return 0, "", false
	}
	for i := 0; i < len(portStr); i++ {
		if portStr[i] < '0' || portStr[i] > '9' {
			return 0, "", false
		}
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return 0, "", false
	}
	return port, slug, true
}

// previewHost is a Host header recognised as a preview origin.
type previewHost struct {
	host   string // lowercased Host header, port included
	domain string
	port   int
	slug   string
}

// matchPreviewHost reports whether a Host header names a preview origin of
// this hub: {port}-{slug}.{domain}, where domain is the configured preview
// domain or localhost. The hub's own host never matches.
func (s *Server) matchPreviewHost(hostport string) (previewHost, bool) {
	hp := strings.ToLower(hostport)
	h := strings.TrimSuffix(hostWithoutPort(hp), ".")
	label, rest, ok := strings.Cut(h, ".")
	if !ok || !strings.Contains(label, "-") || label[0] < '1' || label[0] > '9' {
		return previewHost{}, false // fast path for the hub's normal traffic
	}
	port, slug, ok := parsePreviewLabel(label)
	if !ok {
		return previewHost{}, false
	}
	if pub := strings.ToLower(hostWithoutPort(s.publicHubHost())); pub != "" && pub == h {
		return previewHost{}, false
	}
	if s.opts.TLSDomain != "" && strings.EqualFold(s.opts.TLSDomain, h) {
		return previewHost{}, false
	}
	domain, _ := s.previewDomain()
	if rest != domain && rest != "localhost" {
		return previewHost{}, false
	}
	return previewHost{host: hp, domain: rest, port: port, slug: slug}, true
}

// previewDevice finds the device a slug belongs to.
func (s *Server) previewDevice(slug string) (*Device, error) {
	devices, err := s.store.ListDevices()
	if err != nil {
		return nil, err
	}
	for id, sl := range previewSlugs(devices) {
		if sl == slug {
			for i := range devices {
				if devices[i].Id == id {
					return &devices[i], nil
				}
			}
		}
	}
	return nil, nil
}

// previewBase returns a function building preview URLs for a device as seen
// from this hub request ("" for every port when previews are unavailable).
func (s *Server) previewBase(r *http.Request, deviceId string) func(port int) string {
	none := func(int) string { return "" }
	domain, _ := s.previewDomain()
	if domain == "" {
		return none
	}
	devices, err := s.store.ListDevices()
	if err != nil {
		return none
	}
	slug, ok := previewSlugs(devices)[deviceId]
	if !ok {
		return none
	}
	scheme := requestScheme(r)
	suffix := ""
	if p := hostPort(r.Host); p != "" {
		suffix = ":" + p
	}
	return func(port int) string {
		return fmt.Sprintf("%s://%d-%s.%s%s/", scheme, port, slug, domain, suffix)
	}
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return "https"
	}
	return "http"
}

// --- auth handoff: one-time tokens and per-host cookies ---

type previewGrant struct {
	host string
	exp  time.Time
}

// previewAuth holds handoff tokens and preview cookies, keyed by the SHA-256
// of the secret so lookups don't leak timing about stored values. In memory
// only, like hub sessions.
type previewAuth struct {
	mu      sync.Mutex
	tokens  map[string]previewGrant
	cookies map[string]previewGrant
}

func newPreviewAuth() *previewAuth {
	return &previewAuth{tokens: map[string]previewGrant{}, cookies: map[string]previewGrant{}}
}

func secretKey(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (p *previewAuth) mint(into map[string]previewGrant, host string, ttl time.Duration) string {
	b := make([]byte, 32)
	rand.Read(b)
	secret := hex.EncodeToString(b)
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(into) > 4096 {
		for k, g := range into {
			if now.After(g.exp) {
				delete(into, k)
			}
		}
	}
	into[secretKey(secret)] = previewGrant{host: strings.ToLower(host), exp: now.Add(ttl)}
	return secret
}

// mintToken issues a one-time handoff token for one preview host.
func (p *previewAuth) mintToken(host string) string {
	return p.mint(p.tokens, host, previewTokenTTL)
}

// consumeToken accepts a token once, and only on the host it was minted for.
// Any presentation burns it, so a token tried on the wrong host is gone too.
func (p *previewAuth) consumeToken(token, host string) bool {
	if token == "" {
		return false
	}
	key := secretKey(token)
	p.mu.Lock()
	g, ok := p.tokens[key]
	delete(p.tokens, key)
	p.mu.Unlock()
	return ok && time.Now().Before(g.exp) && g.host == strings.ToLower(host)
}

func (p *previewAuth) mintCookie(host string) string {
	return p.mint(p.cookies, host, previewCookieTTL)
}

func (p *previewAuth) cookieValid(value, host string) bool {
	if value == "" {
		return false
	}
	key := secretKey(value)
	p.mu.Lock()
	defer p.mu.Unlock()
	g, ok := p.cookies[key]
	if !ok {
		return false
	}
	if time.Now().After(g.exp) {
		delete(p.cookies, key)
		return false
	}
	return g.host == strings.ToLower(host)
}

// revokeAll drops every preview cookie and pending token (on logout).
func (p *previewAuth) revokeAll() {
	p.mu.Lock()
	p.tokens = map[string]previewGrant{}
	p.cookies = map[string]previewGrant{}
	p.mu.Unlock()
}

// sessionValid reports whether the request carries a live hub session.
func (s *Server) sessionValid(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	return err == nil && s.sessions.valid(c.Value)
}

// handlePreviewAuth is step 2 of the handoff: on the hub's own origin, with
// the hub session, it mints a token for the preview host named by return and
// sends the browser back there with it.
func (s *Server) handlePreviewAuth(w http.ResponseWriter, r *http.Request) {
	if !s.sessionValid(r) {
		http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
		return
	}
	target, ok := s.validPreviewReturn(r, r.URL.Query().Get("return"))
	if !ok {
		httpError(w, http.StatusBadRequest, "return must be a preview address of this hub")
		return
	}
	token := s.previewAuth.mintToken(target.Host)
	target.RawQuery = withQueryParam(target.RawQuery, previewTokenParam, token)
	target.Fragment = ""
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, target.String(), http.StatusFound)
}

// validPreviewReturn accepts only a preview origin of this hub, on the same
// scheme and port the hub was reached on, so the endpoint can't be used as
// an open redirect or to hand a token to some other listener.
func (s *Server) validPreviewReturn(r *http.Request, raw string) (*url.URL, bool) {
	if raw == "" || len(raw) > 8192 {
		return nil, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Opaque != "" || u.Host == "" {
		return nil, false
	}
	if u.Scheme != requestScheme(r) {
		return nil, false
	}
	if _, ok := s.matchPreviewHost(u.Host); !ok {
		return nil, false
	}
	if normalPort(u.Scheme, hostPort(u.Host)) != normalPort(u.Scheme, hostPort(r.Host)) {
		return nil, false
	}
	u.Host = strings.ToLower(u.Host)
	return u, true
}

func normalPort(scheme, port string) string {
	if port == "" {
		if scheme == "https" {
			return "443"
		}
		return "80"
	}
	return port
}

// withQueryParam appends key=value to a raw query without re-encoding (or
// reordering) the app's own parameters. Any existing key is dropped first.
func withQueryParam(raw, key, value string) string {
	raw, _ = withoutQueryParam(raw, key)
	pair := url.QueryEscape(key) + "=" + url.QueryEscape(value)
	if raw == "" {
		return pair
	}
	return raw + "&" + pair
}

// withoutQueryParam removes key from a raw query and returns its last value.
func withoutQueryParam(raw, key string) (string, string) {
	if raw == "" {
		return "", ""
	}
	var keep []string
	var value string
	for _, part := range strings.Split(raw, "&") {
		k, v, _ := strings.Cut(part, "=")
		if uk, err := url.QueryUnescape(k); err == nil && uk == key {
			value, _ = url.QueryUnescape(v)
			continue
		}
		keep = append(keep, part)
	}
	return strings.Join(keep, "&"), value
}

// previewAuthRedirect sends an unauthenticated preview request to the hub to
// pick up a token (step 1).
func (s *Server) previewAuthRedirect(w http.ResponseWriter, r *http.Request, ph previewHost, rawQuery string) {
	scheme := requestScheme(r)
	hub := s.previewHubOrigin(scheme, ph)
	if hub == "" {
		previewPage(w, http.StatusServiceUnavailable, "Open Overseer first",
			"Overseer doesn't know its own address yet. Open the Overseer app once at its usual address, then reload this page.", false)
		return
	}
	back := scheme + "://" + r.Host + r.URL.EscapedPath()
	if rawQuery != "" {
		back += "?" + rawQuery
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, hub+"/api/previews/auth?return="+url.QueryEscape(back), http.StatusFound)
}

// previewHubOrigin is the hub address that holds the browser's session for
// this preview: localhost previews go to the hub on localhost, everything
// else to the hub's public address.
func (s *Server) previewHubOrigin(scheme string, ph previewHost) string {
	if ph.domain == "localhost" {
		host := "localhost"
		if p := hostPort(ph.host); p != "" {
			host += ":" + p
		}
		return scheme + "://" + host
	}
	if s.opts.TLSDomain != "" {
		return "https://" + s.opts.TLSDomain
	}
	if raw, _ := s.store.Setting(settingHubPublicURL); raw != "" {
		return strings.TrimRight(raw, "/")
	}
	return ""
}

// --- config API ---

type previewConfigView struct {
	Domain  string `json:"domain"`
	Source  string `json:"source"`
	HubHost string `json:"hubHost"`
	Secure  bool   `json:"secure"`
}

func (s *Server) previewConfigView(r *http.Request) previewConfigView {
	domain, source := s.previewDomain()
	return previewConfigView{Domain: domain, Source: source, HubHost: r.Host, Secure: requestScheme(r) == "https"}
}

func (s *Server) handleGetPreviewConfig(w http.ResponseWriter, r *http.Request) {
	// The UI calls this on load, so it is where the hub learns the address
	// browsers use (the derived preview domain and auth redirects need it).
	s.rememberPublicURL(r)
	s.invalidatePreviewDomain()
	writeJSON(w, s.previewConfigView(r))
}

func (s *Server) handlePutPreviewConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	domain, err := normalizePreviewDomain(req.Domain)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetSetting(settingPreviewDomain, domain); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.rememberPublicURL(r)
	s.invalidatePreviewDomain()
	writeJSON(w, s.previewConfigView(r))
}
