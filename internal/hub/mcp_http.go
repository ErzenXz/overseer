package hub

import (
	"io"
	"net/http"
	"strings"

	"github.com/ErzenXz/overseer/internal/fleet"
	"github.com/ErzenXz/overseer/internal/mcp"
)

// handleMCPHTTP is the remote MCP endpoint (Streamable HTTP transport). Point
// an MCP client — ChatGPT's custom connectors, Claude, Cursor, etc. — at
// https://<hub>/mcp with an API token as a Bearer credential, and it gets the
// fleet's coding tools (run_command, read_file, write_file, list_files, ...).
//
// SECURITY: these tools run arbitrary commands and write files on your devices.
// This endpoint is a remote shell. It requires a valid API token and should
// only ever be exposed over HTTPS (use --tls-domain, or a TLS reverse proxy /
// Tailscale). Anyone with the token owns the box — treat it like an SSH key.
func (s *Server) handleMCPHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		// Tools-only server: no server-initiated SSE stream. Per the MCP
		// Streamable HTTP spec, 405 is the correct response to GET here.
		w.Header().Set("Allow", "POST")
		httpError(w, http.StatusMethodNotAllowed, "this MCP endpoint speaks JSON-RPC over POST")
		return
	}
	if r.Method != http.MethodPost {
		httpError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		w.Header().Set("WWW-Authenticate", `Bearer realm="overseer"`)
		httpError(w, http.StatusUnauthorized, "missing API token (add it as a Bearer token in your MCP client)")
		return
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	if ok, err := s.store.ValidApiToken(token); err != nil || !ok {
		httpError(w, http.StatusUnauthorized, "invalid API token")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8<<20))
	if err != nil {
		httpError(w, http.StatusBadRequest, "request too large or unreadable")
		return
	}

	// Execute tools through the hub's own API over the internal loopback
	// listener, authenticated with the caller's token. Works identically
	// whether the public listener is HTTP or HTTPS.
	client := fleet.New(s.internalURL, token)
	resp, isNotification := mcp.HandleMessage(client, s.opts.Version, body)
	if isNotification {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}
