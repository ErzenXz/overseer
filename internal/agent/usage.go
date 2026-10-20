package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Plan usage limits (usage.limits): each subscription CLI's own report of its
// rolling limits, read without sending a prompt (no model usage):
//   - Claude Code: the stream-json control request `get_usage` (the data
//     behind /usage), plus `initialize` for the plan name and email.
//   - Codex: app-server `account/read` and `account/rateLimits/read`.
// Running sessions also report limits as they change (Claude
// `rate_limit_event` messages, Codex `account/rateLimits/updated`
// notifications); adapters forward those through reportLimits.
//
// Only the numbers below are ever sent to the hub. Credentials stay with the
// CLI: Overseer never reads token files or calls usage endpoints itself.

// usageLimitsBudget bounds one device-side read (the hub waits 4 s).
const usageLimitsBudget = 3500 * time.Millisecond

// usageAgents are the agents whose CLIs report plan limits.
var usageAgents = []string{"claude", "codex"}

// readUsageLimits reads limits for the requested agents (all by default) in
// parallel. Agents that are not installed are left out.
func readUsageLimits(req protocol.UsageLimitsRequest) protocol.UsageLimitsResult {
	agents := req.Agents
	if len(agents) == 0 {
		agents = usageAgents
	}
	ctx, cancel := context.WithTimeout(context.Background(), usageLimitsBudget)
	defer cancel()
	results := make([]*protocol.PlanLimits, len(agents))
	var wg sync.WaitGroup
	for i, agent := range agents {
		var read func(context.Context, string) protocol.PlanLimits
		switch agent {
		case "claude":
			read = readClaudeLimits
		case "codex":
			read = readCodexLimits
		default:
			continue // ACP agents have no limits protocol
		}
		path, err := lookAgentBinary(agent)
		if err != nil {
			continue
		}
		wg.Add(1)
		go func(i int, agent, path string) {
			defer wg.Done()
			l := read(ctx, path)
			l.Agent, l.Source = agent, protocol.LimitsLive
			if l.FetchedAt == 0 {
				l.FetchedAt = time.Now().Unix()
			}
			if l.Windows == nil {
				l.Windows = []protocol.LimitWindow{}
			}
			results[i] = &l
		}(i, agent, path)
	}
	wg.Wait()
	out := protocol.UsageLimitsResult{Accounts: []protocol.PlanLimits{}}
	for _, l := range results {
		if l != nil {
			out.Accounts = append(out.Accounts, *l)
		}
	}
	return out
}

func limitsError(err error) protocol.PlanLimits {
	msg := err.Error()
	if errors.Is(err, context.DeadlineExceeded) {
		msg = "timed out"
	}
	return protocol.PlanLimits{Error: msg, Status: protocol.LimitsOK}
}

// limitProbes tracks probe teardown still running (tests wait on it).
var limitProbes sync.WaitGroup

// stopProbe kills a probe process and removes its directory without making
// the caller wait for the process to be reaped.
func stopProbe(proc *agentProcess, cleanup func()) {
	limitProbes.Add(1)
	go func() {
		defer limitProbes.Done()
		proc.kill()
		cleanup()
	}()
}

// --- Claude Code ---

// claudeUsageArgs start a bare stream-json session for control requests only:
// no hooks, no MCP servers, nothing saved to the session history.
var claudeUsageArgs = []string{"--print", "--input-format", "stream-json", "--output-format", "stream-json",
	"--verbose", "--settings", `{"disableAllHooks":true}`, "--no-session-persistence",
	"--strict-mcp-config", "--mcp-config", `{"mcpServers":{}}`}

func readClaudeLimits(ctx context.Context, path string) protocol.PlanLimits {
	dir, cleanup, err := probeDir()
	if err != nil {
		return limitsError(err)
	}
	proc, err := startAgentProcess(path, claudeUsageArgs, dir, agentEnv())
	if err != nil {
		cleanup()
		return limitsError(err)
	}
	defer stopProbe(proc, cleanup)
	initCh, usageCh := make(chan jsonObj, 1), make(chan jsonObj, 1)
	proc.readLines(func(line []byte) {
		m := decodeObj(line)
		if jStr(m, "type") != "control_response" {
			return
		}
		r := jObj(m, "response")
		switch jStr(r, "request_id") {
		case "limits-init":
			select {
			case initCh <- r:
			default:
			}
		case "limits-usage":
			select {
			case usageCh <- r:
			default:
			}
		}
	})
	for _, req := range []map[string]any{
		{"type": "control_request", "request_id": "limits-init", "request": map[string]any{"subtype": "initialize"}},
		{"type": "control_request", "request_id": "limits-usage", "request": map[string]any{"subtype": "get_usage", "skip_behaviors": true}},
	} {
		if err := proc.writeJSON(req); err != nil {
			return limitsError(err)
		}
	}
	// get_usage is required; initialize only adds the plan name and email.
	var account, usageResp jsonObj
	gotInit := false
	for usageResp == nil || !gotInit {
		select {
		case r := <-initCh:
			account, gotInit = jObj(jObj(r, "response"), "account"), true
		case r := <-usageCh:
			if jStr(r, "subtype") == "error" {
				msg := jStr(r, "error")
				if strings.Contains(msg, "Unsupported control request") {
					msg = "this Claude Code version does not report plan limits; update it"
				}
				return limitsError(fmt.Errorf("claude: %s", msg))
			}
			usageResp = jObj(r, "response")
		case <-proc.done:
			return limitsError(errors.New(oneLine(proc.exitError())))
		case <-ctx.Done():
			if usageResp != nil {
				return claudeLimitsFrom(usageResp, account)
			}
			return limitsError(ctx.Err())
		}
	}
	return claudeLimitsFrom(usageResp, account)
}

// oneLine flattens a process error (with its stderr tail) for the UI.
func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

// claudeWindows are the get_usage rate_limits keys shown as windows, in order.
var claudeWindows = []struct {
	key, label string
	minutes    int64
}{
	{"five_hour", "5-hour", 300},
	{"seven_day", "Weekly", 7 * 24 * 60},
	{"seven_day_opus", "Weekly (Opus)", 7 * 24 * 60},
	{"seven_day_sonnet", "Weekly (Sonnet)", 7 * 24 * 60},
	{"seven_day_oauth_apps", "Weekly (apps)", 7 * 24 * 60},
}

func claudeWindowInfo(key string) (string, int64, bool) {
	for _, w := range claudeWindows {
		if w.key == key {
			return w.label, w.minutes, true
		}
	}
	return "", 0, false
}

// parseResetTime reads unix seconds or an ISO 8601 timestamp.
func parseResetTime(v any) int64 {
	switch t := v.(type) {
	case float64:
		if t > 1e12 { // milliseconds
			return int64(t / 1000)
		}
		return int64(t)
	case string:
		if ts, err := time.Parse(time.RFC3339Nano, t); err == nil {
			return ts.Unix()
		}
	}
	return 0
}

// claudePlanLabel turns "Claude Max" / "max" into "Max".
func claudePlanLabel(account jsonObj, subscription string) string {
	if s := strings.TrimSpace(jStr(account, "subscriptionType")); s != "" {
		return strings.TrimSpace(strings.TrimPrefix(s, "Claude "))
	}
	return titleWords(subscription)
}

// titleWords turns "edu_plus" into "Edu Plus".
func titleWords(s string) string {
	words := strings.FieldsFunc(s, func(r rune) bool { return r == '_' || r == '-' || r == ' ' })
	for i, w := range words {
		r := []rune(w)
		r[0] = unicode.ToUpper(r[0])
		words[i] = string(r)
	}
	return strings.Join(words, " ")
}

// claudeLimitsFrom maps a get_usage response (and the initialize account)
// onto PlanLimits.
func claudeLimitsFrom(resp, account jsonObj) protocol.PlanLimits {
	subscription := jStr(resp, "subscription_type")
	l := protocol.PlanLimits{
		Plan:    claudePlanLabel(account, subscription),
		Account: jStr(account, "email"),
		Status:  protocol.LimitsOK,
		Windows: []protocol.LimitWindow{},
	}
	limits := jObj(resp, "rate_limits")
	if available, ok := resp["rate_limits_available"].(bool); (ok && !available) || len(limits) == 0 {
		provider := jStr(account, "apiProvider")
		switch {
		case provider != "" && provider != "firstParty",
			jStr(account, "apiKeySource") != "" && subscription == "",
			subscription == "" && jStr(account, "email") != "":
			l.Error = protocol.LimitsErrAPIKey
		case subscription == "" && len(account) == 0 && os.Getenv("ANTHROPIC_API_KEY") != "":
			l.Error = protocol.LimitsErrAPIKey
		case subscription == "":
			l.Error = protocol.LimitsErrSignedOut
		default:
			l.Error = "plan limits unavailable"
		}
		return l
	}
	locked := false
	seen := map[string]bool{}
	add := func(id, label string, minutes int64, w jsonObj) {
		used, ok := jNum(w, "utilization")
		if !ok || seen[id] {
			return
		}
		seen[id] = true
		if w["locked_reason"] != nil {
			locked = true
		}
		l.Windows = append(l.Windows, protocol.LimitWindow{Id: id, Label: label, UsedPercent: protocol.RoundPercent(used),
			ResetsAt: parseResetTime(w["resets_at"]), WindowMinutes: minutes})
	}
	for _, cw := range claudeWindows {
		add(cw.key, cw.label, cw.minutes, jObj(limits, cw.key))
	}
	for _, x := range jArr(limits, "model_scoped") {
		m, ok := x.(map[string]any)
		name := jStr(m, "display_name")
		if !ok || name == "" {
			continue
		}
		add("seven_day_"+strings.ToLower(strings.ReplaceAll(name, " ", "_")), "Weekly ("+name+")", 7*24*60, m)
	}
	protocol.SortWindows(l.Windows)
	l.Status = protocol.LimitsStatus(l.Windows)
	if locked {
		l.Status = protocol.LimitsLimited
	}
	return l
}

// claudeLimitsEvent maps a stream-json rate_limit_event onto a partial
// reading. utilization there is a fraction (0-1); unifiedWindows, when
// present, carries the 5-hour and weekly windows on every event.
func claudeLimitsEvent(m jsonObj) (protocol.PlanLimits, bool) {
	info := jObj(m, "rate_limit_info")
	if len(info) == 0 {
		return protocol.PlanLimits{}, false
	}
	l := protocol.PlanLimits{Agent: "claude", Source: protocol.LimitsFromSession, FetchedAt: time.Now().Unix(),
		Windows: []protocol.LimitWindow{}}
	seen := map[string]bool{}
	add := func(key string, used float64, resets any) {
		label, minutes, ok := claudeWindowInfo(key)
		if !ok || seen[key] {
			return
		}
		seen[key] = true
		l.Windows = append(l.Windows, protocol.LimitWindow{Id: key, Label: label, UsedPercent: protocol.RoundPercent(used * 100),
			ResetsAt: parseResetTime(resets), WindowMinutes: minutes})
	}
	unified := jObj(info, "unifiedWindows")
	for _, key := range []string{"five_hour", "seven_day"} {
		w := jObj(unified, key)
		if used, ok := jNum(w, "utilization"); ok {
			add(key, used, w["resetsAt"])
		}
	}
	if used, ok := jNum(info, "utilization"); ok {
		add(jStr(info, "rateLimitType"), used, info["resetsAt"])
	}
	protocol.SortWindows(l.Windows)
	l.Status = protocol.LimitsStatus(l.Windows)
	switch jStr(info, "status") {
	case "rejected":
		l.Status = protocol.LimitsLimited
	case "allowed_warning":
		l.Status = protocol.WorseStatus(l.Status, protocol.LimitsWarning)
	}
	if len(l.Windows) == 0 && l.Status == protocol.LimitsOK {
		return l, false // nothing worth reporting
	}
	return l, true
}

// --- Codex ---

func readCodexLimits(ctx context.Context, path string) protocol.PlanLimits {
	dir, cleanup, err := probeDir()
	if err != nil {
		return limitsError(err)
	}
	proc, err := startAgentProcess(path, []string{"app-server"}, dir, agentEnv())
	if err != nil {
		cleanup()
		return limitsError(err)
	}
	defer stopProbe(proc, cleanup)
	rpc := newRPCConn(false)
	rpc.proc = proc
	proc.readLines(rpc.handleLine)
	go func() { <-proc.done; rpc.shutdown() }()

	if err := rpc.call(ctx, "initialize", map[string]any{
		"clientInfo":   map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		return limitsError(err)
	}
	if err := rpc.notify("initialized", nil); err != nil {
		return limitsError(err)
	}
	var account, limits json.RawMessage
	var limitsErr error
	done := make(chan struct{})
	go func() {
		limitsErr = rpc.call(ctx, "account/rateLimits/read", map[string]any{"excludeResetCreditDetails": true}, &limits)
		close(done)
	}()
	accountErr := rpc.call(ctx, "account/read", map[string]any{}, &account)
	<-done
	return codexLimitsFrom(account, accountErr, limits, limitsErr)
}

// codexPlanLabels names Codex plan types; others are title-cased.
var codexPlanLabels = map[string]string{
	"prolite": "Pro Lite", "promax": "Pro Max", "edu": "Edu", "ent26": "Enterprise",
	"self_serve_business_prolite": "Business", "self_serve_business_usage_based": "Business",
	"enterprise_cbp_automation": "Enterprise", "enterprise_cbp_usage_based": "Enterprise",
}

func codexPlanLabel(plan string) string {
	if plan == "" || plan == "unknown" {
		return ""
	}
	if l, ok := codexPlanLabels[plan]; ok {
		return l
	}
	return titleWords(plan)
}

// durationLabel names a window length: "5-hour", "Weekly", "Daily", ...
func durationLabel(minutes int64) string {
	switch {
	case minutes <= 0:
		return ""
	case minutes == 7*24*60:
		return "Weekly"
	case minutes == 24*60:
		return "Daily"
	case minutes >= 28*24*60 && minutes <= 31*24*60:
		return "Monthly"
	case minutes%(24*60) == 0:
		return fmt.Sprintf("%d-day", minutes/(24*60))
	case minutes%60 == 0:
		return fmt.Sprintf("%d-hour", minutes/60)
	}
	return fmt.Sprintf("%d-minute", minutes)
}

// codexSnapshotWindows reads the primary/secondary windows of one
// RateLimitSnapshot. Buckets other than the main "codex" one get prefixed
// ids and a labelled suffix.
func codexSnapshotWindows(snap jsonObj) []protocol.LimitWindow {
	limitId := jStr(snap, "limitId")
	prefix, suffix := "", ""
	if limitId != "" && limitId != "codex" {
		prefix = limitId + "."
		name := jStr(snap, "limitName")
		if name == "" {
			name = limitId
		}
		suffix = " (" + name + ")"
	}
	var out []protocol.LimitWindow
	for _, slot := range []string{"primary", "secondary"} {
		w := jObj(snap, slot)
		used, ok := jNum(w, "usedPercent")
		if !ok {
			continue
		}
		minutes, _ := jNum(w, "windowDurationMins")
		label := durationLabel(int64(minutes))
		if label == "" {
			label = titleWords(slot)
		}
		out = append(out, protocol.LimitWindow{Id: prefix + slot, Label: label + suffix,
			UsedPercent: protocol.RoundPercent(used), ResetsAt: parseResetTime(w["resetsAt"]), WindowMinutes: int64(minutes)})
	}
	return out
}

func codexSnapshotBlocked(snap jsonObj) bool {
	return jStr(snap, "rateLimitReachedType") != ""
}

// codexLimitsFrom maps account/read and account/rateLimits/read onto
// PlanLimits.
func codexLimitsFrom(accountRaw json.RawMessage, accountErr error, limitsRaw json.RawMessage, limitsErr error) protocol.PlanLimits {
	l := protocol.PlanLimits{Status: protocol.LimitsOK, Windows: []protocol.LimitWindow{}}
	if accountErr == nil {
		acct := jObj(decodeObj(accountRaw), "account")
		switch jStr(acct, "type") {
		case "":
			l.Error = protocol.LimitsErrSignedOut
			return l
		case "chatgpt":
			l.Account = jStr(acct, "email")
			l.Plan = codexPlanLabel(jStr(acct, "planType"))
		default: // apiKey, amazonBedrock, ...
			l.Error = protocol.LimitsErrAPIKey
			return l
		}
	}
	if limitsErr != nil {
		return protocol.PlanLimits{Plan: l.Plan, Account: l.Account, Status: protocol.LimitsOK,
			Windows: []protocol.LimitWindow{}, Error: limitsError(limitsErr).Error}
	}
	r := decodeObj(limitsRaw)
	main := jObj(r, "rateLimits")
	buckets := jObj(r, "rateLimitsByLimitId")
	blocked := codexSnapshotBlocked(main)
	if len(buckets) > 0 {
		ids := make([]string, 0, len(buckets))
		for id := range buckets {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { // the main bucket first
			if (ids[i] == "codex") != (ids[j] == "codex") {
				return ids[i] == "codex"
			}
			return ids[i] < ids[j]
		})
		for _, id := range ids {
			snap := jObj(buckets, id)
			if jStr(snap, "limitId") == "" {
				snap["limitId"] = id
			}
			l.Windows = append(l.Windows, codexSnapshotWindows(snap)...)
			blocked = blocked || codexSnapshotBlocked(snap)
		}
	} else {
		l.Windows = append(l.Windows, codexSnapshotWindows(main)...)
	}
	if l.Plan == "" {
		l.Plan = codexPlanLabel(jStr(main, "planType"))
	}
	protocol.SortWindows(l.Windows)
	l.Status = protocol.LimitsStatus(l.Windows)
	if allowed, ok := r["ordinaryUsageAllowed"].(bool); blocked || (ok && !allowed) {
		l.Status = protocol.LimitsLimited
	}
	return l
}

// codexLimitsEvent maps an account/rateLimits/updated notification (a sparse
// snapshot) onto a partial reading.
func codexLimitsEvent(params json.RawMessage) (protocol.PlanLimits, bool) {
	snap := jObj(decodeObj(params), "rateLimits")
	if len(snap) == 0 {
		return protocol.PlanLimits{}, false
	}
	l := protocol.PlanLimits{Agent: "codex", Source: protocol.LimitsFromSession, FetchedAt: time.Now().Unix(),
		Plan: codexPlanLabel(jStr(snap, "planType")), Windows: codexSnapshotWindows(snap)}
	if l.Windows == nil {
		l.Windows = []protocol.LimitWindow{}
	}
	protocol.SortWindows(l.Windows)
	l.Status = protocol.LimitsStatus(l.Windows)
	if codexSnapshotBlocked(snap) {
		l.Status = protocol.LimitsLimited
	}
	if len(l.Windows) == 0 && l.Status == protocol.LimitsOK {
		return l, false
	}
	return l, true
}

// --- forwarding session readings ---

// limitsSink is implemented by sinks that forward limit readings (hubSink).
type limitsSink interface {
	limits(l protocol.PlanLimits)
}

// reportLimits hands a session reading to the sink, if it takes them.
func reportLimits(s threadSink, l protocol.PlanLimits) {
	if ls, ok := s.(limitsSink); ok {
		ls.limits(l)
	}
}

func (s hubSink) limits(l protocol.PlanLimits) {
	s.a.sendLimits(l)
}

// sendLimits forwards a session reading to the hub, skipping repeats of the
// last one sent for the same agent.
func (a *Agent) sendLimits(l protocol.PlanLimits) {
	key := l
	key.FetchedAt = 0
	b, _ := json.Marshal(key)
	a.limitsMu.Lock()
	if a.lastLimits == nil {
		a.lastLimits = map[string]string{}
	}
	if a.lastLimits[l.Agent] == string(b) {
		a.limitsMu.Unlock()
		return
	}
	a.lastLimits[l.Agent] = string(b)
	a.limitsMu.Unlock()
	if m, err := protocol.NewMsg(protocol.TypeUsageLimitsUpdate, 0, 0, l); err == nil {
		a.send(m)
	}
}
