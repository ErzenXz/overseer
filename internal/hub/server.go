// Package hub implements the Overseer hub: web UI host, REST API, and the
// rendezvous point every device agent dials into.
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/acme/autocert"

	"github.com/ErzenXz/overseer/internal/agent"
)

// Options configures a hub server.
type Options struct {
	Addr       string // listen address, e.g. ":4200" (ignored when TLSDomain is set)
	DataDir    string // where overseer.db and binaries/ live
	Version    string
	GithubRepo string // "owner/name" used to fetch agent binaries for other platforms
	UI         fs.FS  // embedded web UI (nil = API only)

	// TLSDomain enables automatic HTTPS via Let's Encrypt for this exact
	// domain. When set, the hub serves HTTPS on :443 and runs an HTTP server on
	// :80 for the ACME challenge + a redirect to HTTPS. TLSEmail is sent to the
	// CA for expiry notices.
	TLSDomain string
	TLSEmail  string

	// PreviewDomain overrides the domain live previews are served under
	// ({port}-{slug}.{PreviewDomain}); empty means the setting, else derived
	// from the hub's public address.
	PreviewDomain string
}

// Server is the hub.
type Server struct {
	opts          Options
	store         *Store
	sessions      *sessionManager
	loginRL       *rateLimiter
	events        *eventBus
	registry      *registry
	threads       *threadService
	agentOpts     *agentOptionsCache
	agents        *agentCatalog
	usageLimits   *usageLimitsCache
	extensions    *extCache
	mux           *http.ServeMux
	updates       *updateManager
	updateApplied atomic.Bool

	// Live previews (previews.go, preview_proxy.go).
	previewAuth        *previewAuth
	previewDomainCache previewDomainCache
	previewTransport   *http.Transport
	tunnelHosts        sync.Map // "{deviceId}:{port}" -> loopback address that answered

	// internalURL is a loopback-only plain-HTTP address serving the same mux.
	// The embedded agent and the MCP endpoint use it so they work identically
	// whether the public listener is HTTP or HTTPS.
	internalURL string
}

func NewServer(opts Options) (*Server, error) {
	if opts.DataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		opts.DataDir = filepath.Join(home, ".overseer")
	}
	if err := os.MkdirAll(opts.DataDir, 0o700); err != nil {
		return nil, err
	}
	if opts.GithubRepo == "" {
		opts.GithubRepo = "ErzenXz/overseer"
	}
	previewDomain, err := normalizePreviewDomain(opts.PreviewDomain)
	if err != nil {
		return nil, fmt.Errorf("--preview-domain: %w", err)
	}
	opts.PreviewDomain = previewDomain
	store, err := OpenStore(filepath.Join(opts.DataDir, "overseer.db"))
	if err != nil {
		return nil, err
	}
	events := newEventBus()
	s := &Server{
		opts:      opts,
		store:     store,
		sessions:  newSessionManager(),
		loginRL:   newRateLimiter(),
		events:    events,
		registry:  newRegistry(events),
		mux:       http.NewServeMux(),
		agentOpts: newAgentOptionsCache(),

		usageLimits: newUsageLimitsCache(),
		extensions:  newExtCache(),
		previewAuth: newPreviewAuth(),
	}
	s.previewTransport = s.newPreviewTransport()
	s.agents = newAgentCatalog(store, opts.DataDir, opts.Version)
	s.threads = newThreadService(s)
	s.resetInterruptedThreads()
	s.routes()
	s.updates = newUpdateManager(store, opts.Version, opts.GithubRepo)
	return s, nil
}

// logSetupCode prints the first-run link while the hub has no password.
func (s *Server) logSetupCode(base string) {
	code, err := s.ensureSetupCode()
	if err != nil {
		log.Printf("setup code: %v", err)
		return
	}
	if code != "" {
		log.Printf("First-run setup: open %s/?setup=%s to choose the admin password (setup code %s)", base, code, code)
	}
}

// newHTTPServer builds an http.Server for the shared mux with sane timeouts.
// ReadTimeout/WriteTimeout are intentionally unset: they would break
// long-lived WebSockets and large transfers (hijacked conns manage their own
// deadlines via gorilla).
func (s *Server) newHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// Run serves until ctx is cancelled. It also starts the embedded local agent
// so the hub machine itself shows up as a device.
func (s *Server) Run(ctx context.Context) error {
	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()
	s.updates.start(runCtx, func() {
		s.updateApplied.Store(true)
		cancelRun()
	})

	// Internal loopback listener: always plain HTTP, used by the embedded agent
	// and the MCP endpoint's in-process client regardless of public TLS.
	internalLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s.internalURL = "http://" + internalLn.Addr().String()
	internalSrv := s.newHTTPServer(s.handler())
	go internalSrv.Serve(internalLn)

	go func() {
		<-runCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		internalSrv.Shutdown(shutdownCtx)
	}()
	go s.runEmbeddedAgent(runCtx)
	go s.runAutomations(runCtx)
	go s.agents.run(runCtx)

	if s.opts.TLSDomain != "" {
		err := s.runTLS(runCtx)
		if s.updateApplied.Load() {
			return nil
		}
		return err
	}
	err = s.runPlain(runCtx)
	if s.updateApplied.Load() {
		return nil
	}
	return err
}

// runPlain serves HTTP on the configured address.
func (s *Server) runPlain(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.opts.Addr)
	if err != nil {
		return err
	}
	srv := s.newHTTPServer(s.handler())
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	log.Printf("Overseer hub listening on http://%s", displayAddr(ln.Addr().String()))
	s.logSetupCode("http://" + displayAddr(ln.Addr().String()))
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// runTLS serves HTTPS with automatic Let's Encrypt certificates for the
// configured domain, plus a plain-HTTP server on :80 that answers the ACME
// challenge and redirects everything else to HTTPS.
func (s *Server) runTLS(ctx context.Context) error {
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(s.opts.TLSDomain),
		Cache:      autocert.DirCache(filepath.Join(s.opts.DataDir, "certs")),
		Email:      s.opts.TLSEmail,
	}

	// :80 — serves the HTTP-01 challenge and redirects real traffic to HTTPS.
	httpSrv := s.newHTTPServer(m.HTTPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://"+s.opts.TLSDomain+r.URL.RequestURI(), http.StatusMovedPermanently)
	})))
	httpSrv.Addr = ":80"
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http (:80) challenge server: %v", err)
		}
	}()

	httpsSrv := s.newHTTPServer(s.handler())
	httpsSrv.Addr = ":443"
	httpsSrv.TLSConfig = m.TLSConfig() // negotiates certs + acme-tls/1

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		httpsSrv.Shutdown(shutdownCtx)
		httpSrv.Shutdown(shutdownCtx)
	}()

	log.Printf("Overseer hub listening on https://%s (auto-TLS via Let's Encrypt)", s.opts.TLSDomain)
	s.logSetupCode("https://" + s.opts.TLSDomain)
	// Certs are supplied by TLSConfig, so no cert/key files here.
	if err := httpsSrv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// runEmbeddedAgent registers (once) and runs an in-process agent for the hub
// machine, connecting over the internal loopback listener like any other device.
func (s *Server) runEmbeddedAgent(ctx context.Context) {
	token, err := s.store.Setting("hub_device_token")
	if err != nil {
		log.Printf("embedded agent: %v", err)
		return
	}
	if token == "" {
		hostname, _ := os.Hostname()
		name := hostname
		if name == "" {
			name = "hub"
		}
		_, tok, err := s.store.CreateDevice(name, hostname, "", "", true)
		if err != nil {
			log.Printf("embedded agent: registering hub device: %v", err)
			return
		}
		if err := s.store.SetSetting("hub_device_token", tok); err != nil {
			log.Printf("embedded agent: %v", err)
			return
		}
		token = tok
	}
	cfg := agent.Config{HubURL: s.internalURL, Token: token}
	if err := agent.New(cfg, s.opts.Version).Run(ctx); err != nil && ctx.Err() == nil {
		log.Printf("embedded agent stopped: %v", err)
	}
}

// handler is the root handler: requests for a live-preview origin
// ({port}-{slug}.{previewDomain}) go to the preview proxy, everything else
// to the app and API.
func (s *Server) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ph, ok := s.matchPreviewHost(r.Host); ok {
			s.servePreview(w, r, ph)
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	m := s.mux

	// Public (pre-auth) endpoints.
	m.HandleFunc("POST /api/setup", s.handleSetup)
	m.HandleFunc("POST /api/login", s.handleLogin)
	m.HandleFunc("POST /api/logout", s.handleLogout)
	m.HandleFunc("GET /api/me", s.handleMe)
	m.HandleFunc("POST /api/enroll", s.handleEnroll)
	m.HandleFunc("GET /install/", s.handleInstallScript)
	m.HandleFunc("GET /api/agent-binary", s.handleAgentBinary)
	m.HandleFunc("GET /api/agent-binary/sha256", s.handleAgentBinarySum)
	m.HandleFunc("GET /api/ws/agent", s.handleAgentWS)
	m.HandleFunc("GET /api/previews/auth", s.handlePreviewAuth) // checks the session itself

	// Remote MCP endpoint (does its own Bearer-token auth).
	m.HandleFunc("/mcp", s.handleMCPHTTP)

	// Authenticated API.
	m.HandleFunc("GET /api/devices", s.requireAuth(s.handleListDevices))
	m.HandleFunc("PATCH /api/devices/{id}", s.requireAuth(s.handleRenameDevice))
	m.HandleFunc("DELETE /api/devices/{id}", s.requireAuth(s.handleDeleteDevice))
	m.HandleFunc("POST /api/enroll-tokens", s.requireAuth(s.handleCreateEnrollToken))
	m.HandleFunc("GET /api/devices/{id}/sessions", s.requireAuth(s.handleListSessions))
	m.HandleFunc("POST /api/devices/{id}/sessions", s.requireAuth(s.handleCreateSession))
	m.HandleFunc("DELETE /api/devices/{id}/sessions/{name}", s.requireAuth(s.handleKillSession))
	m.HandleFunc("POST /api/devices/{id}/sessions/{name}/input", s.requireAuth(s.handleSessionInput))
	m.HandleFunc("GET /api/devices/{id}/sessions/{name}/output", s.requireAuth(s.handleSessionOutput))
	m.HandleFunc("POST /api/devices/{id}/exec", s.requireAuth(s.handleExec))
	m.HandleFunc("GET /api/devices/{id}/setup", s.requireAuth(s.handleSetupStatus))
	m.HandleFunc("GET /api/devices/{id}/fs", s.requireAuth(s.handleFsList))
	m.HandleFunc("GET /api/devices/{id}/fs/download", s.requireAuth(s.handleFsDownload))
	m.HandleFunc("POST /api/devices/{id}/fs/upload", s.requireAuth(s.handleFsUpload))
	m.HandleFunc("GET /api/projects", s.requireAuth(s.handleListProjects))
	m.HandleFunc("POST /api/projects", s.requireAuth(s.handleCreateProject))
	m.HandleFunc("PATCH /api/projects/{id}", s.requireAuth(s.handleUpdateProject))
	m.HandleFunc("DELETE /api/projects/{id}", s.requireAuth(s.handleDeleteProject))
	m.HandleFunc("POST /api/projects/{id}/exec", s.requireAuth(s.handleProjectExec))
	m.HandleFunc("GET /api/agents", s.requireAuth(s.handleFleetAgents))
	m.HandleFunc("GET /api/presets", s.requireAuth(s.handleListPresets))
	m.HandleFunc("POST /api/presets", s.requireAuth(s.handleCreatePreset))
	m.HandleFunc("DELETE /api/presets/{id}", s.requireAuth(s.handleDeletePreset))
	m.HandleFunc("GET /api/tokens", s.requireAuth(s.handleListApiTokens))
	m.HandleFunc("POST /api/tokens", s.requireAuth(s.handleCreateApiToken))
	m.HandleFunc("DELETE /api/tokens/{id}", s.requireAuth(s.handleDeleteApiToken))
	m.HandleFunc("GET /api/updates", s.requireAuth(s.handleUpdateStatus))
	m.HandleFunc("POST /api/updates/check", s.requireAuth(s.handleUpdateCheck))
	m.HandleFunc("PATCH /api/updates", s.requireAuth(s.handleUpdateSettings))
	m.HandleFunc("POST /api/updates/install", s.requireAuth(s.handleUpdateInstall))
	m.HandleFunc("POST /api/updates/rollback", s.requireAuth(s.handleUpdateRollback))
	m.HandleFunc("GET /api/threads", s.requireAuth(s.handleListThreads))
	m.HandleFunc("POST /api/threads", s.requireAuth(s.handleCreateThread))
	m.HandleFunc("GET /api/threads/{id}", s.requireAuth(s.handleGetThread))
	m.HandleFunc("PATCH /api/threads/{id}", s.requireAuth(s.handlePatchThread))
	m.HandleFunc("DELETE /api/threads/{id}", s.requireAuth(s.handleDeleteThread))
	m.HandleFunc("POST /api/threads/{id}/prompt", s.requireAuth(s.handleThreadPrompt))
	m.HandleFunc("POST /api/threads/{id}/cancel", s.requireAuth(s.handleThreadCancel))
	m.HandleFunc("POST /api/threads/{id}/approval", s.requireAuth(s.handleThreadApproval))
	m.HandleFunc("POST /api/threads/{id}/fork", s.requireAuth(s.handleForkThread))
	m.HandleFunc("POST /api/threads/{id}/compact", s.requireAuth(s.handleCompactThread))
	m.HandleFunc("POST /api/threads/{id}/undo", s.requireAuth(s.handleUndoThread))
	m.HandleFunc("POST /api/threads/{id}/answer", s.requireAuth(s.handleAnswerThread))
	m.HandleFunc("GET /api/threads/{id}/commands", s.requireAuth(s.handleThreadCommands))
	m.HandleFunc("GET /api/threads/{id}/capabilities", s.requireAuth(s.handleThreadCapabilities))
	m.HandleFunc("GET /api/agent-kinds", s.requireAuth(s.handleAgentKinds))
	m.HandleFunc("GET /api/agents/catalog", s.requireAuth(s.handleAgentCatalog))
	m.HandleFunc("POST /api/agents/custom", s.requireAuth(s.handleCreateCustomAgent))
	m.HandleFunc("DELETE /api/agents/custom/{id}", s.requireAuth(s.handleDeleteCustomAgent))
	m.HandleFunc("GET /api/devices/{id}/agents", s.requireAuth(s.handleDeviceAgents))
	m.HandleFunc("GET /api/devices/{id}/agents/{agent}/options", s.requireAuth(s.handleAgentOptions))
	m.HandleFunc("GET /api/devices/{id}/desktop", s.requireAuth(s.handleDeviceDesktop))
	m.HandleFunc("GET /api/devices/{id}/ports", s.requireAuth(s.handleDevicePorts))
	m.HandleFunc("GET /api/usage/limits", s.requireAuth(s.handleUsageLimits))
	m.HandleFunc("GET /api/devices/{id}/extensions", s.requireAuth(s.handleExtensions))
	m.HandleFunc("GET /api/devices/{id}/extensions/item", s.requireAuth(s.handleExtensionItem))
	m.HandleFunc("GET /api/devices/{id}/extensions/catalog", s.requireAuth(s.handleExtensionCatalog))
	m.HandleFunc("POST /api/devices/{id}/extensions/toggle", s.requireAuth(s.handleExtensionToggle))
	m.HandleFunc("POST /api/devices/{id}/extensions/uninstall", s.requireAuth(s.handleExtensionUninstall))
	m.HandleFunc("POST /api/devices/{id}/extensions/install", s.requireAuth(s.handleExtensionInstall))
	m.HandleFunc("POST /api/devices/{id}/skills", s.requireAuth(s.handleCreateSkill))
	m.HandleFunc("POST /api/devices/{id}/skills/share", s.requireAuth(s.handleShareSkill))
	m.HandleFunc("GET /api/previews/config", s.requireAuth(s.handleGetPreviewConfig))
	m.HandleFunc("PUT /api/previews/config", s.requireAuth(s.handlePutPreviewConfig))
	m.HandleFunc("GET /api/mcp-servers", s.requireAuth(s.handleListMcpServers))
	m.HandleFunc("POST /api/mcp-servers", s.requireAuth(s.handleCreateMcpServer))
	m.HandleFunc("PATCH /api/mcp-servers/{id}", s.requireAuth(s.handlePatchMcpServer))
	m.HandleFunc("DELETE /api/mcp-servers/{id}", s.requireAuth(s.handleDeleteMcpServer))
	m.HandleFunc("GET /api/automations", s.requireAuth(s.handleListAutomations))
	m.HandleFunc("POST /api/automations", s.requireAuth(s.handleCreateAutomation))
	m.HandleFunc("PATCH /api/automations/{id}", s.requireAuth(s.handlePatchAutomation))
	m.HandleFunc("DELETE /api/automations/{id}", s.requireAuth(s.handleDeleteAutomation))
	m.HandleFunc("POST /api/automations/{id}/run", s.requireAuth(s.handleRunAutomation))
	m.HandleFunc("GET /api/ws/term", s.requireAuth(s.handleTermWS))
	m.HandleFunc("GET /api/ws/events", s.requireAuth(s.handleEventsWS))
	m.HandleFunc("GET /api/ws/threads/{id}", s.requireAuth(s.handleThreadWS))
	m.HandleFunc("GET /api/ws/desktop", s.requireAuth(s.handleDesktopWS))
	m.HandleFunc("GET /api/ws/devices/{id}/tcp/{port}", s.requireAuth(s.handleDeviceTCPWS))

	// Web UI (embedded SPA) at everything else.
	if s.opts.UI != nil {
		m.HandleFunc("/", s.handleUI)
	}
}

// handleUI serves the embedded SPA with index.html fallback for client routes.
// The web app ships a PWA manifest; Go's built-in table doesn't know the
// extension, and browsers warn when it arrives as text/plain.
func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	f, err := s.opts.UI.Open(p)
	if err != nil {
		p = "index.html"
		if f, err = s.opts.UI.Open(p); err != nil {
			httpError(w, http.StatusNotFound, "UI not built into this binary")
			return
		}
	}
	defer f.Close()
	stat, _ := f.Stat()
	if rs, ok := f.(interface {
		fs.File
		Seek(int64, int) (int64, error)
	}); ok {
		http.ServeContent(w, r, p, stat.ModTime(), rs)
	}
}

// --- small helpers used across handlers ---

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(v)
}

func displayAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if host == "" || host == "::" || host == "0.0.0.0" {
		return fmt.Sprintf("localhost:%s", port)
	}
	return addr
}
