package hub

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Agent Wrapped: GET /api/stats?range=week|month|all (or start/end unix
// seconds) summarises what the fleet's agents did, computed from the threads
// and thread_messages tables in one pass over the messages of the range.

func init() {
	// thread_messages is only indexed per thread; range queries go by time.
	extraSchemas = append(extraSchemas, `CREATE INDEX IF NOT EXISTS thread_messages_at ON thread_messages(at)`)
}

func (s *Server) routesStats(m *http.ServeMux) {
	m.HandleFunc("GET /api/stats", s.requireAuth(s.handleStats))
}

// StatsTotals are the headline numbers of one period.
type StatsTotals struct {
	Sessions  int   `json:"sessions"`
	Turns     int   `json:"turns"`
	AgentMs   int64 `json:"agentMs"`
	PRs       int   `json:"prs"`
	Lines     int   `json:"lines"`
	Approvals int   `json:"approvals"`
}

// StatsGroup is one agent's or one machine's share of the period.
type StatsGroup struct {
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	Sessions int     `json:"sessions"`
	Turns    int     `json:"turns"`
	AgentMs  int64   `json:"agentMs"`
	Added    int     `json:"added"`
	Removed  int     `json:"removed"`
	PRs      int     `json:"prs"`
	CostUsd  float64 `json:"costUsd,omitempty"`
}

// StatsDay is one local calendar day of the period.
type StatsDay struct {
	Date     string `json:"date"` // YYYY-MM-DD in the requested time zone
	Sessions int    `json:"sessions"`
	Turns    int    `json:"turns"`
	AgentMs  int64  `json:"agentMs"`
	Lines    int    `json:"lines"`
}

// StatsSession is a standout session of the period.
type StatsSession struct {
	Id         string `json:"id"`
	Title      string `json:"title"`
	Agent      string `json:"agent"`
	DeviceName string `json:"deviceName"`
	Added      int    `json:"added"`
	Removed    int    `json:"removed"`
	Turns      int    `json:"turns"`
	AgentMs    int64  `json:"agentMs"`
}

// StatsResponse is the body of GET /api/stats.
type StatsResponse struct {
	Range string `json:"range"` // week | month | all | custom
	Start int64  `json:"start"` // unix seconds, inclusive
	End   int64  `json:"end"`   // unix seconds, exclusive
	Tz    string `json:"tz"`

	Sessions struct {
		Started  int `json:"started"`
		Finished int `json:"finished"`
	} `json:"sessions"`
	Turns      int     `json:"turns"`
	AgentMs    int64   `json:"agentMs"`
	AgentHours float64 `json:"agentHours"`
	PRs        struct {
		Opened int `json:"opened"`
		Merged int `json:"merged"`
	} `json:"prs"`
	Lines struct {
		Added   int `json:"added"`
		Removed int `json:"removed"`
	} `json:"lines"`
	Files     int `json:"files"`
	Approvals int `json:"approvals"`
	Tokens    struct {
		Input  int64 `json:"input"`
		Output int64 `json:"output"`
	} `json:"tokens"`
	CostUsd float64 `json:"costUsd"`

	Agents   []StatsGroup `json:"agents"`
	Machines []StatsGroup `json:"machines"`
	Days     []StatsDay   `json:"days"`

	BusiestDay     *StatsDay     `json:"busiestDay,omitempty"`
	LongestSession *StatsSession `json:"longestSession,omitempty"`
	TopSession     *StatsSession `json:"topSession,omitempty"`
	Streak         struct {
		Current int `json:"current"`
		Longest int `json:"longest"`
	} `json:"streak"`

	// Previous is the period right before this one (not for "all").
	Previous *StatsTotals `json:"previous,omitempty"`
}

const maxStatDays = 400

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	loc := time.UTC
	if name := q.Get("tz"); name != "" {
		if l, err := time.LoadLocation(name); err == nil {
			loc = l
		}
	}
	now := time.Now()
	kind := q.Get("range")
	if kind == "" {
		kind = "week"
	}
	today := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	end := today.AddDate(0, 0, 1)
	var start time.Time
	switch kind {
	case "week":
		start = end.AddDate(0, 0, -7)
	case "month":
		start = end.AddDate(0, 0, -30)
	case "all":
		first, err := s.store.firstThreadAt()
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		start = end.AddDate(0, 0, -7)
		if first > 0 {
			f := time.Unix(first, 0).In(loc)
			start = time.Date(f.Year(), f.Month(), f.Day(), 0, 0, 0, 0, loc)
		}
	default:
		httpError(w, http.StatusBadRequest, "range must be week, month or all")
		return
	}
	if q.Get("start") != "" || q.Get("end") != "" {
		a, errA := strconv.ParseInt(q.Get("start"), 10, 64)
		b, errB := strconv.ParseInt(q.Get("end"), 10, 64)
		if errA != nil || errB != nil || a < 0 || b <= a {
			httpError(w, http.StatusBadRequest, "start and end must be unix seconds with start before end")
			return
		}
		start, end, kind = time.Unix(a, 0).In(loc), time.Unix(b, 0).In(loc), "custom"
	}
	res, err := s.store.computeStats(start, end, loc, now)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	res.Range = kind
	if kind != "all" {
		span := end.Sub(start)
		prev, err := s.store.computeStats(start.Add(-span), start, loc, now)
		if err == nil {
			t := prev.totals()
			res.Previous = &t
		}
	}
	writeJSON(w, res)
}

func (r *StatsResponse) totals() StatsTotals {
	return StatsTotals{Sessions: r.Sessions.Started, Turns: r.Turns, AgentMs: r.AgentMs, PRs: r.PRs.Opened,
		Lines: r.Lines.Added + r.Lines.Removed, Approvals: r.Approvals}
}

func (s *Store) firstThreadAt() (int64, error) {
	var first *int64
	err := s.db.QueryRow(`SELECT MIN(created_at) FROM threads WHERE created_at > 0`).Scan(&first)
	if first == nil {
		return 0, err
	}
	return *first, err
}

// statThread is what the pass keeps per thread of the period.
type statThread struct {
	Thread
	added, removed, turns int
	agentMs               int64
	files                 map[string]struct{}
	prs                   []string // PR urls found in its tool calls
}

func dayKey(t time.Time) string { return t.Format("2006-01-02") }

func (s *Store) computeStats(start, end time.Time, loc *time.Location, now time.Time) (*StatsResponse, error) {
	lo, hi := start.Unix(), end.Unix()
	res := &StatsResponse{Start: lo, End: hi, Tz: loc.String(), Agents: []StatsGroup{}, Machines: []StatsGroup{}, Days: []StatsDay{}}

	// Threads that were alive during the period.
	rows, err := s.db.Query(`SELECT `+threadColumns+`
		FROM threads t LEFT JOIN devices d ON d.id = t.device_id
		WHERE t.updated_at >= ? AND t.created_at < ?`, lo, hi)
	if err != nil {
		return nil, err
	}
	threads := map[string]*statThread{}
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		threads[t.Id] = &statThread{Thread: *t, files: map[string]struct{}{}}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// One bucket per local day, oldest first.
	days := []*StatsDay{}
	index := map[string]*StatsDay{}
	first := start
	if floor := end.AddDate(0, 0, -maxStatDays); first.Before(floor) {
		first = floor
	}
	for d := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, loc); d.Before(end); d = d.AddDate(0, 0, 1) {
		day := &StatsDay{Date: dayKey(d)}
		days = append(days, day)
		index[day.Date] = day
	}
	bucket := func(unix int64) *StatsDay { return index[dayKey(time.Unix(unix, 0).In(loc))] }

	agents := map[string]*StatsGroup{}
	machines := map[string]*StatsGroup{}
	group := func(m map[string]*StatsGroup, id, name string) *StatsGroup {
		g := m[id]
		if g == nil {
			g = &StatsGroup{Id: id, Name: name}
			m[id] = g
		}
		return g
	}

	// Sessions started / finished, PRs, tokens: from the thread rows.
	prSeen, mergedSeen := map[string]bool{}, map[string]bool{}
	for _, t := range threads {
		ag, ma := group(agents, t.Agent, t.Agent), group(machines, t.DeviceId, t.DeviceName)
		if t.CreatedAt >= lo && t.CreatedAt < hi {
			res.Sessions.Started++
			ag.Sessions++
			ma.Sessions++
			if d := bucket(t.CreatedAt); d != nil {
				d.Sessions++
			}
		}
		if t.UpdatedAt >= lo && t.UpdatedAt < hi {
			switch t.Status {
			case "idle", "stopped", "error":
				res.Sessions.Finished++
			}
			if t.PR != nil && t.PR.Url != "" && !prSeen[t.PR.Url] {
				prSeen[t.PR.Url] = true
				res.PRs.Opened++
				ag.PRs++
				ma.PRs++
				if t.PR.State == "merged" {
					mergedSeen[t.PR.Url] = true
					res.PRs.Merged++
				}
			}
			if u := t.Usage; u != nil {
				res.Tokens.Input += u.InputTokens
				res.Tokens.Output += u.OutputTokens
				res.CostUsd += u.CostUsd
				ag.CostUsd += u.CostUsd
				ma.CostUsd += u.CostUsd
			}
		}
	}

	// One pass over the period's messages. JSON functions pick the few
	// fields needed so tool diffs never leave the database.
	mrows, err := s.db.Query(`SELECT m.thread_id, m.role, m.at,
			COALESCE(json_extract(m.data, '$.durationMs'), 0),
			COALESCE(json_extract(m.data, '$.queued'), 0),
			COALESCE(json_extract(m.data, '$.approval.resolved'), ''),
			COALESCE(json_extract(m.data, '$.tool.status'), ''),
			(SELECT COALESCE(SUM(json_extract(f.value, '$.additions')), 0) FROM json_each(m.data, '$.tool.files') f),
			(SELECT COALESCE(SUM(json_extract(f.value, '$.deletions')), 0) FROM json_each(m.data, '$.tool.files') f),
			(SELECT COALESCE(group_concat(json_extract(f.value, '$.path'), char(10)), '') FROM json_each(m.data, '$.tool.files') f)
		FROM thread_messages m
		WHERE m.at >= ? AND m.at < ? AND json_valid(m.data) AND (
			m.role IN ('user', 'approval')
			OR (m.role = 'tool' AND m.data LIKE '%"files"%')
			OR (m.role IN ('assistant', 'status') AND m.data LIKE '%"durationMs"%'))`, lo*1000, hi*1000)
	if err != nil {
		return nil, err
	}
	for mrows.Next() {
		var threadId, role, resolved, status, paths string
		var at, durMs int64
		var queued bool
		var add, del int
		if err := mrows.Scan(&threadId, &role, &at, &durMs, &queued, &resolved, &status, &add, &del, &paths); err != nil {
			mrows.Close()
			return nil, err
		}
		t := threads[threadId]
		if t == nil {
			continue
		}
		ag, ma, day := agents[t.Agent], machines[t.DeviceId], bucket(at/1000)
		switch role {
		case "user":
			if queued {
				continue
			}
			res.Turns++
			t.turns++
			ag.Turns++
			ma.Turns++
			if day != nil {
				day.Turns++
			}
		case "approval":
			if resolved != "" {
				res.Approvals++
			}
		case "tool":
			if status == "error" || add+del == 0 {
				continue
			}
			res.Lines.Added += add
			res.Lines.Removed += del
			t.added += add
			t.removed += del
			ag.Added += add
			ag.Removed += del
			ma.Added += add
			ma.Removed += del
			for _, p := range strings.Split(paths, "\n") {
				if p != "" {
					t.files[p] = struct{}{}
				}
			}
			if day != nil {
				day.Lines += add + del
			}
		case "assistant", "status":
			if durMs <= 0 {
				continue
			}
			res.AgentMs += durMs
			t.agentMs += durMs
			ag.AgentMs += durMs
			ma.AgentMs += durMs
			if day != nil {
				day.AgentMs += durMs
			}
		}
	}
	if err := mrows.Err(); err != nil {
		mrows.Close()
		return nil, err
	}
	mrows.Close()

	// The hub does not always know a thread's PR, so PRs the agent opened or
	// merged with gh (or the GitHub MCP tools) are read from its tool calls.
	opened, merged, err := s.messagePRs(lo, hi)
	if err != nil {
		return nil, err
	}
	for _, o := range opened {
		t := threads[o.threadId]
		if t == nil || prSeen[o.url] {
			continue
		}
		prSeen[o.url] = true
		res.PRs.Opened++
		agents[t.Agent].PRs++
		machines[t.DeviceId].PRs++
		t.prs = append(t.prs, o.url)
	}
	for _, m := range merged {
		t := threads[m.threadId]
		if t == nil {
			continue
		}
		url := ""
		for _, u := range t.prs {
			if m.ref == "" || strings.HasSuffix(u, "/pull/"+m.ref) || u == m.ref {
				url = u
				break
			}
		}
		if url == "" && strings.HasPrefix(m.ref, "http") {
			url = m.ref
		}
		if url != "" && !mergedSeen[url] {
			mergedSeen[url] = true
			res.PRs.Merged++
		}
	}
	res.AgentHours = float64(res.AgentMs) / 3.6e6
	for _, t := range threads {
		res.Files += len(t.files)
	}
	for _, g := range agents {
		if g.Sessions+g.Turns+g.PRs > 0 || g.AgentMs > 0 {
			res.Agents = append(res.Agents, *g)
		}
	}
	for _, g := range machines {
		if g.Sessions+g.Turns+g.PRs > 0 || g.AgentMs > 0 {
			res.Machines = append(res.Machines, *g)
		}
	}
	rank := func(list []StatsGroup) {
		sort.Slice(list, func(i, j int) bool {
			a, b := list[i], list[j]
			if a.AgentMs != b.AgentMs {
				return a.AgentMs > b.AgentMs
			}
			if a.Turns != b.Turns {
				return a.Turns > b.Turns
			}
			if a.Sessions != b.Sessions {
				return a.Sessions > b.Sessions
			}
			return a.Id < b.Id
		})
	}
	rank(res.Agents)
	rank(res.Machines)

	for _, d := range days {
		res.Days = append(res.Days, *d)
		if d.Turns+d.Sessions == 0 && d.AgentMs == 0 {
			continue
		}
		if res.BusiestDay == nil || d.AgentMs > res.BusiestDay.AgentMs ||
			(d.AgentMs == res.BusiestDay.AgentMs && d.Turns > res.BusiestDay.Turns) {
			c := *d
			res.BusiestDay = &c
		}
	}

	// Standout sessions: most lines changed, and most time spent working.
	var top, longest *statThread
	for _, t := range threads {
		if t.turns == 0 && t.agentMs == 0 && t.added+t.removed == 0 {
			continue
		}
		if top == nil || t.added+t.removed > top.added+top.removed ||
			(t.added+t.removed == top.added+top.removed && t.agentMs > top.agentMs) {
			top = t
		}
		if t.agentMs > 0 && (longest == nil || t.agentMs > longest.agentMs) {
			longest = t
		}
	}
	card := func(t *statThread) *StatsSession {
		if t == nil {
			return nil
		}
		return &StatsSession{Id: t.Id, Title: t.Title, Agent: t.Agent, DeviceName: t.DeviceName,
			Added: t.added, Removed: t.removed, Turns: t.turns, AgentMs: t.agentMs}
	}
	res.TopSession, res.LongestSession = card(top), card(longest)
	if top != nil && top.added+top.removed == 0 && longest != nil {
		res.TopSession = card(longest)
	}

	cur, best, err := s.activeStreaks(loc, now)
	if err != nil {
		return nil, err
	}
	res.Streak.Current, res.Streak.Longest = cur, best
	return res, nil
}

// activeStreaks counts consecutive local days with at least one prompt, over
// the last year. The current streak is still alive if today has no prompt
// yet but yesterday did.
func (s *Store) activeStreaks(loc *time.Location, now time.Time) (current, longest int, err error) {
	since := now.AddDate(0, 0, -maxStatDays).UnixMilli()
	rows, err := s.db.Query(`SELECT DISTINCT at / 900000 FROM thread_messages WHERE role = 'user' AND at >= ?`, since)
	if err != nil {
		return 0, 0, err
	}
	active := map[string]bool{}
	for rows.Next() {
		var quarter int64
		if err := rows.Scan(&quarter); err != nil {
			rows.Close()
			return 0, 0, err
		}
		active[dayKey(time.Unix(quarter*900+450, 0).In(loc))] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	today := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	run := 0
	for i := maxStatDays; i >= 0; i-- {
		if active[dayKey(today.AddDate(0, 0, -i))] {
			run++
			longest = max(longest, run)
		} else if i != 0 {
			run = 0
		}
	}
	// An empty today leaves the run standing: it may still extend.
	return run, longest, nil
}

var prURL = regexp.MustCompile(`https://github\.com/[\w.-]+/[\w.-]+/pull/\d+`)
var pullNumberArg = regexp.MustCompile(`"pullNumber"\s*:\s*"?(\d+)`)
var prNumber = regexp.MustCompile(`(?:/pull/|#)?(\d+)`)

type foundPR struct{ threadId, url string }
type mergedPR struct{ threadId, ref string } // ref: a PR url, a number, or empty (the thread's only PR)

// messagePRs finds the pull requests agents opened (gh pr create, GitHub MCP
// create_pull_request) and merged in the period.
func (s *Store) messagePRs(lo, hi int64) (opened []foundPR, merged []mergedPR, err error) {
	rows, err := s.db.Query(`SELECT thread_id,
			COALESCE(json_extract(data, '$.tool.title'), ''),
			COALESCE(json_extract(data, '$.tool.input'), ''),
			substr(COALESCE(json_extract(data, '$.tool.output'), ''), 1, 4000)
		FROM thread_messages
		WHERE role = 'tool' AND at >= ? AND at < ? AND json_valid(data) AND (
			json_extract(data, '$.tool.input') LIKE '%gh pr create%' OR json_extract(data, '$.tool.input') LIKE '%gh pr merge%'
			OR json_extract(data, '$.tool.title') LIKE '%create_pull_request%' OR json_extract(data, '$.tool.title') LIKE '%merge_pull_request%')
		ORDER BY at`, lo*1000, hi*1000)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, title, input, output string
		if err := rows.Scan(&id, &title, &input, &output); err != nil {
			return nil, nil, err
		}
		switch {
		case strings.Contains(input, "gh pr merge") || strings.Contains(title, "merge_pull_request"):
			ref := prURL.FindString(input)
			if ref == "" {
				if i := strings.Index(input, "gh pr merge"); i >= 0 {
					if m := prNumber.FindStringSubmatch(input[i+len("gh pr merge"):]); m != nil {
						ref = m[1]
					}
				} else if m := pullNumberArg.FindStringSubmatch(input); m != nil {
					ref = m[1]
				}
			}
			merged = append(merged, mergedPR{id, ref})
		default:
			if u := prURL.FindString(output); u != "" {
				opened = append(opened, foundPR{id, u})
			}
		}
	}
	return opened, merged, rows.Err()
}
