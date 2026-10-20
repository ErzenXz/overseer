package protocol

import (
	"math"
	"sort"
)

// Plan usage limits: the rolling subscription limits (Claude Code "5-hour" and
// weekly, Codex primary/secondary) each agent's CLI reports on a device. See
// "Plan usage limits" in docs/agent-sessions-api.md. Readings carry only the
// CLI's own numbers; credentials never leave the device.

const (
	// Hub -> agent request (carries Id); the reply data is UsageLimitsResult.
	TypeUsageLimits = "usage.limits"
	// Agent -> hub notification (no Id): a running session reported new
	// limits. Data is one PlanLimits with Source LimitsFromSession, holding
	// only the windows the event carried.
	TypeUsageLimitsUpdate = "usage.limits.update"
)

// Limit statuses.
const (
	LimitsOK      = "ok"
	LimitsWarning = "warning"
	LimitsLimited = "limited" // currently blocked
)

// Reading sources.
const (
	LimitsLive        = "live"    // asked the CLI now
	LimitsFromSession = "session" // seen in a running session's events
)

// Errors with a fixed meaning (the hub hides these unless ?all=1).
const (
	LimitsErrAPIKey    = "api key (no plan limits)"
	LimitsErrSignedOut = "not signed in"
)

// LimitsWarnPercent is the usage at which a window counts as a warning.
const LimitsWarnPercent = 80

// UsageLimitsRequest asks the device for limits. Empty Agents means every
// agent that can report them (claude, codex).
type UsageLimitsRequest struct {
	Agents []string `json:"agents,omitempty"`
}

// UsageLimitsResult is the reply to usage.limits and the body of
// GET /api/usage/limits. Agents that are not installed are left out.
type UsageLimitsResult struct {
	Accounts []PlanLimits `json:"accounts"`
}

// LimitWindow is one rolling limit.
type LimitWindow struct {
	Id            string  `json:"id"`
	Label         string  `json:"label"`
	UsedPercent   float64 `json:"usedPercent"`
	ResetsAt      int64   `json:"resetsAt,omitempty"`      // unix seconds
	WindowMinutes int64   `json:"windowMinutes,omitempty"` // window length
}

// PlanLimits is one agent's subscription limits on one device. DeviceId and
// DeviceName are filled in by the hub.
type PlanLimits struct {
	DeviceId   string        `json:"deviceId"`
	DeviceName string        `json:"deviceName"`
	Agent      string        `json:"agent"`
	Plan       string        `json:"plan"`
	Account    string        `json:"account"`
	Windows    []LimitWindow `json:"windows"`
	Status     string        `json:"status"`
	FetchedAt  int64         `json:"fetchedAt"`
	Source     string        `json:"source"`
	Error      string        `json:"error,omitempty"`
}

// RoundPercent keeps one decimal place.
func RoundPercent(p float64) float64 {
	return math.Round(p*10) / 10
}

// LimitsStatus derives a status from the windows: limited at or above 100 %,
// warning at or above LimitsWarnPercent.
func LimitsStatus(windows []LimitWindow) string {
	status := LimitsOK
	for _, w := range windows {
		switch {
		case w.UsedPercent >= 100:
			return LimitsLimited
		case w.UsedPercent >= LimitsWarnPercent:
			status = LimitsWarning
		}
	}
	return status
}

// WorseStatus returns the more severe of two statuses.
func WorseStatus(a, b string) string {
	rank := func(s string) int {
		switch s {
		case LimitsLimited:
			return 2
		case LimitsWarning:
			return 1
		}
		return 0
	}
	if rank(b) > rank(a) {
		return b
	}
	if a == "" {
		return LimitsOK
	}
	return a
}

// SortWindows orders windows shortest first (unknown lengths last), keeping
// the reported order among equals.
func SortWindows(windows []LimitWindow) {
	key := func(w LimitWindow) int64 {
		if w.WindowMinutes <= 0 {
			return math.MaxInt64
		}
		return w.WindowMinutes
	}
	sort.SliceStable(windows, func(i, j int) bool { return key(windows[i]) < key(windows[j]) })
}

// MergeLimits folds a (possibly partial) newer reading into an older one:
// windows are replaced by id and the others kept; plan and account are kept
// when the newer reading leaves them empty. The status is recomputed from the
// merged windows, but never less severe than the newer reading's own.
func MergeLimits(prev, next PlanLimits) PlanLimits {
	if prev.Agent == "" || (len(next.Windows) == 0 && next.Error != "") {
		return next
	}
	out := next
	if out.Plan == "" {
		out.Plan = prev.Plan
	}
	if out.Account == "" {
		out.Account = prev.Account
	}
	byId := map[string]int{}
	merged := make([]LimitWindow, 0, len(prev.Windows)+len(next.Windows))
	for _, w := range prev.Windows {
		byId[w.Id] = len(merged)
		merged = append(merged, w)
	}
	for _, w := range next.Windows {
		if i, ok := byId[w.Id]; ok {
			if w.Label == "" {
				w.Label = merged[i].Label
			}
			if w.WindowMinutes == 0 {
				w.WindowMinutes = merged[i].WindowMinutes
			}
			if w.ResetsAt == 0 {
				w.ResetsAt = merged[i].ResetsAt
			}
			merged[i] = w
			continue
		}
		byId[w.Id] = len(merged)
		merged = append(merged, w)
	}
	SortWindows(merged)
	out.Windows = merged
	out.Error = ""
	out.Status = WorseStatus(LimitsStatus(merged), next.Status)
	return out
}
