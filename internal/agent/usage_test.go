package agent

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Fixtures captured from the real CLIs (Claude Code 2.1.285, codex-cli
// 0.161.0) without sending a prompt; emails, ids and organisation names are
// scrubbed, and a few SECRET-* values are planted in fields that must never
// reach the hub.

// Claude: initialize response "account" object.
const claudeInitAccountFixture = `{"email":"you@example.com","organization":"SECRET-ORG","subscriptionType":"Claude Team","apiProvider":"firstParty","tokenSource":"SECRET-TOKEN-SOURCE"}`

// Claude: control_response.response of {"subtype":"get_usage","skip_behaviors":true}.
const claudeGetUsageFixture = `{"session":{"total_cost_usd":0,"total_api_duration_ms":0,"total_duration_ms":4481,"total_lines_added":0,"total_lines_removed":0,"model_usage":{}},
"subscription_type":"team","rate_limits_available":true,
"rate_limits":{"five_hour":{"utilization":9,"resets_at":"2026-10-20T16:19:59.829605+00:00","limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
"seven_day":{"utilization":67,"resets_at":"2026-10-23T00:59:59.829627+00:00","limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
"seven_day_oauth_apps":null,"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_cowork":null,"tangelo":null,
"extra_usage":{"is_enabled":false,"monthly_limit":null,"used_credits":null,"utilization":null,"currency":"USD","decimal_places":2,"disabled_reason":"out_of_credits"},
"limits":[{"kind":"session","group":"session","percent":9,"severity":"normal","resets_at":"2026-10-20T16:19:59.829605+00:00","scope":null,"is_active":false},
{"kind":"weekly_all","group":"weekly","percent":67,"severity":"normal","resets_at":"2026-10-23T00:59:59.829627+00:00","scope":null,"is_active":true},
{"kind":"weekly_scoped","group":"weekly","percent":0,"severity":"normal","resets_at":"2026-10-23T01:00:00+00:00","scope":{"model":{"id":null,"display_name":"Fable"},"surface":null},"is_active":false}],
"spend":{"used":{"amount_minor":0,"currency":"USD","exponent":2},"limit":null,"percent":0,"severity":"normal","enabled":false,"balance":"SECRET-BALANCE"},
"weekly_scoped_shares":[{"limit_index":2,"used_percent_of_weekly":0,"allowance_percent_of_weekly":50}],
"model_scoped":[{"display_name":"Fable","utilization":0,"resets_at":"2026-10-23T01:00:00+00:00"}]},"behaviors":null}`

// Claude: a stream-json rate_limit_event. Built from the CLI's own message
// schema (seeing a live one needs a prompt, which these tests never send).
const claudeRateLimitEventFixture = `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1792512000,"rateLimitType":"seven_day","utilization":0.84,
"unifiedWindows":{"five_hour":{"utilization":0.234,"resetsAt":1792505000},"seven_day":{"utilization":0.84,"resetsAt":1792512000}}},"uuid":"00000000-0000-0000-0000-000000000000","session_id":"00000000-0000-0000-0000-000000000001"}`

// Codex: account/read result.
const codexAccountFixture = `{"account":{"type":"chatgpt","email":"you@example.com","planType":"pro"},"requiresOpenaiAuth":true,
"workspaceRouting":{"chatgptAccountId":"SECRET-ACCOUNT-ID","backendOrigin":"https://chatgpt.com","accountRoutingOverride":"NO_CONSTRAINT"}}`

// Codex: account/rateLimits/read result (a Pro plan reports one weekly
// window as "primary").
const codexRateLimitsFixture = `{"ordinaryUsageAllowed":true,
"rateLimits":{"limitId":"codex","limitName":null,"normalModelSlug":null,"primary":{"usedPercent":11,"windowDurationMins":10080,"resetsAt":1793082890},"secondary":null,"credits":{"hasCredits":true,"unlimited":false,"balance":"SECRET-BALANCE"},"individualLimit":null,"spendControlReached":false,"planType":"pro","rateLimitReachedType":null},
"rateLimitsByLimitId":{"codex":{"limitId":"codex","limitName":null,"normalModelSlug":null,"primary":{"usedPercent":11,"windowDurationMins":10080,"resetsAt":1793082890},"secondary":null,"credits":{"hasCredits":true,"unlimited":false,"balance":"SECRET-BALANCE"},"individualLimit":null,"spendControlReached":false,"planType":"pro","rateLimitReachedType":null}},
"rateLimitResetCredits":{"availableCount":2,"credits":null},"accountId":"SECRET-ACCOUNT-ID","rateLimitUpsell":null}`

// Codex: account/rateLimits/updated params (sparse, from the app-server
// schema's AccountRateLimitsUpdatedNotification).
const codexRateLimitsUpdatedFixture = `{"rateLimits":{"limitId":"codex","limitName":null,"primary":{"usedPercent":27,"windowDurationMins":300,"resetsAt":1792505000},"secondary":null,
"credits":{"hasCredits":true,"unlimited":false,"balance":"SECRET-BALANCE"},"planType":"plus","rateLimitReachedType":null}}`

// secretMarkers must never appear in anything sent to the hub.
var secretMarkers = []string{"SECRET", "balance", "accountId", "organization", "token", "Token"}

func assertNoSecrets(t *testing.T, what string, v any) {
	t.Helper()
	m, err := protocol.NewMsg(protocol.TypeResult, 1, 0, v)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(m)
	for _, s := range secretMarkers {
		if strings.Contains(string(b), s) {
			t.Errorf("%s: hub-bound message contains %q: %s", what, s, b)
		}
	}
}

func TestClaudeLimitsFromGetUsage(t *testing.T) {
	l := claudeLimitsFrom(decodeObj(json.RawMessage(claudeGetUsageFixture)), decodeObj(json.RawMessage(claudeInitAccountFixture)))
	if l.Error != "" || l.Plan != "Team" || l.Account != "you@example.com" || l.Status != protocol.LimitsOK {
		t.Fatalf("limits = %+v", l)
	}
	want := []protocol.LimitWindow{
		{Id: "five_hour", Label: "5-hour", UsedPercent: 9, ResetsAt: 1792513199, WindowMinutes: 300},
		{Id: "seven_day", Label: "Weekly", UsedPercent: 67, ResetsAt: 1792717199, WindowMinutes: 10080},
		{Id: "seven_day_fable", Label: "Weekly (Fable)", UsedPercent: 0, ResetsAt: 1792717200, WindowMinutes: 10080},
	}
	if fmt.Sprint(l.Windows) != fmt.Sprint(want) {
		t.Errorf("windows =\n%+v\nwant\n%+v", l.Windows, want)
	}
	assertNoSecrets(t, "claude get_usage", l)

	// No initialize answer: the plan comes from subscription_type.
	if l := claudeLimitsFrom(decodeObj(json.RawMessage(claudeGetUsageFixture)), nil); l.Plan != "Team" || l.Account != "" {
		t.Errorf("without account: %+v", l)
	}

	// A locked window or one at 100 % means limited; 80 % warns.
	locked := decodeObj(json.RawMessage(`{"subscription_type":"max","rate_limits_available":true,"rate_limits":{
		"five_hour":{"utilization":42,"resets_at":null,"locked_reason":"usage_limit"},"seven_day_opus":{"utilization":12.345,"resets_at":"2026-10-23T01:00:00Z"}}}`))
	if l := claudeLimitsFrom(locked, nil); l.Status != protocol.LimitsLimited || len(l.Windows) != 2 ||
		l.Windows[1].Label != "Weekly (Opus)" || l.Windows[1].UsedPercent != 12.3 || l.Windows[0].ResetsAt != 0 || l.Plan != "Max" {
		t.Errorf("locked: %+v", l)
	}
	warn := decodeObj(json.RawMessage(`{"subscription_type":"pro","rate_limits_available":true,"rate_limits":{"seven_day":{"utilization":85,"resets_at":null}}}`))
	if l := claudeLimitsFrom(warn, nil); l.Status != protocol.LimitsWarning {
		t.Errorf("warning: %+v", l)
	}
}

func TestClaudeLimitsUnavailable(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	none := decodeObj(json.RawMessage(`{"subscription_type":null,"rate_limits_available":false,"rate_limits":null}`))
	cases := []struct {
		name, account, want string
	}{
		{"api key", `{"apiKeySource":"ANTHROPIC_API_KEY","apiProvider":"firstParty"}`, protocol.LimitsErrAPIKey},
		{"bedrock", `{"apiProvider":"bedrock"}`, protocol.LimitsErrAPIKey},
		{"console login", `{"email":"you@example.com","apiProvider":"firstParty"}`, protocol.LimitsErrAPIKey},
		{"signed out", `{}`, protocol.LimitsErrSignedOut},
	}
	for _, c := range cases {
		if l := claudeLimitsFrom(none, decodeObj(json.RawMessage(c.account))); l.Error != c.want || len(l.Windows) != 0 {
			t.Errorf("%s: %+v", c.name, l)
		}
	}
	t.Setenv("ANTHROPIC_API_KEY", "sk-test")
	if l := claudeLimitsFrom(none, nil); l.Error != protocol.LimitsErrAPIKey {
		t.Errorf("env api key: %+v", l)
	}
	assertNoSecrets(t, "env api key", claudeLimitsFrom(none, nil))
}

func TestClaudeRateLimitEvent(t *testing.T) {
	l, ok := claudeLimitsEvent(decodeObj(json.RawMessage(claudeRateLimitEventFixture)))
	if !ok || l.Agent != "claude" || l.Source != protocol.LimitsFromSession || l.Status != protocol.LimitsWarning || l.FetchedAt == 0 {
		t.Fatalf("event = %+v, %v", l, ok)
	}
	want := []protocol.LimitWindow{
		{Id: "five_hour", Label: "5-hour", UsedPercent: 23.4, ResetsAt: 1792505000, WindowMinutes: 300},
		{Id: "seven_day", Label: "Weekly", UsedPercent: 84, ResetsAt: 1792512000, WindowMinutes: 10080},
	}
	if fmt.Sprint(l.Windows) != fmt.Sprint(want) {
		t.Errorf("windows = %+v", l.Windows)
	}
	// Older events carry only the limiting window; a rejection is limited
	// even without numbers.
	l, ok = claudeLimitsEvent(decodeObj(json.RawMessage(`{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"seven_day_opus","utilization":0.5,"resetsAt":1792512000}}`)))
	if !ok || len(l.Windows) != 1 || l.Windows[0].Id != "seven_day_opus" || l.Windows[0].UsedPercent != 50 {
		t.Errorf("single window: %+v %v", l, ok)
	}
	l, ok = claudeLimitsEvent(decodeObj(json.RawMessage(`{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour","resetsAt":1792505000}}`)))
	if !ok || l.Status != protocol.LimitsLimited || len(l.Windows) != 0 {
		t.Errorf("rejected: %+v %v", l, ok)
	}
	if _, ok := claudeLimitsEvent(decodeObj(json.RawMessage(`{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}`))); ok {
		t.Error("an event without numbers should not be reported")
	}
	if _, ok := claudeLimitsEvent(decodeObj(json.RawMessage(`{"type":"rate_limit_event"}`))); ok {
		t.Error("an event without info should not be reported")
	}
}

func TestCodexLimitsFrom(t *testing.T) {
	l := codexLimitsFrom(json.RawMessage(codexAccountFixture), nil, json.RawMessage(codexRateLimitsFixture), nil)
	want := []protocol.LimitWindow{{Id: "primary", Label: "Weekly", UsedPercent: 11, ResetsAt: 1793082890, WindowMinutes: 10080}}
	if l.Error != "" || l.Plan != "Pro" || l.Account != "you@example.com" || l.Status != protocol.LimitsOK || fmt.Sprint(l.Windows) != fmt.Sprint(want) {
		t.Fatalf("limits = %+v", l)
	}
	assertNoSecrets(t, "codex read", l)

	// Two windows plus a second metered bucket; a reached limit is limited.
	multi := `{"ordinaryUsageAllowed":true,"rateLimits":{"limitId":"codex","primary":{"usedPercent":40,"windowDurationMins":300,"resetsAt":1792505000},"secondary":{"usedPercent":20,"windowDurationMins":10080,"resetsAt":1792900000},"planType":"plus"},
	"rateLimitsByLimitId":{"codex_spark":{"limitId":"codex_spark","limitName":"Spark","primary":{"usedPercent":100,"windowDurationMins":300},"rateLimitReachedType":"rate_limit_reached"},
	"codex":{"limitId":"codex","primary":{"usedPercent":40,"windowDurationMins":300,"resetsAt":1792505000},"secondary":{"usedPercent":20,"windowDurationMins":10080,"resetsAt":1792900000},"planType":"plus"}}}`
	l = codexLimitsFrom(nil, errors.New("account/read: method not found"), json.RawMessage(multi), nil)
	var got []string
	for _, w := range l.Windows {
		got = append(got, w.Id+"="+w.Label)
	}
	if l.Plan != "Plus" || l.Status != protocol.LimitsLimited ||
		strings.Join(got, ",") != "primary=5-hour,codex_spark.primary=5-hour (Spark),secondary=Weekly" {
		t.Errorf("multi = %+v (%v)", l, got)
	}

	// ordinaryUsageAllowed false blocks even below 100 %.
	blocked := `{"ordinaryUsageAllowed":false,"rateLimits":{"primary":{"usedPercent":3}}}`
	if l := codexLimitsFrom(json.RawMessage(codexAccountFixture), nil, json.RawMessage(blocked), nil); l.Status != protocol.LimitsLimited ||
		l.Windows[0].Label != "Primary" || l.Windows[0].WindowMinutes != 0 {
		t.Errorf("blocked = %+v", l)
	}

	cases := []struct {
		name, account string
		limitsErr     error
		want          string
	}{
		{"api key", `{"account":{"type":"apiKey"},"requiresOpenaiAuth":true}`, nil, protocol.LimitsErrAPIKey},
		{"bedrock", `{"account":{"type":"amazonBedrock"},"requiresOpenaiAuth":false}`, nil, protocol.LimitsErrAPIKey},
		{"signed out", `{"account":null,"requiresOpenaiAuth":true}`, nil, protocol.LimitsErrSignedOut},
		{"read failed", codexAccountFixture, errors.New("account/rateLimits/read: backend unavailable"), "account/rateLimits/read: backend unavailable"},
	}
	for _, c := range cases {
		l := codexLimitsFrom(json.RawMessage(c.account), nil, json.RawMessage(codexRateLimitsFixture), c.limitsErr)
		if l.Error != c.want || len(l.Windows) != 0 {
			t.Errorf("%s: %+v", c.name, l)
		}
	}
}

func TestCodexRateLimitsUpdated(t *testing.T) {
	l, ok := codexLimitsEvent(json.RawMessage(codexRateLimitsUpdatedFixture))
	want := []protocol.LimitWindow{{Id: "primary", Label: "5-hour", UsedPercent: 27, ResetsAt: 1792505000, WindowMinutes: 300}}
	if !ok || l.Agent != "codex" || l.Source != protocol.LimitsFromSession || l.Plan != "Plus" || fmt.Sprint(l.Windows) != fmt.Sprint(want) {
		t.Fatalf("event = %+v %v", l, ok)
	}
	assertNoSecrets(t, "codex event", l)
	if _, ok := codexLimitsEvent(json.RawMessage(`{"rateLimits":{"credits":{"hasCredits":true}}}`)); ok {
		t.Error("an update without windows should not be reported")
	}
}

func TestDurationLabels(t *testing.T) {
	for minutes, want := range map[int64]string{300: "5-hour", 60: "1-hour", 10080: "Weekly", 1440: "Daily", 4320: "3-day", 43200: "Monthly", 90: "90-minute", 0: ""} {
		if got := durationLabel(minutes); got != want {
			t.Errorf("durationLabel(%d) = %q, want %q", minutes, got, want)
		}
	}
}

// limitsRecorder is a thread sink that also takes limit readings.
type limitsRecorder struct {
	mu   sync.Mutex
	seen []protocol.PlanLimits
}

func (r *limitsRecorder) event(protocol.ThreadEvent) {}
func (r *limitsRecorder) state(protocol.ThreadState) {}
func (r *limitsRecorder) limits(l protocol.PlanLimits) {
	r.mu.Lock()
	r.seen = append(r.seen, l)
	r.mu.Unlock()
}

// Running sessions forward their CLI's rate-limit messages.
func TestAdaptersForwardLimits(t *testing.T) {
	rec := &limitsRecorder{}
	newCodexAdapter(protocol.ThreadStart{Agent: "codex"}, rec).onNotify("account/rateLimits/updated", json.RawMessage(codexRateLimitsUpdatedFixture))
	newClaudeAdapter(protocol.ThreadStart{Agent: "claude"}, rec).onLine([]byte(claudeRateLimitEventFixture))
	if len(rec.seen) != 2 || rec.seen[0].Agent != "codex" || rec.seen[1].Agent != "claude" || rec.seen[1].Status != protocol.LimitsWarning {
		t.Fatalf("forwarded = %+v", rec.seen)
	}
	// Sinks that don't take readings are skipped.
	reportLimits(newRecordingSink(), rec.seen[0])
}

// --- fake CLIs: the test binary answers like claude / codex ---

const (
	fakeLimitsEnv    = "OVERSEER_FAKE_LIMITS_CLI" // "1": act as the CLI named by argv[0]
	fakeLimitsLogEnv = "OVERSEER_FAKE_LIMITS_LOG" // file the fake appends its args and every input line to
)

func runFakeLimitsCLI(_ string) {
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	logf := func(format string, args ...any) {
		if path := os.Getenv(fakeLimitsLogEnv); path != "" {
			if f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
				fmt.Fprintf(f, name+" "+format+"\n", args...)
				f.Close()
			}
		}
	}
	logf("args %s", strings.Join(os.Args[1:], " "))
	in := bufio.NewScanner(os.Stdin)
	out := json.NewEncoder(os.Stdout)
	for in.Scan() {
		logf("in %s", in.Text())
		var m map[string]any
		if json.Unmarshal(in.Bytes(), &m) != nil {
			continue
		}
		switch name {
		case "claude":
			req, _ := m["request"].(map[string]any)
			id := m["request_id"]
			switch req["subtype"] {
			case "initialize":
				out.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id,
					"response": map[string]any{"models": []any{}, "account": json.RawMessage(claudeInitAccountFixture)}}})
			case "get_usage":
				out.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id,
					"response": json.RawMessage(claudeGetUsageFixture)}})
			}
		case "codex":
			var result string
			switch m["method"] {
			case "initialize":
				result = `{"userAgent":"codex","codexHome":"/tmp","platformFamily":"unix","platformOs":"macos"}`
			case "account/read":
				result = codexAccountFixture
			case "account/rateLimits/read":
				result = codexRateLimitsFixture
			}
			if result != "" {
				out.Encode(map[string]any{"id": m["id"], "result": json.RawMessage(result)})
			}
		}
	}
}

// fakeLimitsPath puts fake claude and codex (links to the test binary) on
// PATH and returns the log file they write.
func fakeLimitsPath(t *testing.T) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, name := range []string{"claude", "codex"} {
		if err := os.Symlink(exe, filepath.Join(dir, name)); err != nil {
			t.Skipf("symlink: %v", err)
		}
	}
	t.Setenv("PATH", dir)
	t.Setenv(fakeLimitsEnv, "1")
	logPath := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv(fakeLimitsLogEnv, logPath)
	return logPath
}

// The device read talks to both CLIs over their real stdio protocols, sends
// no prompt, and answers the hub with numbers only.
func TestReadUsageLimitsWithFakeCLIs(t *testing.T) {
	logPath := fakeLimitsPath(t)
	t.Cleanup(limitProbes.Wait)
	start := time.Now()
	res := readUsageLimits(protocol.UsageLimitsRequest{})
	if time.Since(start) > usageLimitsBudget {
		t.Errorf("read took %v", time.Since(start))
	}
	if len(res.Accounts) != 2 {
		t.Fatalf("accounts = %+v", res.Accounts)
	}
	claude, codex := res.Accounts[0], res.Accounts[1]
	if claude.Agent != "claude" || claude.Plan != "Team" || len(claude.Windows) != 3 || claude.Source != protocol.LimitsLive || claude.FetchedAt == 0 {
		t.Errorf("claude = %+v", claude)
	}
	if codex.Agent != "codex" || codex.Plan != "Pro" || len(codex.Windows) != 1 || codex.Error != "" {
		t.Errorf("codex = %+v", codex)
	}
	assertNoSecrets(t, "usage.limits reply", res)

	// Only the agents asked for, and never ACP.
	if res := readUsageLimits(protocol.UsageLimitsRequest{Agents: []string{"codex", "gemini"}}); len(res.Accounts) != 1 || res.Accounts[0].Agent != "codex" {
		t.Errorf("filtered = %+v", res.Accounts)
	}

	limitProbes.Wait()
	data, _ := os.ReadFile(logPath)
	log := string(data)
	for _, want := range []string{"--no-session-persistence", `{"disableAllHooks":true}`, `"subtype":"get_usage"`, `"method":"account/rateLimits/read"`} {
		if !strings.Contains(log, want) {
			t.Errorf("log missing %s:\n%s", want, log)
		}
	}
	// No prompt: no user message to Claude, no thread or turn for Codex.
	for _, never := range []string{`"type":"user"`, "thread/start", "turn/start"} {
		if strings.Contains(log, never) {
			t.Errorf("probe sent %s:\n%s", never, log)
		}
	}
}

// Not installed: nothing is reported.
func TestReadUsageLimitsNothingInstalled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if res := readUsageLimits(protocol.UsageLimitsRequest{}); res.Accounts == nil || len(res.Accounts) != 0 {
		t.Errorf("accounts = %#v", res.Accounts)
	}
}

// OVERSEER_LIVE_LIMITS=1 reads the real CLIs on this machine (no prompt is
// sent). Accounts are not printed.
func TestReadUsageLimitsLive(t *testing.T) {
	if os.Getenv("OVERSEER_LIVE_LIMITS") != "1" {
		t.Skip("set OVERSEER_LIVE_LIMITS=1 to read the installed CLIs")
	}
	start := time.Now()
	res := readUsageLimits(protocol.UsageLimitsRequest{})
	t.Logf("read in %v", time.Since(start).Round(time.Millisecond))
	limitProbes.Wait()
	for _, l := range res.Accounts {
		t.Logf("%s plan=%q status=%s error=%q account=%v windows=%+v", l.Agent, l.Plan, l.Status, l.Error, l.Account != "", l.Windows)
	}
	assertNoSecrets(t, "live", res)
}
