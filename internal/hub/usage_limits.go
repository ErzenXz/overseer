package hub

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Plan usage limits: each device reads its subscription CLIs' rolling limits
// (usage.limits, no prompt sent) and pushes readings seen during sessions
// (usage.limits.update). The hub caches them per device+agent. See "Plan
// usage limits" in docs/agent-sessions-api.md.

const (
	usageLimitsTTL = 5 * time.Minute
	// usageLimitsWait bounds one device read; devices are asked in parallel.
	usageLimitsWait = 4 * time.Second
	// usageLimitsKeep is how long a reading outlives its device going
	// offline (or failing to answer) before it is no longer listed.
	usageLimitsKeep = 24 * time.Hour
)

// usageLimitAgents are the agents whose CLIs report plan limits.
var usageLimitAgents = []string{"claude", "codex"}

// usageEntry is what the hub knows about one agent on one device.
type usageEntry struct {
	limits  protocol.PlanLimits // Agent == "" when there is no reading
	checked time.Time           // when the device was last asked about this agent
}

type usageLimitsCache struct {
	mu       sync.Mutex
	devices  map[string]map[string]*usageEntry // deviceId -> agent -> entry
	inflight map[string]chan struct{}          // deviceId -> closed when its read ends
}

func newUsageLimitsCache() *usageLimitsCache {
	return &usageLimitsCache{devices: map[string]map[string]*usageEntry{}, inflight: map[string]chan struct{}{}}
}

// entry returns (creating) the entry for deviceId+agent. Callers hold mu.
func (c *usageLimitsCache) entry(deviceId, agent string) *usageEntry {
	d := c.devices[deviceId]
	if d == nil {
		d = map[string]*usageEntry{}
		c.devices[deviceId] = d
	}
	e := d[agent]
	if e == nil {
		e = &usageEntry{}
		d[agent] = e
	}
	return e
}

// stale lists the agents on deviceId that need asking.
func (c *usageLimitsCache) stale(deviceId string, refresh bool, now time.Time) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for _, agent := range usageLimitAgents {
		e := c.devices[deviceId][agent]
		if refresh || e == nil || now.Sub(e.checked) >= usageLimitsTTL {
			out = append(out, agent)
		}
	}
	return out
}

// usageLimitsFatal reports errors that mean the agent has no plan limits to
// show, as opposed to a failed read.
func usageLimitsFatal(err string) bool {
	return err == protocol.LimitsErrAPIKey || err == protocol.LimitsErrSignedOut
}

// store records a device's answer for the agents it was asked about. Agents
// missing from the answer are not installed. A failed read keeps a recent
// reading (numbers, or a definite "api key" / "not signed in") rather than
// replacing it with the error.
func (c *usageLimitsCache) store(deviceId string, asked []string, got []protocol.PlanLimits, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	byAgent := map[string]protocol.PlanLimits{}
	for _, l := range got {
		byAgent[l.Agent] = l
	}
	for _, agent := range asked {
		e := c.entry(deviceId, agent)
		e.checked = now
		l, ok := byAgent[agent]
		switch {
		case !ok:
			e.limits = protocol.PlanLimits{}
		case l.Error != "" && !usageLimitsFatal(l.Error) && e.limits.Agent != "" &&
			(e.limits.Error == "" || usageLimitsFatal(e.limits.Error)) &&
			now.Sub(time.Unix(e.limits.FetchedAt, 0)) < usageLimitsKeep:
			// keep the previous reading; its fetchedAt shows its age
		default:
			e.limits = l
		}
	}
}

// failed marks a device read that got no answer at all: readings are kept,
// and the agents are not asked again until the TTL passes.
func (c *usageLimitsCache) failed(deviceId string, asked []string, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, agent := range asked {
		c.entry(deviceId, agent).checked = now
	}
}

// update merges a session reading into the cache.
func (c *usageLimitsCache) update(deviceId string, l protocol.PlanLimits) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.entry(deviceId, l.Agent)
	e.limits = protocol.MergeLimits(e.limits, l)
}

// readings returns the cached readings for deviceId.
func (c *usageLimitsCache) readings(deviceId string) []protocol.PlanLimits {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []protocol.PlanLimits
	for _, agent := range usageLimitAgents {
		if e := c.devices[deviceId][agent]; e != nil && e.limits.Agent != "" {
			l := e.limits
			l.Windows = append([]protocol.LimitWindow{}, l.Windows...)
			out = append(out, l)
		}
	}
	return out
}

// begin claims the device's read slot. When another read is running it
// returns that read's done channel and false.
func (c *usageLimitsCache) begin(deviceId string) (chan struct{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ch := c.inflight[deviceId]; ch != nil {
		return ch, false
	}
	ch := make(chan struct{})
	c.inflight[deviceId] = ch
	return ch, true
}

func (c *usageLimitsCache) end(deviceId string, ch chan struct{}) {
	c.mu.Lock()
	delete(c.inflight, deviceId)
	c.mu.Unlock()
	close(ch)
}

// readDeviceLimits asks one online device about its stale agents (all of
// them with refresh). Concurrent callers share one read.
func (s *Server) readDeviceLimits(c *agentConn, refresh bool) {
	asked := s.usageLimits.stale(c.deviceId, refresh, time.Now())
	if len(asked) == 0 {
		return
	}
	ch, mine := s.usageLimits.begin(c.deviceId)
	if !mine {
		select {
		case <-ch:
		case <-time.After(usageLimitsWait):
		}
		return
	}
	defer s.usageLimits.end(c.deviceId, ch)
	ctx, cancel := context.WithTimeout(context.Background(), usageLimitsWait)
	defer cancel()
	var res protocol.UsageLimitsResult
	if err := c.requestInto(ctx, protocol.TypeUsageLimits, protocol.UsageLimitsRequest{Agents: asked}, &res); err != nil {
		s.usageLimits.failed(c.deviceId, asked, time.Now())
		return
	}
	for i := range res.Accounts {
		res.Accounts[i].Source = protocol.LimitsLive
	}
	s.usageLimits.store(c.deviceId, asked, res.Accounts, time.Now())
}

// planLimits returns every device's readings, asking online devices (in
// parallel) whose readings are stale. all keeps API-key and signed-out
// entries.
func (s *Server) planLimits(refresh, all bool) ([]protocol.PlanLimits, error) {
	devices, err := s.store.ListDevices()
	if err != nil {
		return nil, err
	}
	var wg sync.WaitGroup
	for _, d := range devices {
		if c := s.registry.get(d.Id); c != nil {
			wg.Add(1)
			go func() {
				defer wg.Done()
				s.readDeviceLimits(c, refresh)
			}()
		}
	}
	wg.Wait()
	now := time.Now()
	out := []protocol.PlanLimits{}
	for _, d := range devices {
		online := s.registry.get(d.Id) != nil
		for _, l := range s.usageLimits.readings(d.Id) {
			if !all && usageLimitsFatal(l.Error) {
				continue
			}
			if !online && now.Sub(time.Unix(l.FetchedAt, 0)) >= usageLimitsKeep {
				continue
			}
			l.DeviceId, l.DeviceName = d.Id, d.Name
			if l.Windows == nil {
				l.Windows = []protocol.LimitWindow{}
			}
			if l.Status == "" {
				l.Status = protocol.LimitsOK
			}
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if a, b := strings.ToLower(out[i].DeviceName), strings.ToLower(out[j].DeviceName); a != b {
			return a < b
		}
		if out[i].DeviceId != out[j].DeviceId {
			return out[i].DeviceId < out[j].DeviceId
		}
		return out[i].Agent < out[j].Agent
	})
	return out, nil
}

// onUsageLimitsUpdate stores a reading a device saw during a session and
// tells browsers.
func (s *Server) onUsageLimitsUpdate(deviceId string, l protocol.PlanLimits) {
	if !validUsageAgent(l.Agent) {
		return
	}
	l.Source = protocol.LimitsFromSession
	if l.FetchedAt == 0 {
		l.FetchedAt = time.Now().Unix()
	}
	s.usageLimits.update(deviceId, l)
	s.events.publish(event{Type: "usage.limits", DeviceId: deviceId, Agent: l.Agent})
}

func validUsageAgent(agent string) bool {
	for _, a := range usageLimitAgents {
		if a == agent {
			return true
		}
	}
	return false
}

// handleUsageLimits serves GET /api/usage/limits[?refresh=1][&all=1].
func (s *Server) handleUsageLimits(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	flag := func(name string) bool { v := q.Get(name); return v == "1" || v == "true" }
	accounts, err := s.planLimits(flag("refresh"), flag("all"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, protocol.UsageLimitsResult{Accounts: accounts})
}
