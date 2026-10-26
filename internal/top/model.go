// Package top is the terminal UI behind `overseer top` and the summary
// behind `overseer status`: a live view of every coding-agent session and
// machine on a hub, built only from the hub's public REST API.
package top

import (
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/fleet"
)

// Kind is the coarse state of a session, in display priority order.
type Kind int

const (
	KindWaiting Kind = iota // blocked on you
	KindWorking             // starting or running a turn
	KindDone                // idle: the turn finished
	KindFailed
	KindStopped
)

func kindOf(status string) Kind {
	switch status {
	case "waiting":
		return KindWaiting
	case "working", "starting":
		return KindWorking
	case "error":
		return KindFailed
	case "stopped":
		return KindStopped
	}
	return KindDone
}

type threadMsg = fleet.ThreadMessage

// Row is one session with the live detail derived from its transcript.
type Row struct {
	Thread fleet.Thread // CreatedAt and UpdatedAt are unix milliseconds here
	Kind   Kind
	Act    Activity
	Branch string
	// Msgs is the transcript when it was fetched (active sessions, and the
	// one open in the detail pane); nil otherwise.
	Msgs []fleet.ThreadMessage
}

// Active reports whether a turn is in progress (so it can be stopped).
func (r Row) Active() bool { return r.Kind == KindWaiting || r.Kind == KindWorking }

// StateText is the short state column.
func (r Row) StateText() string {
	switch r.Kind {
	case KindWaiting:
		if p := r.Act.Pending; p != nil {
			if p.Question != nil {
				return "question"
			}
			return "approval"
		}
		return "waiting"
	case KindWorking:
		if r.Thread.Status == "starting" {
			return "starting"
		}
		return "working"
	case KindFailed:
		return "failed"
	case KindStopped:
		return "stopped"
	}
	return "done"
}

// TimeText is the elapsed column: how long a turn has run or how long ago
// a finished session last changed.
func (r Row) TimeText(now time.Time) string {
	ms := now.UnixMilli()
	switch r.Kind {
	case KindWaiting:
		if r.Act.Pending != nil && r.Act.Pending.At > 0 {
			return formatDuration(ms - r.Act.Pending.At)
		}
		return formatDuration(ms - r.Thread.UpdatedAt)
	case KindWorking:
		start := r.Act.TurnStart
		if start == 0 {
			start = r.Thread.UpdatedAt
		}
		return formatDuration(ms - start)
	}
	if r.Thread.UpdatedAt == 0 {
		return ""
	}
	return formatDuration(ms-r.Thread.UpdatedAt) + " ago"
}

// Machine is one device with its live session counts.
type Machine struct {
	Device  fleet.Device
	Working int
	Waiting int
	Total   int
}

// Snapshot is everything one refresh learned.
type Snapshot struct {
	At       time.Time
	HubURL   string
	Hub      string // host part of the hub URL
	Version  string
	Machines []Machine
	Rows     []Row
	Err      string // last refresh error ("" when fine)
	Loaded   bool
}

// Counts summarises the sessions.
type Counts struct {
	Waiting, Working, Failed, DoneToday, Total int
}

func (s Snapshot) Counts(now time.Time) Counts {
	var c Counts
	y, mo, d := now.Date()
	midnight := time.Date(y, mo, d, 0, 0, 0, 0, now.Location()).UnixMilli()
	for _, r := range s.Rows {
		c.Total++
		switch r.Kind {
		case KindWaiting:
			c.Waiting++
		case KindWorking:
			c.Working++
		case KindFailed:
			c.Failed++
		case KindDone:
			if r.Thread.UpdatedAt >= midnight {
				c.DoneToday++
			}
		}
	}
	return c
}

// hubHost is the display name of a hub URL.
func hubHost(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	return strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
}

// sortRows orders sessions: waiting first (longest wait first), then
// working (longest running first), then the rest, newest first. The order
// only changes when states do, so rows do not jump around while they work.
func sortRows(rows []Row) {
	key := func(r Row) int64 {
		switch r.Kind {
		case KindWaiting:
			if r.Act.Pending != nil && r.Act.Pending.At > 0 {
				return r.Act.Pending.At
			}
			return r.Thread.UpdatedAt
		case KindWorking:
			if r.Act.TurnStart > 0 {
				return r.Act.TurnStart
			}
			return r.Thread.CreatedAt
		}
		return -r.Thread.UpdatedAt
	}
	group := func(r Row) int {
		if r.Kind == KindWaiting || r.Kind == KindWorking {
			return int(r.Kind)
		}
		return 2
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if ga, gb := group(a), group(b); ga != gb {
			return ga < gb
		}
		if ka, kb := key(a), key(b); ka != kb {
			return ka < kb
		}
		return a.Thread.Id < b.Thread.Id
	})
}

// matchesFilter is a case-insensitive "every word appears somewhere".
func matchesFilter(r Row, query string) bool {
	words := strings.Fields(strings.ToLower(query))
	if len(words) == 0 {
		return true
	}
	hay := strings.ToLower(strings.Join([]string{
		r.Thread.Title, r.Thread.Agent, r.Thread.Model, r.Thread.DeviceName, r.Thread.Cwd,
		r.Thread.Folder, r.Branch, r.StateText(), r.Act.Step, r.Thread.Status,
	}, "\n"))
	for _, w := range words {
		if !strings.Contains(hay, w) {
			return false
		}
	}
	return true
}

func formatDuration(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	s := ms / 1000
	switch {
	case s < 60:
		return itoa64(s) + "s"
	case s < 600:
		return itoa64(s/60) + "m" + pad2(s%60) + "s"
	case s < 3600:
		return itoa64(s/60) + "m"
	case s < 86400:
		return itoa64(s/3600) + "h" + pad2(s%3600/60) + "m"
	}
	return itoa64(s/86400) + "d" + itoa64(s%86400/3600) + "h"
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func pad2(n int64) string {
	if n < 10 {
		return "0" + itoa64(n)
	}
	return itoa64(n)
}

// shortFolder is the last two path components of a working directory.
func shortFolder(cwd string) string {
	cwd = strings.ReplaceAll(cwd, "\\", "/")
	cwd = strings.TrimRight(cwd, "/")
	if cwd == "" {
		return ""
	}
	parts := strings.Split(cwd, "/")
	if len(parts) > 2 {
		parts = parts[len(parts)-2:]
	}
	return strings.Join(parts, "/")
}

// shortModel trims vendor noise from a model id.
func shortModel(m string) string {
	return strings.TrimPrefix(m, "claude-")
}
