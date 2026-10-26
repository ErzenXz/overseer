package top

import (
	"fmt"
	"strings"
	"time"
)

// StatusReport is the machine-readable form of `overseer status --json`.
type StatusReport struct {
	Hub      string          `json:"hub"`
	Version  string          `json:"version,omitempty"`
	Time     string          `json:"time"`
	Counts   StatusCounts    `json:"counts"`
	Machines []StatusMachine `json:"machines"`
	Sessions []StatusSession `json:"sessions"`
	NeedsYou []string        `json:"needsYou"` // ids of sessions waiting on you
}

// StatusCounts mirrors the header of `overseer top`.
type StatusCounts struct {
	Waiting   int `json:"waiting"`
	Working   int `json:"working"`
	DoneToday int `json:"doneToday"`
	Failed    int `json:"failed"`
	Total     int `json:"total"`
}

// StatusMachine is one machine.
type StatusMachine struct {
	Id         string   `json:"id"`
	Name       string   `json:"name"`
	Online     bool     `json:"online"`
	CPUPercent *float64 `json:"cpuPercent,omitempty"`
	MemPercent *float64 `json:"memPercent,omitempty"`
	Sessions   int      `json:"sessions"`
	Working    int      `json:"working"`
	Waiting    int      `json:"waiting"`
	LastSeen   string   `json:"lastSeen,omitempty"`
}

// StatusSession is one agent session.
type StatusSession struct {
	Id             string          `json:"id"`
	Title          string          `json:"title"`
	State          string          `json:"state"`  // approval | question | waiting | working | starting | done | failed | stopped
	Status         string          `json:"status"` // the hub's raw status
	Agent          string          `json:"agent"`
	Model          string          `json:"model,omitempty"`
	Machine        string          `json:"machine"`
	Cwd            string          `json:"cwd,omitempty"`
	Branch         string          `json:"branch,omitempty"`
	Step           string          `json:"step,omitempty"`
	ElapsedSeconds int64           `json:"elapsedSeconds"`
	UpdatedAt      string          `json:"updatedAt,omitempty"`
	NeedsYou       bool            `json:"needsYou"`
	Approval       *StatusApproval `json:"approval,omitempty"`
}

// StatusApproval is the request a waiting session is blocked on.
type StatusApproval struct {
	Id      string   `json:"id"`
	Title   string   `json:"title"`
	Options []string `json:"options,omitempty"`
}

// BuildStatus summarises a snapshot.
func BuildStatus(s Snapshot, now time.Time) StatusReport {
	c := s.Counts(now)
	rep := StatusReport{
		Hub: s.HubURL, Version: s.Version, Time: now.Format(time.RFC3339),
		Counts:   StatusCounts{c.Waiting, c.Working, c.DoneToday, c.Failed, c.Total},
		Machines: []StatusMachine{}, Sessions: []StatusSession{}, NeedsYou: []string{},
	}
	for _, mc := range s.Machines {
		d := mc.Device
		sm := StatusMachine{Id: d.Id, Name: d.Name, Online: d.Online, Sessions: mc.Total, Working: mc.Working, Waiting: mc.Waiting}
		if d.Online && d.Stats != nil {
			cpu := d.Stats.CPUPercent
			sm.CPUPercent = &cpu
			if d.Stats.MemTotal > 0 {
				mem := float64(d.Stats.MemUsed) / float64(d.Stats.MemTotal) * 100
				sm.MemPercent = &mem
			}
		}
		if d.LastSeen > 0 {
			sm.LastSeen = time.UnixMilli(d.LastSeen * unitMs(d.LastSeen)).UTC().Format(time.RFC3339)
		}
		rep.Machines = append(rep.Machines, sm)
	}
	for _, r := range s.Rows {
		t := r.Thread
		ss := StatusSession{
			Id: t.Id, Title: t.Title, State: r.StateText(), Status: t.Status, Agent: t.Agent, Model: t.Model,
			Machine: t.DeviceName, Cwd: t.Cwd, Branch: r.Branch, Step: r.Act.Step,
			NeedsYou: r.Kind == KindWaiting,
		}
		if t.UpdatedAt > 0 {
			ss.UpdatedAt = time.UnixMilli(t.UpdatedAt).UTC().Format(time.RFC3339)
		}
		switch r.Kind {
		case KindWaiting:
			start := t.UpdatedAt
			if r.Act.Pending != nil && r.Act.Pending.At > 0 {
				start = r.Act.Pending.At
			}
			ss.ElapsedSeconds = (now.UnixMilli() - start) / 1000
		case KindWorking:
			start := r.Act.TurnStart
			if start == 0 {
				start = t.UpdatedAt
			}
			ss.ElapsedSeconds = (now.UnixMilli() - start) / 1000
		default:
			ss.ElapsedSeconds = (now.UnixMilli() - t.UpdatedAt) / 1000
		}
		if ss.ElapsedSeconds < 0 {
			ss.ElapsedSeconds = 0
		}
		if p := r.Act.Pending; p != nil && p.Approval != nil {
			a := &StatusApproval{Id: p.Approval.Id, Title: p.Approval.Title}
			for _, o := range p.Approval.Options {
				a.Options = append(a.Options, o.Label)
			}
			ss.Approval = a
		}
		rep.Sessions = append(rep.Sessions, ss)
		if ss.NeedsYou {
			rep.NeedsYou = append(rep.NeedsYou, t.Id)
		}
	}
	return rep
}

// StatusText renders the colourful one-shot summary.
func StatusText(s Snapshot, now time.Time, width int, color bool) string {
	if width < 60 {
		width = 60
	}
	m := &Model{Snap: s, W: width, H: 1 << 20, Now: now, Color: color, Static: true}
	var out []Line
	title := Line{{"Overseer", sBold}, {"  " + s.Hub, sGray}}
	if s.Version != "" {
		title = append(title, Seg{"  v" + strings.TrimPrefix(s.Version, "v"), sGray})
	}
	out = append(out, title, Line{})

	out = append(out, Line{{"Machines", sBold}})
	if len(s.Machines) == 0 {
		out = append(out, Line{{"  none enrolled yet", sGray}})
	}
	nameW := 6
	for _, mc := range s.Machines {
		if x := strWidth(mc.Device.Name); x > nameW {
			nameW = x
		}
	}
	for _, mc := range s.Machines {
		out = append(out, m.machineLine(mc, min(nameW, 24), 8, width))
	}

	var waiting, working, rest []Row
	for _, r := range s.Rows {
		switch r.Kind {
		case KindWaiting:
			waiting = append(waiting, r)
		case KindWorking:
			working = append(working, r)
		default:
			if r.Kind == KindFailed || r.Thread.UpdatedAt >= now.Add(-24*time.Hour).UnixMilli() {
				rest = append(rest, r)
			}
		}
	}
	section := func(name, st string, rows []Row, limit int) {
		out = append(out, Line{}, Line{{name, sBold}, {fmt.Sprintf(" (%d)", len(rows)), st}})
		for i, r := range rows {
			if i == limit {
				out = append(out, Line{{fmt.Sprintf("  … and %d more", len(rows)-limit), sGray}})
				break
			}
			out = append(out, m.statusRow(r, width)...)
		}
	}
	if len(waiting) > 0 {
		section("Needs you", sAmber, waiting, 20)
	} else {
		out = append(out, Line{}, Line{{"Needs you", sBold}, {" (0)", sGreen}}, Line{{"  nothing is waiting for you", sGray}})
	}
	if len(working) > 0 {
		section("Working", sBlue, working, 12)
	}
	if len(rest) > 0 {
		section("Recent", sGray, rest, 6)
	}

	c := s.Counts(now)
	sum := Line{{"●", sAmber}, {fmt.Sprintf(" %d waiting  ", c.Waiting), ""}, {"◐", sBlue}, {fmt.Sprintf(" %d working  ", c.Working), ""},
		{"✓", sGreen}, {fmt.Sprintf(" %d done today", c.DoneToday), ""}}
	if c.Failed > 0 {
		sum = append(sum, Seg{"  ✗", sRed}, Seg{fmt.Sprintf(" %d failed", c.Failed), ""})
	}
	out = append(out, Line{}, sum)

	var b strings.Builder
	for _, l := range out {
		if color {
			b.WriteString(l.Fit(width).Render(true))
		} else {
			b.WriteString(strings.TrimRight(l.Fit(width).Plain(), " "))
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// statusRow is a session as two lines: what it is, and what it is doing.
func (m *Model) statusRow(r Row, w int) []Line {
	t := r.Thread
	glyph := m.glyph(r.Kind)
	where := []string{t.Agent}
	if t.Model != "" {
		where = append(where, shortModel(t.Model))
	}
	meta := strings.Join(where, " ") + " · " + t.DeviceName
	if f := rowFolder(r); f != "" {
		meta += " · " + f
	}
	first := Line{{"  ", ""}, glyph, {" ", ""}, {truncate(oneLine(t.Title), w-6-min(strWidth(meta), w/2)), sBold}, {"  " + truncate(oneLine(meta), w/2), sGray}}
	detail := r.StateText() + " " + r.TimeText(m.Now)
	second := Line{{"    ", ""}, {detail, kindStyle(r.Kind)}}
	if r.Act.Step != "" {
		second = append(second, Seg{" · " + truncate(oneLine(r.Act.Step), max(10, w-8-strWidth(detail))), sGray})
	}
	return []Line{first.Fit(w), second.Fit(w)}
}

// StatusShort is one line for shell prompts: counts only, empty parts left out.
func StatusShort(s Snapshot, now time.Time, color bool) string {
	c := s.Counts(now)
	var parts Line
	add := func(g, st string, n int) {
		if n == 0 {
			return
		}
		if len(parts) > 0 {
			parts = append(parts, Seg{" ", ""})
		}
		parts = append(parts, Seg{fmt.Sprintf("%s%d", g, n), st})
	}
	add("●", sAmber, c.Waiting)
	add("◐", sBlue, c.Working)
	add("✗", sRed, c.Failed)
	if len(parts) == 0 {
		parts = Line{{"✓", sGreen}}
	}
	if !color {
		return parts.Plain()
	}
	return parts.Render(true)
}
