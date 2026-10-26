package top

import (
	"fmt"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// SGR styles. Colours are 256-colour codes; with NO_COLOR only the bold,
// dim and reverse attributes survive (see Line.Render).
const (
	sAmber = "38;5;214"
	sBlue  = "38;5;75"
	sGreen = "38;5;78"
	sRed   = "38;5;203"
	sGray  = "38;5;245"
	sBold  = "1"
	sDim   = "2"
	sHead  = "1;38;5;250;48;5;236"
	sSelBG = "48;5;238"
)

var spinner = []string{"◐", "◓", "◑", "◒"}

func (m *Model) glyph(k Kind) Seg {
	switch k {
	case KindWaiting:
		return Seg{"●", sAmber + ";1"}
	case KindWorking:
		return Seg{m.spin(), sBlue}
	case KindFailed:
		return Seg{"✗", sRed}
	case KindStopped:
		return Seg{"■", sGray}
	}
	return Seg{"✓", sGreen}
}

// spin is the working glyph: it turns while the live view is open.
func (m *Model) spin() string {
	if m.Static {
		return spinner[0]
	}
	return spinner[int(m.Now.UnixMilli()/250)%len(spinner)]
}

func kindStyle(k Kind) string {
	switch k {
	case KindWaiting:
		return sAmber
	case KindWorking:
		return sBlue
	case KindFailed:
		return sRed
	case KindStopped:
		return sGray
	}
	return sGreen
}

// --- columns ---

type column struct {
	name string
	w    int
	min  int
}

const (
	colTitle = iota
	colAgent
	colMachine
	colFolder
	colState
	colStep
	colTime
	numCols
)

func rowAgent(r Row) string {
	s := r.Thread.Agent
	if r.Thread.Model != "" {
		s += " " + shortModel(r.Thread.Model)
	}
	return s
}

func rowFolder(r Row) string {
	f := shortFolder(r.Thread.Cwd)
	if r.Branch != "" {
		f += " ⎇ " + r.Branch
	}
	return f
}

// layout picks the visible columns and their widths for a screen width.
// Every column starts at the width of its content; when that does not fit,
// the widest-above-minimum columns shrink first, and the optional columns
// (folder, then agent, then machine) go when even the minimums do not fit.
// Spare room goes to the activity column.
func (m *Model) layout(w int, rows []Row) []column {
	nat := func(f func(Row) string, min, max int) int {
		n := min
		for _, r := range rows {
			if x := strWidth(oneLine(f(r))); x > n {
				n = x
			}
		}
		if n > max {
			n = max
		}
		return n
	}
	timeW := nat(func(r Row) string { return r.TimeText(m.Now) }, 5, 10)
	defs := [numCols]column{
		colTitle:   {"SESSION", nat(func(r Row) string { return r.Thread.Title }, 12, 48), 14},
		colAgent:   {"AGENT", nat(rowAgent, 6, 22), 6},
		colMachine: {"MACHINE", nat(func(r Row) string { return r.Thread.DeviceName }, 7, 16), 7},
		colFolder:  {"FOLDER", nat(rowFolder, 10, 36), 12},
		colState:   {"STATE", 8, 8},
		colStep:    {"ACTIVITY", nat(func(r Row) string { return r.Act.Step }, 18, 60), 18},
		colTime:    {"TIME", timeW, timeW},
	}
	order := []int{colTitle, colAgent, colMachine, colFolder, colState, colStep, colTime}
	drop := []int{colFolder, colAgent, colMachine}
	for {
		minSum := 4 + 2*(len(order)-1) // margin, glyph and gaps
		for _, i := range order {
			minSum += defs[i].min
		}
		if minSum <= w || len(drop) == 0 {
			break
		}
		order = removeInt(order, drop[0])
		drop = drop[1:]
	}
	cols := make([]column, len(order))
	total := 4 + 2*(len(order)-1)
	for k, i := range order {
		cols[k] = defs[i]
		total += defs[i].w
	}
	for total > w {
		best, slack := -1, 0
		for k := range cols {
			if s := cols[k].w - cols[k].min; s > slack {
				best, slack = k, s
			}
		}
		if best < 0 {
			break
		}
		cols[best].w--
		total--
	}
	if total < w {
		for k := range cols {
			if cols[k].name == "ACTIVITY" {
				cols[k].w += w - total
			}
		}
	}
	return cols
}

func removeInt(s []int, v int) []int {
	out := make([]int, 0, len(s))
	for _, x := range s {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

func cell(s string, w int) string { return padRight(truncate(oneLine(s), w), w) }

func (m *Model) tableHeader(cols []column, w int) Line {
	l := Line{{" ", sHead}, {"  ", sHead}}
	for i, c := range cols {
		if i > 0 {
			l = append(l, Seg{"  ", sHead})
		}
		if c.name == "TIME" {
			l = append(l, Seg{padLeft(c.name, c.w), sHead})
			continue
		}
		l = append(l, Seg{cell(c.name, c.w), sHead})
	}
	return l.PadTo(w, sHead).Fit(w)
}

func (m *Model) rowLine(r Row, cols []column, w int, selected bool) Line {
	l := Line{{" ", ""}, m.glyph(r.Kind), {" ", ""}}
	for i, c := range cols {
		if i > 0 {
			l = append(l, Seg{"  ", ""})
		}
		switch c.name {
		case "SESSION":
			st := ""
			if r.Kind == KindWaiting {
				st = sBold
			}
			l = append(l, Seg{cell(r.Thread.Title, c.w), st})
		case "AGENT":
			agent := truncate(oneLine(r.Thread.Agent), c.w)
			l = append(l, Seg{agent, ""})
			rest := c.w - strWidth(agent)
			if r.Thread.Model != "" && rest > 2 {
				model := truncate(shortModel(oneLine(r.Thread.Model)), rest-1)
				l = append(l, Seg{" " + model, sGray}, Seg{strings.Repeat(" ", rest-1-strWidth(model)), ""})
			} else if rest > 0 {
				l = append(l, Seg{strings.Repeat(" ", rest), ""})
			}
		case "MACHINE":
			l = append(l, Seg{cell(r.Thread.DeviceName, c.w), sGray})
		case "FOLDER":
			l = append(l, Seg{cell(rowFolder(r), c.w), sGray})
		case "STATE":
			l = append(l, Seg{cell(r.StateText(), c.w), kindStyle(r.Kind)})
		case "ACTIVITY":
			st := sGray
			if r.Kind == KindWaiting {
				st = sAmber
			} else if r.Kind == KindWorking {
				st = ""
			}
			text := r.Act.Step
			if text == "" {
				text = "—"
			}
			l = append(l, Seg{cell(text, c.w), st})
		case "TIME":
			l = append(l, Seg{padLeft(r.TimeText(m.Now), c.w), sGray})
		}
	}
	if selected {
		sel := sSelBG
		if !m.Color {
			sel = "7"
		}
		l = l.PadTo(w, "").With(sel)
	}
	return l.Fit(w)
}

// --- header ---

func (m *Model) bar(frac float64, w int) Line {
	if frac < 0 {
		frac = 0
	}
	if frac > 1 {
		frac = 1
	}
	filled := int(frac*float64(w) + 0.5)
	st := sGreen
	switch {
	case frac >= 0.85:
		st = sRed
	case frac >= 0.6:
		st = sAmber
	}
	return Line{{strings.Repeat("█", filled), st}, {strings.Repeat("░", w-filled), sGray}}
}

func pct(f float64) string { return " " + padLeft(fmt.Sprintf("%d%%", int(f*100+0.5)), 4) }

func (m *Model) machineLine(mc Machine, nameW, barW, w int) Line {
	d := mc.Device
	dot := Seg{"●", sGreen}
	if !d.Online {
		dot = Seg{"○", sGray}
	}
	l := Line{{" ", ""}, dot, {" ", ""}, {cell(d.Name, nameW), ""}}
	if !d.Online {
		l = append(l, Seg{"  offline", sGray})
		if d.LastSeen > 0 {
			l = append(l, Seg{" · seen " + formatDuration(m.Now.UnixMilli()-d.LastSeen*unitMs(d.LastSeen)) + " ago", sGray})
		}
		return l.Fit(w)
	}
	if s := d.Stats; s != nil {
		cpu := s.CPUPercent / 100
		l = append(l, Seg{"  cpu ", sGray})
		l = append(l, m.bar(cpu, barW)...)
		l = append(l, Seg{pct(cpu), ""})
		if s.MemTotal > 0 && !unavailable(s, protocol.MetricMemory) {
			mem := float64(s.MemUsed) / float64(s.MemTotal)
			l = append(l, Seg{"  mem ", sGray})
			l = append(l, m.bar(mem, barW)...)
			l = append(l, Seg{pct(mem), ""})
		}
	} else {
		l = append(l, Seg{"  no stats yet", sGray})
	}
	var parts Line
	if mc.Waiting > 0 {
		parts = append(parts, Seg{fmt.Sprintf("%d waiting", mc.Waiting), sAmber})
	}
	if mc.Working > 0 {
		if len(parts) > 0 {
			parts = append(parts, Seg{" · ", sGray})
		}
		parts = append(parts, Seg{fmt.Sprintf("%d working", mc.Working), sBlue})
	}
	if len(parts) == 0 {
		parts = append(parts, Seg{fmt.Sprintf("%d session%s", mc.Total, plural(mc.Total)), sGray})
	}
	l = append(l, Seg{"   ", ""})
	l = append(l, parts...)
	return l.Fit(w)
}

// unitMs converts a stored last-seen stamp to milliseconds (the hub stores
// seconds; guard against either).
func unitMs(v int64) int64 {
	if v > 1e11 {
		return 1
	}
	return 1000
}

func unavailable(s *protocol.Stats, metric string) bool {
	for _, u := range s.Unavailable {
		if u == metric {
			return true
		}
	}
	return false
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func (m *Model) countsLine(c Counts) Line {
	l := Line{{" ", ""}}
	add := func(g, st, text string) {
		if len(l) > 1 {
			l = append(l, Seg{"   ", ""})
		}
		l = append(l, Seg{g, st}, Seg{" " + text, ""})
	}
	add("●", sAmber+";1", fmt.Sprintf("%d waiting", c.Waiting))
	add(m.spin(), sBlue, fmt.Sprintf("%d working", c.Working))
	add("✓", sGreen, fmt.Sprintf("%d done today", c.DoneToday))
	if c.Failed > 0 {
		add("✗", sRed, fmt.Sprintf("%d failed", c.Failed))
	}
	return l
}

// headerLines is the title, counts and one line per machine (at most
// maxMachines; the rest are summarised).
func (m *Model) headerLines(w, maxMachines int) []Line {
	title := Line{{" Overseer top", sBold}}
	if m.Snap.Hub != "" {
		title = append(title, Seg{"  " + m.Snap.Hub, sGray})
	}
	if m.Snap.Version != "" {
		title = append(title, Seg{"  v" + strings.TrimPrefix(m.Snap.Version, "v"), sGray})
	}
	clock := m.Now.Format("15:04:05") + " "
	if gap := w - title.Width() - strWidth(clock); gap > 0 {
		title = append(title, Seg{strings.Repeat(" ", gap), ""}, Seg{clock, sGray})
	}
	lines := []Line{title.Fit(w), m.countsLine(m.Snap.Counts(m.Now)).Fit(w)}

	machines := m.Snap.Machines
	extra := 0
	if maxMachines >= 0 && len(machines) > maxMachines {
		extra = len(machines) - (maxMachines - 1)
		machines = machines[:maxMachines-1]
	}
	nameW := 6
	for _, mc := range machines {
		if x := strWidth(mc.Device.Name); x > nameW {
			nameW = x
		}
	}
	if limit := 16 + max(0, w-100)/4; nameW > limit {
		nameW = min(limit, 30)
	}
	barW := 8
	switch {
	case w < 90:
		barW = 6
	case w >= 140:
		barW = 14
	case w >= 110:
		barW = 10
	}
	for _, mc := range machines {
		lines = append(lines, m.machineLine(mc, nameW, barW, w))
	}
	if extra > 0 {
		lines = append(lines, Line{{fmt.Sprintf("   +%d more machine%s", extra, plural(extra)), sGray}})
	}
	return lines
}

// --- main view ---

type keyHint struct{ key, label string }

func hintLine(hints []keyHint, w int) Line {
	// Too wide: drop hints from the middle, keeping help and quit last.
	for len(hints) > 2 {
		n := 1
		for _, h := range hints {
			n += strWidth(h.key) + 1 + strWidth(h.label) + 2
		}
		if n-2 <= w {
			break
		}
		hints = append(append([]keyHint{}, hints[:len(hints)-3]...), hints[len(hints)-2:]...)
	}
	l := Line{{" ", ""}}
	for i, h := range hints {
		if i > 0 {
			l = append(l, Seg{"  ", ""})
		}
		l = append(l, Seg{h.key, sBold}, Seg{" " + h.label, sGray})
	}
	return l.Fit(w)
}

var listHints = []keyHint{
	{"↑↓", "move"}, {"⏎", "detail"}, {"a", "answer"}, {"s", "steer"}, {"x", "stop"},
	{"/", "filter"}, {"o", "open"}, {"?", "help"}, {"q", "quit"},
}

var detailHints = []keyHint{
	{"↑↓", "scroll"}, {"⏎/esc", "back"}, {"a", "answer"}, {"s", "steer"}, {"x", "stop"},
	{"o", "open"}, {"?", "help"}, {"q", "quit"},
}

// Lines renders the whole screen as exactly H lines of at most W cells.
func (m *Model) Lines() []Line {
	w, h := m.W, m.H
	if w < 20 {
		w = 20
	}
	if h < 6 {
		h = 6
	}
	maxMachines := (h - 9) / 3
	if maxMachines < 1 {
		maxMachines = 1
	}
	if maxMachines > 6 {
		maxMachines = 6
	}
	lines := m.headerLines(w, maxMachines)
	footerRows := 2
	bodyH := h - len(lines) - footerRows
	if bodyH < 3 {
		bodyH = 3
	}

	var body []Line
	var status Line
	hints := listHints
	switch {
	case m.Overlay == OverlayHelp:
		body = m.helpLines(w)
		hints = []keyHint{{"any key", "close help"}}
	case m.Mode == ModeDetail:
		body = m.detailLines(w, bodyH)
		hints = detailHints
	default:
		body = m.listLines(w, bodyH)
	}
	// An approval chooser takes the bottom of the body.
	if m.Overlay == OverlayApprove {
		ov := m.approveLines(w)
		if len(ov) < bodyH {
			body = append(body[:min(len(body), bodyH-len(ov))], ov...)
		}
		hints = []keyHint{{"←→", "choose"}, {"1-9", "pick"}, {"⏎", "confirm"}, {"esc", "cancel"}}
	}
	for len(body) < bodyH {
		body = append(body, Line{})
	}
	if len(body) > bodyH {
		body = body[:bodyH]
	}
	lines = append(lines, body...)
	status = m.statusLine(w)
	switch m.Overlay {
	case OverlaySteer, OverlayFilter:
		hints = []keyHint{{"⏎", "send"}, {"esc", "cancel"}, {"^U", "clear"}}
		if m.Overlay == OverlayFilter {
			hints[0].label = "apply"
			hints[1].label = "clear"
		}
	case OverlayStop:
		hints = []keyHint{{"y", "stop it"}, {"any other key", "cancel"}}
	}
	lines = append(lines, status.Fit(w), hintLine(hints, w))
	return lines
}

func (m *Model) statusLine(w int) Line {
	switch m.Overlay {
	case OverlaySteer:
		title := ""
		if r, ok := m.Selected(); ok {
			title = truncate(oneLine(r.Thread.Title), 24)
		}
		return m.inputLine("steer "+title, w)
	case OverlayFilter:
		return m.inputLine("filter", w)
	case OverlayStop:
		title := ""
		if r, ok := m.Selected(); ok {
			title = truncate(oneLine(r.Thread.Title), max(10, w-44))
		}
		return Line{{" Stop the current turn of ", sAmber}, {"“" + title + "”", sBold}, {"?  ", sAmber}, {"y/N", sBold}}
	}
	if msg, isErr := m.Flashed(); isErr {
		return Line{{" " + oneLine(msg), sRed}}
	} else if msg != "" {
		return Line{{" " + oneLine(msg), sGreen}}
	}
	if m.Snap.Err != "" {
		return Line{{" ⚠ hub unreachable, retrying: " + oneLine(m.Snap.Err), sRed}}
	}
	rows := m.Rows()
	l := Line{{" ", ""}}
	if m.Filter != "" {
		l = append(l, Seg{"filter: ", sGray}, Seg{oneLine(m.Filter), sBold}, Seg{fmt.Sprintf("  (%d of %d, esc clears)", len(rows), len(m.Snap.Rows)), sGray})
		return l
	}
	if m.Snap.Loaded {
		l = append(l, Seg{fmt.Sprintf("%d session%s", len(rows), plural(len(rows))), sGray})
		if !m.Snap.At.IsZero() {
			l = append(l, Seg{" · updated " + m.Snap.At.Format("15:04:05"), sGray})
		}
	} else {
		l = append(l, Seg{"connecting to the hub…", sGray})
	}
	return l
}

func (m *Model) inputLine(label string, w int) Line {
	text := string(m.Input)
	room := w - strWidth(label) - 6
	if room < 4 {
		room = 4
	}
	// Show the tail of long input so the cursor stays visible.
	for strWidth(text) > room {
		_, size := firstRune(text)
		text = text[size:]
	}
	return Line{{" " + label + " › ", sAmber}, {text, ""}, {"█", sGray}}
}

func firstRune(s string) (rune, int) {
	for i, r := range s {
		_ = i
		return r, len(string(r))
	}
	return 0, 0
}

func (m *Model) listLines(w, h int) []Line {
	rows := m.Rows()
	cols := m.layout(w, rows)
	out := []Line{m.tableHeader(cols, w)}
	if !m.Snap.Loaded {
		return append(out, Line{{"", ""}}, Line{{"  Connecting to " + m.Snap.HubURL + "…", sGray}})
	}
	if len(rows) == 0 {
		msg := "  No agent sessions yet. Start one in the web UI or with `overseer fleet`."
		if m.Filter != "" {
			msg = "  No sessions match “" + oneLine(m.Filter) + "”."
		}
		return append(out, Line{}, Line{{msg, sGray}})
	}
	m.clamp(rows)
	avail := h - 1
	top := m.selIdx - avail + 1
	if top < 0 {
		top = 0
	}
	// Keep the viewport where it was when the selection is still inside it.
	if m.top < top {
		m.top = top
	}
	if m.selIdx < m.top {
		m.top = m.selIdx
	}
	if m.top > len(rows)-avail {
		m.top = max(0, len(rows)-avail)
	}
	for i := m.top; i < len(rows) && i < m.top+avail; i++ {
		out = append(out, m.rowLine(rows[i], cols, w, i == m.selIdx))
	}
	return out
}

// --- approval chooser ---

func (m *Model) approveLines(w int) []Line {
	row, ok := m.Selected()
	if !ok || row.Act.Pending == nil || row.Act.Pending.Approval == nil {
		return nil
	}
	ap := row.Act.Pending.Approval
	lines := []Line{{{strings.Repeat("─", w), sGray}}}
	lines = append(lines, Line{{" Approve? ", sAmber + ";1"}, {truncate(oneLine(ap.Title), w-12), sBold}})
	if d := wrap(ap.Detail, w-3); len(d) > 0 {
		for i, s := range d {
			if i == 2 {
				lines = append(lines, Line{{"  …", sGray}})
				break
			}
			lines = append(lines, Line{{"  " + s, sGray}})
		}
	}
	opt := Line{{" ", ""}}
	for i, o := range ap.Options {
		label := fmt.Sprintf(" %d %s ", i+1, oneLine(o.Label))
		st := optionStyle(o.Kind)
		if i == m.Choice {
			if m.Color {
				st = "1;38;5;16;48;5;" + optionBG(o.Kind)
			} else {
				st = "7"
			}
		}
		if i > 0 {
			opt = append(opt, Seg{"  ", ""})
		}
		opt = append(opt, Seg{label, st})
	}
	return append(lines, opt.Fit(w))
}

func optionStyle(kind string) string {
	if strings.HasPrefix(kind, "reject") {
		return sRed
	}
	return sGreen
}

func optionBG(kind string) string {
	if strings.HasPrefix(kind, "reject") {
		return "203"
	}
	return "78"
}

// --- help ---

func (m *Model) helpLines(w int) []Line {
	rows := [][2]string{
		{"↑ ↓  j k", "select a session (PgUp/PgDn, g/G jump)"},
		{"Enter", "details: recent steps and the last reply (scroll with ↑ ↓)"},
		{"a", "answer a waiting approval: Allow once / Always / Reject"},
		{"s", "steer: type a message and send it to the session"},
		{"x", "stop the session's current turn (asks first)"},
		{"/", "filter by title, agent, machine, folder, state"},
		{"o", "open the session in your browser"},
		{"r", "refresh now"},
		{"?", "this help"},
		{"q  Ctrl-C", "quit"},
	}
	out := []Line{{}, {{"  Keys", sBold}}, {}}
	for _, r := range rows {
		out = append(out, Line{{"  " + padRight(r[0], 12), sBold}, {truncate(r[1], w-16), ""}})
	}
	out = append(out, Line{}, Line{{"  ● waiting for you   ◐ working   ✓ done   ✗ failed   ■ stopped", sGray}})
	return out
}

// --- detail pane ---

func (m *Model) detailLines(w, h int) []Line {
	row, ok := m.Selected()
	if !ok {
		return []Line{{{"  No session selected.", sGray}}}
	}
	t := row.Thread
	var all []Line
	add := func(l ...Line) { all = append(all, l...) }
	g := m.glyph(row.Kind)
	add(Line{{" ", ""}, g, {" ", ""}, {truncate(oneLine(t.Title), w-4), sBold}})
	meta := []string{t.Agent}
	if t.Model != "" {
		meta = append(meta, shortModel(t.Model))
	}
	if t.DeviceName != "" {
		meta = append(meta, t.DeviceName)
	}
	if f := rowFolder(row); f != "" {
		meta = append(meta, f)
	}
	if t.Access != "" {
		meta = append(meta, "access "+t.Access)
	}
	state := row.StateText()
	add(Line{{"   ", ""}, {state, kindStyle(row.Kind)}, {"  " + truncate(oneLine(strings.Join(meta, " · ")), w-8-strWidth(state)), sGray}})
	if t.Cwd != "" {
		add(Line{{"   " + truncateMiddle(oneLine(t.Cwd), w-4), sGray}})
	}
	if u := t.Usage; u != nil && (u.InputTokens > 0 || u.OutputTokens > 0) {
		s := fmt.Sprintf("   tokens in %s · out %s", humanCount(u.InputTokens), humanCount(u.OutputTokens))
		if u.CostUsd > 0 {
			s += fmt.Sprintf(" · $%.2f", u.CostUsd)
		}
		add(Line{{s, sGray}})
	}
	add(Line{})

	if p := row.Act.Pending; p != nil {
		switch {
		case p.Approval != nil:
			add(Line{{" Waiting for your approval", sAmber + ";1"}})
			add(Line{{"  " + truncate(oneLine(p.Approval.Title), w-3), sBold}})
			for i, s := range wrap(p.Approval.Detail, w-3) {
				if i >= 6 {
					add(Line{{"  …", sGray}})
					break
				}
				add(Line{{"  " + s, sGray}})
			}
			var opts []string
			for i, o := range p.Approval.Options {
				opts = append(opts, fmt.Sprintf("%d %s", i+1, oneLine(o.Label)))
			}
			add(Line{{"  " + truncate(strings.Join(opts, "   "), w-3), sGreen}, {"   (press a)", sGray}})
		case p.Question != nil:
			add(Line{{" Asking a question (press o to answer in the browser)", sAmber + ";1"}})
			for _, s := range wrap(p.Question.Text, w-3) {
				add(Line{{"  " + s, ""}})
			}
		}
		add(Line{})
	}

	add(Line{{" Recent steps", sGray + ";1"}})
	if row.Msgs == nil {
		add(Line{{"  loading…", sGray}})
	} else if steps := recentSteps(row.Msgs, 14); len(steps) == 0 {
		add(Line{{"  none yet", sGray}})
	} else {
		for _, st := range steps {
			add(m.stepLineRender(st, w))
		}
	}
	add(Line{})
	add(Line{{" Last message", sGray + ";1"}})
	switch {
	case row.Msgs == nil:
		add(Line{{"  loading…", sGray}})
	case row.Act.LastText == "":
		add(Line{{"  nothing from the agent yet", sGray}})
	default:
		ws := wrap(row.Act.LastText, w-3)
		if len(ws) > 60 {
			ws = append(ws[:60], "…")
		}
		for _, s := range ws {
			add(Line{{"  " + s, ""}})
		}
	}
	if t.Error != "" {
		add(Line{}, Line{{" Error", sRed + ";1"}})
		for _, s := range wrap(t.Error, w-3) {
			add(Line{{"  " + s, sRed}})
		}
	}

	// Scroll within the body, leaving the last row for the position.
	view := h - 1
	maxScroll := len(all) - view
	if maxScroll < 0 {
		maxScroll = 0
	}
	if m.Scroll > maxScroll {
		m.Scroll = maxScroll
	}
	if m.Scroll < 0 {
		m.Scroll = 0
	}
	end := min(len(all), m.Scroll+view)
	out := append([]Line{}, all[m.Scroll:end]...)
	for len(out) < view {
		out = append(out, Line{})
	}
	pos := ""
	if maxScroll > 0 {
		pos = fmt.Sprintf(" lines %d-%d of %d", m.Scroll+1, end, len(all))
		if m.Scroll < maxScroll {
			pos += "  ↓ more"
		}
	}
	return append(out, Line{{pos, sGray}})
}

func humanCount(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1e6)
	case n >= 1000:
		return fmt.Sprintf("%.1fk", float64(n)/1e3)
	}
	return fmt.Sprint(n)
}

// --- recent steps ---

type recentStep struct {
	glyph Seg
	text  string
	style string
	at    int64
}

func recentSteps(msgs []threadMsg, n int) []recentStep {
	var out []recentStep
	for i := len(msgs) - 1; i >= 0 && len(out) < n; i-- {
		msg := msgs[i]
		switch msg.Role {
		case "tool":
			if msg.Tool == nil {
				continue
			}
			g := Seg{"✓", sGreen}
			switch stepState(msg) {
			case "running":
				g = Seg{"…", sBlue}
			case "error":
				g = Seg{"✗", sRed}
			}
			out = append(out, recentStep{g, stepLine(msg), "", msg.At})
		case "thought":
			out = append(out, recentStep{Seg{"·", sGray}, "Thinking", sGray, msg.At})
		case "user":
			out = append(out, recentStep{Seg{"›", sAmber}, oneLine(msg.Text), sBold, msg.At})
		case "error":
			out = append(out, recentStep{Seg{"✗", sRed}, oneLine(msg.Text), sRed, msg.At})
		}
	}
	// oldest first
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (m *Model) stepLineRender(s recentStep, w int) Line {
	age := ""
	if s.at > 0 {
		age = formatDuration(m.Now.UnixMilli()-s.at) + " ago"
	}
	room := w - 5 - strWidth(age) - 2
	text := truncate(s.text, max(room, 8))
	l := Line{{"  ", ""}, s.glyph, {" ", ""}, {text, s.style}}
	if gap := w - l.Width() - strWidth(age) - 1; gap > 0 && age != "" {
		l = append(l, Seg{strings.Repeat(" ", gap), ""}, Seg{age, sGray})
	}
	return l.Fit(w)
}

// --- output ---

// View renders the full screen as one string: home the cursor, then every
// line cleared to its end, so a refresh never flickers or leaves debris.
func (m *Model) View() string {
	var b strings.Builder
	b.WriteString("\x1b[H")
	for i, l := range m.Lines() {
		if i > 0 {
			b.WriteString("\r\n")
		}
		b.WriteString(l.Render(m.Color))
		b.WriteString("\x1b[K")
	}
	b.WriteString("\x1b[J")
	return b.String()
}

// PlainText is the one-shot table printed when stdout is not a terminal:
// no colour, no live elements, every session.
func PlainText(s Snapshot, width int, now time.Time) string {
	if width < 60 {
		width = 60
	}
	m := &Model{Snap: s, W: width, H: 1 << 20, Now: now, Static: true}
	var b strings.Builder
	for _, l := range m.headerLines(width, -1) {
		b.WriteString(strings.TrimRight(l.Plain(), " "))
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	rows := m.Rows()
	cols := m.layout(width, rows)
	b.WriteString(strings.TrimRight(m.tableHeader(cols, width).Plain(), " ") + "\n")
	for _, r := range rows {
		b.WriteString(strings.TrimRight(m.rowLine(r, cols, width, false).Plain(), " ") + "\n")
	}
	if len(rows) == 0 {
		b.WriteString("  (no agent sessions)\n")
	}
	return b.String()
}
