package hub

import (
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The MCP registry: servers configured once in the UI are handed to every
// coding agent on every machine via thread.start. The hub's own /mcp
// endpoint is always listed first as a built-in entry.

const (
	builtinMcpId         = "builtin"
	settingBuiltinMcp    = "mcp_builtin_enabled"
	settingBuiltinToken  = "mcp_builtin_token"
	settingHubPublicURL  = "hub_public_url"
	maxMcpServerName     = 80
	builtinMcpTokenLabel = "Built-in MCP (coding agents)"
)

var mcpEnvKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

var publicURLMu sync.Mutex

// rememberPublicURL records the address browsers reach the hub at, so
// agents (including scheduled runs with no request) can be pointed at /mcp.
func (s *Server) rememberPublicURL(r *http.Request) {
	url := requestBaseURL(r)
	publicURLMu.Lock()
	defer publicURLMu.Unlock()
	if cur, _ := s.store.Setting(settingHubPublicURL); cur != url {
		s.store.SetSetting(settingHubPublicURL, url)
	}
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *Server) hubPublicURL() string {
	if s.opts.TLSDomain != "" {
		return "https://" + s.opts.TLSDomain
	}
	if u, _ := s.store.Setting(settingHubPublicURL); u != "" {
		return u
	}
	return s.internalURL // only reachable from the hub machine itself
}

func (s *Server) builtinMcp(base string) protocol.McpServer {
	enabled, _ := s.store.Setting(settingBuiltinMcp)
	return protocol.McpServer{
		Id: builtinMcpId, Name: "Overseer", Transport: "http", Url: base + "/mcp",
		Enabled: enabled == "1", Builtin: true,
	}
}

// builtinMcpToken returns the API token agents use to call the hub's MCP
// endpoint, minting a dedicated one on first use (and again if the user
// revoked it).
func (s *Server) builtinMcpToken() string {
	if tok, _ := s.store.Setting(settingBuiltinToken); tok != "" {
		if ok, _ := s.store.ValidApiToken(tok); ok {
			return tok
		}
	}
	tok, err := s.store.CreateApiToken(builtinMcpTokenLabel)
	if err != nil {
		log.Printf("mcp: minting built-in token: %v", err)
		return ""
	}
	s.store.SetSetting(settingBuiltinToken, tok)
	return tok
}

// agentMcpServers is the enabled registry as handed to thread.start.
func (s *Server) agentMcpServers() []protocol.McpServer {
	out := []protocol.McpServer{}
	if b := s.builtinMcp(s.hubPublicURL()); b.Enabled {
		if tok := s.builtinMcpToken(); tok != "" {
			b.Headers = map[string]string{"Authorization": "Bearer " + tok}
			out = append(out, b)
		}
	}
	servers, err := s.store.ListMcpServers()
	if err != nil {
		log.Printf("mcp: listing servers: %v", err)
		return out
	}
	for _, m := range servers {
		if m.Enabled {
			out = append(out, m)
		}
	}
	return out
}

// mcpServerInput is a create/patch body; pointers distinguish "absent".
type mcpServerInput struct {
	Name      *string            `json:"name"`
	Transport *string            `json:"transport"`
	Command   *string            `json:"command"`
	Args      *[]string          `json:"args"`
	Env       *map[string]string `json:"env"`
	Url       *string            `json:"url"`
	Headers   *map[string]string `json:"headers"`
	Enabled   *bool              `json:"enabled"`
}

func (in mcpServerInput) apply(m *protocol.McpServer) {
	if in.Name != nil {
		m.Name = strings.TrimSpace(*in.Name)
	}
	if in.Transport != nil {
		m.Transport = strings.TrimSpace(*in.Transport)
	}
	if in.Command != nil {
		m.Command = strings.TrimSpace(*in.Command)
	}
	if in.Args != nil {
		m.Args = *in.Args
	}
	if in.Env != nil {
		m.Env = *in.Env
	}
	if in.Url != nil {
		m.Url = strings.TrimSpace(*in.Url)
	}
	if in.Headers != nil {
		m.Headers = *in.Headers
	}
	if in.Enabled != nil {
		m.Enabled = *in.Enabled
	}
}

func validateMcpServer(m *protocol.McpServer) string {
	switch {
	case m.Name == "" || len(m.Name) > maxMcpServerName:
		return "name must be 1-80 characters"
	case m.Transport != "stdio" && m.Transport != "http":
		return "transport must be stdio or http"
	case m.Transport == "stdio" && m.Command == "":
		return "command is required for a stdio server"
	case m.Transport == "http" && !strings.HasPrefix(m.Url, "http://") && !strings.HasPrefix(m.Url, "https://"):
		return "url must start with http:// or https://"
	}
	for k := range m.Env {
		if !mcpEnvKeyRe.MatchString(k) {
			return "invalid environment variable name " + k
		}
	}
	// Keep only the fields that belong to the transport.
	if m.Transport == "stdio" {
		m.Url, m.Headers = "", nil
	} else {
		m.Command, m.Args, m.Env = "", nil, nil
	}
	return ""
}

func (s *Server) handleListMcpServers(w http.ResponseWriter, r *http.Request) {
	s.rememberPublicURL(r)
	servers, err := s.store.ListMcpServers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, append([]protocol.McpServer{s.builtinMcp(requestBaseURL(r))}, servers...))
}

func (s *Server) handleCreateMcpServer(w http.ResponseWriter, r *http.Request) {
	var in mcpServerInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid MCP server")
		return
	}
	m := protocol.McpServer{Id: randomToken()[:16], Enabled: true}
	in.apply(&m)
	if msg := validateMcpServer(&m); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.store.SaveMcpServer(m); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, m)
}

func (s *Server) handlePatchMcpServer(w http.ResponseWriter, r *http.Request) {
	var in mcpServerInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid MCP server")
		return
	}
	id := r.PathValue("id")
	if id == builtinMcpId {
		// Only the enabled toggle applies to the built-in entry.
		if in.Enabled != nil {
			v := "0"
			if *in.Enabled {
				v = "1"
			}
			if err := s.store.SetSetting(settingBuiltinMcp, v); err != nil {
				httpError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, s.builtinMcp(requestBaseURL(r)))
		return
	}
	m, err := s.store.McpServerById(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		httpError(w, http.StatusNotFound, "MCP server not found")
		return
	}
	in.apply(m)
	if msg := validateMcpServer(m); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.store.SaveMcpServer(*m); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, m)
}

func (s *Server) handleDeleteMcpServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == builtinMcpId {
		httpError(w, http.StatusBadRequest, "the built-in server can be disabled but not removed")
		return
	}
	m, err := s.store.McpServerById(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		httpError(w, http.StatusNotFound, "MCP server not found")
		return
	}
	if err := s.store.DeleteMcpServer(id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
