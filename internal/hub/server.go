// Package hub implements the Overseer hub: web UI host, REST API, and the
// rendezvous point every device agent dials into.
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/agent"
)

// Options configures a hub server.
type Options struct {
	Addr       string // listen address, e.g. ":4200"
	DataDir    string // where overseer.db and binaries/ live
	Version    string
	GithubRepo string // "owner/name" used to fetch agent binaries for other platforms
	UI         fs.FS  // embedded web UI (nil = API only)
}

// Server is the hub.
type Server struct {
	opts     Options
	store    *Store
	sessions *sessionManager
	loginRL  *rateLimiter
	events   *eventBus
	registry *registry
	mux      *http.ServeMux
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
	store, err := OpenStore(filepath.Join(opts.DataDir, "overseer.db"))
	if err != nil {
		return nil, err
	}
	events := newEventBus()
	s := &Server{
		opts:     opts,
		store:    store,
		sessions: newSessionManager(),
		loginRL:  newRateLimiter(),
		events:   events,
		registry: newRegistry(events),
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s, nil
}

// Run serves until ctx is cancelled. It also starts the embedded local agent
// so the hub machine itself shows up as a device.
func (s *Server) Run(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.opts.Addr)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler: s.mux,
		// Guard against Slowloris-style header stalls. We deliberately do not set
		// ReadTimeout/WriteTimeout: those would break long-lived WebSockets and
		// large file transfers. Hijacked (WebSocket) connections manage their own
		// deadlines via gorilla.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	go s.runEmbeddedAgent(ctx, ln.Addr().String())

	log.Printf("Overseer hub listening on http://%s", displayAddr(ln.Addr().String()))
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// runEmbeddedAgent registers (once) and runs an in-process agent for the hub
// machine, connecting over loopback like any other device.
func (s *Server) runEmbeddedAgent(ctx context.Context, listenAddr string) {
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
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		log.Printf("embedded agent: %v", err)
		return
	}
	// Dial the actual bound host; only fall back to loopback for wildcard binds,
	// otherwise a hub started with --addr 192.168.1.10:4200 could never reach
	// itself over 127.0.0.1.
	if host == "" || host == "::" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	cfg := agent.Config{HubURL: "http://" + net.JoinHostPort(host, port), Token: token}
	if err := agent.New(cfg, s.opts.Version).Run(ctx); err != nil && ctx.Err() == nil {
		log.Printf("embedded agent stopped: %v", err)
	}
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
	m.HandleFunc("GET /api/ws/agent", s.handleAgentWS)

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
	m.HandleFunc("GET /api/devices/{id}/fs", s.requireAuth(s.handleFsList))
	m.HandleFunc("GET /api/devices/{id}/fs/download", s.requireAuth(s.handleFsDownload))
	m.HandleFunc("POST /api/devices/{id}/fs/upload", s.requireAuth(s.handleFsUpload))
	m.HandleFunc("GET /api/agents", s.requireAuth(s.handleFleetAgents))
	m.HandleFunc("GET /api/presets", s.requireAuth(s.handleListPresets))
	m.HandleFunc("POST /api/presets", s.requireAuth(s.handleCreatePreset))
	m.HandleFunc("DELETE /api/presets/{id}", s.requireAuth(s.handleDeletePreset))
	m.HandleFunc("GET /api/tokens", s.requireAuth(s.handleListApiTokens))
	m.HandleFunc("POST /api/tokens", s.requireAuth(s.handleCreateApiToken))
	m.HandleFunc("DELETE /api/tokens/{id}", s.requireAuth(s.handleDeleteApiToken))
	m.HandleFunc("GET /api/ws/term", s.requireAuth(s.handleTermWS))
	m.HandleFunc("GET /api/ws/events", s.requireAuth(s.handleEventsWS))

	// Web UI (embedded SPA) at everything else.
	if s.opts.UI != nil {
		m.HandleFunc("/", s.handleUI)
	}
}

// handleUI serves the embedded SPA with index.html fallback for client routes.
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
