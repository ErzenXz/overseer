package hub

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent options: which models, thinking levels, fast tiers and modes an
// agent offers on a device. Discovery runs on the device (it starts the CLI
// without sending a prompt); results are cached per device+agent.

const (
	agentOptionsTTL      = 10 * time.Minute
	agentOptionsErrorTTL = time.Minute // builtin fallback after a failed request
	agentOptionsWait     = 30 * time.Second
)

type agentOptionsEntry struct {
	opts    protocol.AgentOptions
	expires time.Time
}

type agentOptionsCache struct {
	mu      sync.Mutex
	entries map[string]agentOptionsEntry
}

func newAgentOptionsCache() *agentOptionsCache {
	return &agentOptionsCache{entries: map[string]agentOptionsEntry{}}
}

func agentOptionsKey(deviceId, agent, command string) string {
	return deviceId + "\x00" + agent + "\x00" + command
}

func (c *agentOptionsCache) get(key string) (protocol.AgentOptions, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expires) {
		return protocol.AgentOptions{}, false
	}
	return e.opts, true
}

func (c *agentOptionsCache) put(key string, opts protocol.AgentOptions, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, e := range c.entries { // keep the map from growing with stale entries
		if now.After(e.expires) {
			delete(c.entries, k)
		}
	}
	c.entries[key] = agentOptionsEntry{opts: opts, expires: now.Add(ttl)}
}

// normaliseOptions guarantees the JSON shape the UI expects (arrays, never
// null; a default mode that exists).
func normaliseOptions(o protocol.AgentOptions, agent string) protocol.AgentOptions {
	o.Agent = agent
	if o.Source == "" {
		o.Source = protocol.OptionsBuiltin
	}
	if o.Models == nil {
		o.Models = []protocol.AgentModel{}
	}
	if o.Efforts == nil {
		o.Efforts = []protocol.AgentEffort{}
	}
	if len(o.Modes) == 0 {
		b := protocol.BuiltinAgentOptions(agent)
		o.Modes, o.DefaultMode = b.Modes, b.DefaultMode
	}
	found := false
	for _, m := range o.Modes {
		found = found || m.Id == o.DefaultMode
	}
	if !found {
		o.DefaultMode = o.Modes[0].Id
	}
	return o
}

// agentOptions returns the options for agent on deviceId, from the cache
// unless refresh is set. An offline device or a failed request yields the
// builtin table (never an error).
func (s *Server) agentOptions(deviceId, agent, command string, refresh bool) protocol.AgentOptions {
	if agent != "acp" {
		command = ""
	}
	key := agentOptionsKey(deviceId, agent, command)
	if !refresh {
		if o, ok := s.agentOpts.get(key); ok {
			return o
		}
	}
	c := s.registry.get(deviceId)
	if c == nil || (agent == "acp" && command == "") {
		return normaliseOptions(protocol.BuiltinAgentOptions(agent), agent)
	}
	ctx, cancel := contextWithTimeout(agentOptionsWait)
	defer cancel()
	var o protocol.AgentOptions
	err := c.requestInto(ctx, protocol.TypeAgentOptions, protocol.AgentOptionsRequest{Agent: agent, Command: command}, &o)
	ttl := agentOptionsTTL
	if err != nil {
		o, ttl = protocol.BuiltinAgentOptions(agent), agentOptionsErrorTTL
	}
	o = normaliseOptions(o, agent)
	s.agentOpts.put(key, o, ttl)
	return o
}

// cachedModes returns the cached modes for a device+agent, if any.
func (s *Server) cachedModes(deviceId, agent, command string) []protocol.AgentMode {
	if agent != "acp" {
		command = ""
	}
	if o, ok := s.agentOpts.get(agentOptionsKey(deviceId, agent, command)); ok {
		return o.Modes
	}
	return nil
}

// accessForMode derives the legacy access level from a mode's kind.
func (s *Server) accessForMode(deviceId, agent, command, mode string) string {
	return protocol.AccessForKind(protocol.ModeKind(agent, mode, s.cachedModes(deviceId, agent, command)))
}

// handleAgentOptions serves GET /api/devices/{id}/agents/{agent}/options.
func (s *Server) handleAgentOptions(w http.ResponseWriter, r *http.Request) {
	deviceId, agent := r.PathValue("id"), r.PathValue("agent")
	if !validAgentKind(agent) {
		httpError(w, http.StatusNotFound, "unknown agent")
		return
	}
	d, err := s.store.DeviceById(deviceId)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if d == nil {
		httpError(w, http.StatusNotFound, "device not found")
		return
	}
	command := strings.TrimSpace(r.URL.Query().Get("command"))
	refresh := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("refresh") == "true"
	writeJSON(w, s.agentOptions(deviceId, agent, command, refresh))
}
