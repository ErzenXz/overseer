package hub

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Skills & plugins: each device reads its agents' extensions (extensions.*,
// skills.*) and the hub caches inventories per device and project. See
// "Skills & plugins" in docs/agent-sessions-api.md.

const (
	extListTTL     = 60 * time.Second
	extListWait    = 12 * time.Second // the device budgets ~8 s
	extItemWait    = 15 * time.Second // may take a fresh inventory
	extChangeWait  = 45 * time.Second
	extInstallWait = 150 * time.Second // clones a repository
	extCatalogWait = 40 * time.Second
	maxExtKey      = 8192
	maxExtCwd      = 4096
)

type extCacheEntry struct {
	res protocol.ExtListResult
	at  time.Time
}

// extCache holds inventories per device+cwd. A write to a device bumps its
// generation, which drops its entries and keeps reads that started before
// the write from being stored.
type extCache struct {
	mu       sync.Mutex
	entries  map[string]extCacheEntry
	gen      map[string]uint64
	inflight map[string]*extRead
}

type extRead struct {
	done chan struct{}
	res  protocol.ExtListResult
	err  error
}

func newExtCache() *extCache {
	return &extCache{entries: map[string]extCacheEntry{}, gen: map[string]uint64{}, inflight: map[string]*extRead{}}
}

func extCacheKey(deviceId, cwd string) string { return deviceId + "\x00" + cwd }

func (c *extCache) invalidate(deviceId string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gen[deviceId]++
	for k := range c.entries {
		if strings.HasPrefix(k, deviceId+"\x00") {
			delete(c.entries, k)
		}
	}
}

// list returns the device's inventory for cwd, from the cache unless it is
// older than extListTTL or refresh is set. Concurrent callers share a read.
func (s *Server) extList(c *agentConn, cwd string, refresh bool) (protocol.ExtListResult, error) {
	cache := s.extensions
	key := extCacheKey(c.deviceId, cwd)
	cache.mu.Lock()
	if e, ok := cache.entries[key]; ok && !refresh && time.Since(e.at) < extListTTL {
		cache.mu.Unlock()
		return e.res, nil
	}
	if r, ok := cache.inflight[key]; ok {
		cache.mu.Unlock()
		<-r.done
		return r.res, r.err
	}
	r := &extRead{done: make(chan struct{})}
	cache.inflight[key] = r
	gen := cache.gen[c.deviceId]
	cache.mu.Unlock()

	ctx, cancel := contextWithTimeout(extListWait)
	defer cancel()
	list := s.agents.list()
	r.err = c.requestInto(ctx, protocol.TypeExtList, protocol.ExtListRequest{Cwd: cwd, Detect: s.agents.detectSpecs(list)}, &r.res)
	if r.res.Items == nil {
		r.res.Items = []protocol.ExtItem{}
	}
	if r.res.Agents == nil {
		r.res.Agents = []protocol.ExtAgentStatus{}
	}
	cache.mu.Lock()
	delete(cache.inflight, key)
	if r.err == nil && cache.gen[c.deviceId] == gen {
		for k, e := range cache.entries {
			if time.Since(e.at) >= extListTTL {
				delete(cache.entries, k)
			}
		}
		cache.entries[key] = extCacheEntry{res: r.res, at: time.Now()}
	}
	cache.mu.Unlock()
	close(r.done)
	return r.res, r.err
}

// extDevice resolves the {id} device: 404 unknown, 503 offline.
func (s *Server) extDevice(w http.ResponseWriter, r *http.Request) *agentConn {
	id := r.PathValue("id")
	d, err := s.store.DeviceById(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if d == nil {
		httpError(w, http.StatusNotFound, "device not found")
		return nil
	}
	return s.deviceConn(w, r)
}

// extDeviceError maps a device round-trip failure onto an HTTP answer.
func extDeviceError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		httpError(w, http.StatusGatewayTimeout, "the device did not answer in time")
	case strings.Contains(msg, "unsupported request"):
		httpError(w, http.StatusBadGateway, "this machine's agent is too old for Skills & plugins; update it")
	case msg == "device disconnected":
		httpError(w, http.StatusBadGateway, msg)
	case strings.Contains(msg, "already exists") || strings.Contains(msg, "already has"):
		httpError(w, http.StatusConflict, msg)
	case strings.HasPrefix(msg, "unknown item"):
		httpError(w, http.StatusNotFound, msg)
	default:
		httpError(w, http.StatusBadRequest, msg)
	}
}

func validExtKey(key string) bool {
	return key != "" && len(key) <= maxExtKey
}

func extCwd(cwd string) (string, bool) {
	cwd = strings.TrimSpace(cwd)
	return cwd, len(cwd) <= maxExtCwd && !strings.ContainsRune(cwd, 0)
}

// GET /api/devices/{id}/extensions[?cwd=][&refresh=1]
func (s *Server) handleExtensions(w http.ResponseWriter, r *http.Request) {
	cwd, ok := extCwd(r.URL.Query().Get("cwd"))
	if !ok {
		httpError(w, http.StatusBadRequest, "bad cwd")
		return
	}
	c := s.extDevice(w, r)
	if c == nil {
		return
	}
	refresh := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("refresh") == "true"
	res, err := s.extList(c, cwd, refresh)
	if err != nil {
		extDeviceError(w, err)
		return
	}
	writeJSON(w, res)
}

// GET /api/devices/{id}/extensions/item?key=
func (s *Server) handleExtensionItem(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !validExtKey(key) {
		httpError(w, http.StatusBadRequest, "key is required")
		return
	}
	c := s.extDevice(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(extItemWait)
	defer cancel()
	var res protocol.ExtItemResult
	if err := c.requestInto(ctx, protocol.TypeExtItem, protocol.ExtKeyRequest{Key: key}, &res); err != nil {
		extDeviceError(w, err)
		return
	}
	writeJSON(w, res)
}

// extChange sends a write to the device and drops its cached inventories.
func (s *Server) extChange(w http.ResponseWriter, c *agentConn, typ string, req any, wait time.Duration) {
	ctx, cancel := contextWithTimeout(wait)
	defer cancel()
	var res protocol.ExtChangeResult
	err := c.requestInto(ctx, typ, req, &res)
	if res.NeedsApproval == nil {
		// Even a failed change may have done part of its work.
		s.extensions.invalidate(c.deviceId)
	}
	if err != nil {
		extDeviceError(w, err)
		return
	}
	if typ == protocol.TypeExtUninstall {
		res.Ok = true
	}
	writeJSON(w, res)
}

// POST /api/devices/{id}/extensions/toggle {key, enabled}
func (s *Server) handleExtensionToggle(w http.ResponseWriter, r *http.Request) {
	var req protocol.ExtToggleRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request body")
		return
	}
	if !validExtKey(req.Key) || req.Enabled == nil {
		httpError(w, http.StatusBadRequest, "key and enabled are required")
		return
	}
	if c := s.extDevice(w, r); c != nil {
		s.extChange(w, c, protocol.TypeExtToggle, req, extChangeWait)
	}
}

// POST /api/devices/{id}/extensions/uninstall {key}
func (s *Server) handleExtensionUninstall(w http.ResponseWriter, r *http.Request) {
	var req protocol.ExtKeyRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request body")
		return
	}
	if !validExtKey(req.Key) {
		httpError(w, http.StatusBadRequest, "key is required")
		return
	}
	if c := s.extDevice(w, r); c != nil {
		s.extChange(w, c, protocol.TypeExtUninstall, req, extInstallWait)
	}
}

var (
	extPluginIdRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$`)
	extShaRe      = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
	extSkillRe    = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	extAgentRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
)

// POST /api/devices/{id}/extensions/install {agent, id, scope, cwd?, acceptCommand?}
func (s *Server) handleExtensionInstall(w http.ResponseWriter, r *http.Request) {
	var req protocol.ExtInstallRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request body")
		return
	}
	var ok bool
	if req.Cwd, ok = extCwd(req.Cwd); !ok {
		httpError(w, http.StatusBadRequest, "bad cwd")
		return
	}
	switch {
	case req.Agent != "claude" && req.Agent != "codex":
		httpError(w, http.StatusBadRequest, "agent must be claude or codex")
		return
	case !extPluginIdRe.MatchString(req.Id):
		httpError(w, http.StatusBadRequest, "id must look like plugin@marketplace")
		return
	case req.Scope != "user" && req.Scope != "project" && req.Scope != "local":
		httpError(w, http.StatusBadRequest, "scope must be user, project or local")
		return
	case req.Scope != "user" && req.Cwd == "":
		httpError(w, http.StatusBadRequest, "project and local scope need a cwd")
		return
	case req.AcceptCommand != "" && !extShaRe.MatchString(req.AcceptCommand):
		httpError(w, http.StatusBadRequest, "acceptCommand must be the sha the install showed")
		return
	}
	if c := s.extDevice(w, r); c != nil {
		s.extChange(w, c, protocol.TypeExtInstall, req, extInstallWait)
	}
}

// GET /api/devices/{id}/extensions/catalog?agent=claude|codex[&q=]
func (s *Server) handleExtensionCatalog(w http.ResponseWriter, r *http.Request) {
	agent := r.URL.Query().Get("agent")
	if agent != "claude" && agent != "codex" {
		httpError(w, http.StatusBadRequest, "agent must be claude or codex")
		return
	}
	q := r.URL.Query().Get("q")
	if len(q) > 200 {
		q = q[:200]
	}
	c := s.extDevice(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(extCatalogWait)
	defer cancel()
	var res protocol.ExtCatalogResult
	if err := c.requestInto(ctx, protocol.TypeExtCatalog, protocol.ExtCatalogRequest{Agent: agent, Q: q}, &res); err != nil {
		extDeviceError(w, err)
		return
	}
	if res.Entries == nil {
		res.Entries = []protocol.ExtCatalogEntry{}
	}
	writeJSON(w, res)
}

func validSkillAgents(agents []string) bool {
	if len(agents) == 0 || len(agents) > 16 {
		return false
	}
	for _, a := range agents {
		if !extAgentRe.MatchString(a) {
			return false
		}
	}
	return true
}

// POST /api/devices/{id}/skills {name, description, body?, scope, cwd?, agents}
func (s *Server) handleCreateSkill(w http.ResponseWriter, r *http.Request) {
	var req protocol.SkillCreateRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request body")
		return
	}
	var ok bool
	if req.Cwd, ok = extCwd(req.Cwd); !ok {
		httpError(w, http.StatusBadRequest, "bad cwd")
		return
	}
	req.Name, req.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	switch {
	case len(req.Name) > 64 || !extSkillRe.MatchString(req.Name):
		httpError(w, http.StatusBadRequest, "name must be 1-64 lowercase letters, digits and single hyphens")
		return
	case req.Description == "" || len([]rune(req.Description)) > 1024:
		httpError(w, http.StatusBadRequest, "description must be 1-1024 characters")
		return
	case len(req.Body) > 256*1024:
		httpError(w, http.StatusBadRequest, "body is too large")
		return
	case req.Scope != "user" && req.Scope != "project":
		httpError(w, http.StatusBadRequest, "scope must be user or project")
		return
	case req.Scope == "project" && req.Cwd == "":
		httpError(w, http.StatusBadRequest, "project scope needs a cwd")
		return
	case !validSkillAgents(req.Agents):
		httpError(w, http.StatusBadRequest, "agents must list 1-16 agent ids")
		return
	}
	if c := s.extDevice(w, r); c != nil {
		s.extChange(w, c, protocol.TypeSkillCreate, req, extChangeWait)
	}
}

// POST /api/devices/{id}/skills/share {key, agents}
func (s *Server) handleShareSkill(w http.ResponseWriter, r *http.Request) {
	var req protocol.SkillShareRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request body")
		return
	}
	if !validExtKey(req.Key) || !validSkillAgents(req.Agents) {
		httpError(w, http.StatusBadRequest, "key and 1-16 agents are required")
		return
	}
	if c := s.extDevice(w, r); c != nil {
		s.extChange(w, c, protocol.TypeSkillShare, req, extChangeWait)
	}
}
