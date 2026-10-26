package top

import (
	"strings"
	"time"
)

// Mode is which main screen is showing.
type Mode int

const (
	ModeList Mode = iota
	ModeDetail
)

// Overlay is a prompt drawn over the bottom of the screen.
type Overlay int

const (
	OverlayNone Overlay = iota
	OverlayApprove
	OverlaySteer
	OverlayStop
	OverlayFilter
	OverlayHelp
)

// ActionKind is a side effect the key handler asks the run loop to do.
type ActionKind int

const (
	ActNone ActionKind = iota
	ActQuit
	ActRefresh
	ActApprove
	ActSteer
	ActStop
	ActOpen
)

// Action is one requested side effect.
type Action struct {
	Kind       ActionKind
	ThreadID   string
	Title      string
	ApprovalID string
	OptionID   string
	Label      string // human label of the chosen option
	Text       string
}

// Model is the whole screen state. It has no I/O: keys go in through
// HandleKey, snapshots through SetSnapshot, and View renders it.
type Model struct {
	Snap    Snapshot
	Mode    Mode
	Overlay Overlay
	Filter  string
	Input   []rune // text being typed for steer / filter
	Choice  int    // highlighted approval option
	Scroll  int    // detail pane scroll offset
	SelID   string
	selIdx  int
	top     int // first visible row of the list

	Flash      string
	FlashErr   bool
	FlashUntil time.Time

	W, H   int
	Color  bool
	Static bool // one-shot output: no animation
	Now    time.Time
}

// NewModel starts a model for a terminal of the given size.
func NewModel(w, h int, color bool) *Model {
	return &Model{W: w, H: h, Color: color, Now: time.Now()}
}

// Rows are the sessions that pass the filter.
func (m *Model) Rows() []Row {
	if strings.TrimSpace(m.Filter) == "" {
		return m.Snap.Rows
	}
	var out []Row
	for _, r := range m.Snap.Rows {
		if matchesFilter(r, m.Filter) {
			out = append(out, r)
		}
	}
	return out
}

// Selected returns the highlighted session, if any.
func (m *Model) Selected() (Row, bool) {
	rows := m.Rows()
	if len(rows) == 0 {
		return Row{}, false
	}
	m.clamp(rows)
	return rows[m.selIdx], true
}

// clamp keeps the selection on a real row, following the selected session
// when the list reorders.
func (m *Model) clamp(rows []Row) {
	for i, r := range rows {
		if r.Thread.Id == m.SelID {
			m.selIdx = i
			return
		}
	}
	if m.selIdx >= len(rows) {
		m.selIdx = len(rows) - 1
	}
	if m.selIdx < 0 {
		m.selIdx = 0
	}
	if len(rows) > 0 {
		m.SelID = rows[m.selIdx].Thread.Id
	} else {
		m.SelID = ""
	}
}

// SetSnapshot installs a refresh result, keeping the selection.
func (m *Model) SetSnapshot(s Snapshot) {
	m.Snap = s
	m.clamp(m.Rows())
}

// Resize records the terminal size.
func (m *Model) Resize(w, h int) { m.W, m.H = w, h }

func (m *Model) flash(msg string, isErr bool) {
	m.Flash, m.FlashErr = msg, isErr
	m.FlashUntil = m.Now.Add(4 * time.Second)
}

// Flashed reports the message still on display, if any.
func (m *Model) Flashed() (string, bool) {
	if m.Flash == "" || !m.Now.Before(m.FlashUntil) {
		return "", false
	}
	return m.Flash, m.FlashErr
}

// Notice lets the run loop report an action's outcome.
func (m *Model) Notice(msg string, isErr bool) { m.flash(msg, isErr) }

func (m *Model) move(delta int) {
	rows := m.Rows()
	if len(rows) == 0 {
		return
	}
	m.clamp(rows)
	i := m.selIdx + delta
	if i < 0 {
		i = 0
	}
	if i >= len(rows) {
		i = len(rows) - 1
	}
	m.selIdx = i
	m.SelID = rows[i].Thread.Id
}

// listPage is how far PgUp/PgDn move.
func (m *Model) listPage() int {
	if n := m.H - 8; n > 2 {
		return n
	}
	return 2
}

// HandleKey applies one key press and returns the side effect it asks for.
func (m *Model) HandleKey(k Key) Action {
	if k.Kind == KeyCtrlC {
		return Action{Kind: ActQuit}
	}
	switch m.Overlay {
	case OverlayApprove:
		return m.keyApprove(k)
	case OverlaySteer:
		return m.keySteer(k)
	case OverlayStop:
		return m.keyStop(k)
	case OverlayFilter:
		return m.keyFilter(k)
	case OverlayHelp:
		m.Overlay = OverlayNone
		return Action{}
	}
	if m.Mode == ModeDetail {
		if a, ok := m.keyDetail(k); ok {
			return a
		}
	}
	return m.keyCommon(k)
}

// keyDetail handles the keys that differ in the detail pane.
func (m *Model) keyDetail(k Key) (Action, bool) {
	switch k.Kind {
	case KeyUp:
		m.Scroll--
	case KeyDown:
		m.Scroll++
	case KeyPgUp:
		m.Scroll -= m.H - 6
	case KeyPgDn:
		m.Scroll += m.H - 6
	case KeyHome:
		m.Scroll = 0
	case KeyEnd:
		m.Scroll = 1 << 30
	case KeyEnter, KeyEsc, KeyBackspace, KeyLeft:
		m.Mode = ModeList
		return Action{}, true
	case KeyRune:
		switch k.R {
		case 'k':
			m.Scroll--
		case 'j':
			m.Scroll++
		case 'g':
			m.Scroll = 0
		case 'G':
			m.Scroll = 1 << 30
		case 'h':
			m.Mode = ModeList
		default:
			return Action{}, false
		}
	default:
		return Action{}, false
	}
	if m.Scroll < 0 {
		m.Scroll = 0
	}
	return Action{}, true
}

func (m *Model) keyCommon(k Key) Action {
	switch k.Kind {
	case KeyUp:
		m.move(-1)
	case KeyDown:
		m.move(1)
	case KeyPgUp:
		m.move(-m.listPage())
	case KeyPgDn:
		m.move(m.listPage())
	case KeyHome:
		m.move(-1 << 20)
	case KeyEnd:
		m.move(1 << 20)
	case KeyRight, KeyEnter:
		if _, ok := m.Selected(); ok {
			m.Mode = ModeDetail
			m.Scroll = 0
			return Action{Kind: ActRefresh}
		}
	case KeyEsc:
		if m.Filter != "" {
			m.Filter = ""
			m.clamp(m.Rows())
		}
	case KeyRune:
		return m.keyRune(k.R)
	}
	return Action{}
}

func (m *Model) keyRune(r rune) Action {
	switch r {
	case 'q', 'Q':
		return Action{Kind: ActQuit}
	case 'k':
		m.move(-1)
	case 'j':
		m.move(1)
	case 'g':
		m.move(-1 << 20)
	case 'G':
		m.move(1 << 20)
	case 'r':
		m.flash("refreshing…", false)
		return Action{Kind: ActRefresh}
	case '?':
		m.Overlay = OverlayHelp
	case '/':
		m.Overlay = OverlayFilter
		m.Input = []rune(m.Filter)
	case 'o':
		if row, ok := m.Selected(); ok {
			return Action{Kind: ActOpen, ThreadID: row.Thread.Id, Title: row.Thread.Title}
		}
	case 'a':
		return m.startApprove()
	case 's':
		if _, ok := m.Selected(); ok {
			m.Overlay = OverlaySteer
			m.Input = nil
		}
	case 'x':
		row, ok := m.Selected()
		switch {
		case !ok:
		case !row.Active():
			m.flash("that session is not running", true)
		default:
			m.Overlay = OverlayStop
		}
	}
	return Action{}
}

func (m *Model) startApprove() Action {
	row, ok := m.Selected()
	if !ok {
		return Action{}
	}
	switch {
	case row.Kind != KindWaiting:
		m.flash("nothing is waiting for approval on that session", true)
	case row.Act.Pending == nil:
		m.flash("loading the approval request…", false)
		return Action{Kind: ActRefresh}
	case row.Act.Pending.Question != nil:
		m.flash("that session is asking a question: press o to answer it in the browser", true)
	case row.Act.Pending.Approval == nil || len(row.Act.Pending.Approval.Options) == 0:
		m.flash("this approval has no options to choose from: press o to open it", true)
	default:
		m.Overlay = OverlayApprove
		m.Choice = 0
		for i, o := range row.Act.Pending.Approval.Options {
			if o.Kind == "allow_once" {
				m.Choice = i
				break
			}
		}
	}
	return Action{}
}

func (m *Model) keyApprove(k Key) Action {
	row, ok := m.Selected()
	if !ok || row.Act.Pending == nil || row.Act.Pending.Approval == nil {
		m.Overlay = OverlayNone
		return Action{}
	}
	opts := row.Act.Pending.Approval.Options
	switch k.Kind {
	case KeyEsc:
		m.Overlay = OverlayNone
	case KeyLeft, KeyShiftTab, KeyUp:
		m.Choice = (m.Choice + len(opts) - 1) % len(opts)
	case KeyRight, KeyTab, KeyDown:
		m.Choice = (m.Choice + 1) % len(opts)
	case KeyEnter:
		m.Overlay = OverlayNone
		o := opts[m.Choice]
		return Action{
			Kind: ActApprove, ThreadID: row.Thread.Id, Title: row.Thread.Title,
			ApprovalID: row.Act.Pending.Approval.Id, OptionID: o.Id, Label: o.Label,
		}
	case KeyRune:
		switch {
		case k.R == 'h':
			m.Choice = (m.Choice + len(opts) - 1) % len(opts)
		case k.R == 'l':
			m.Choice = (m.Choice + 1) % len(opts)
		case k.R == 'q':
			m.Overlay = OverlayNone
		case k.R >= '1' && k.R <= '9' && int(k.R-'1') < len(opts):
			m.Choice = int(k.R - '1')
		}
	}
	return Action{}
}

// editInput applies a text-editing key to Input; it reports whether the
// key was consumed.
func (m *Model) editInput(k Key) bool {
	switch k.Kind {
	case KeyRune:
		m.Input = append(m.Input, k.R)
	case KeyPaste:
		m.Input = append(m.Input, []rune(strings.Join(strings.Fields(strings.ReplaceAll(k.Text, "\r", "\n")), " "))...)
	case KeyBackspace:
		if len(m.Input) > 0 {
			m.Input = m.Input[:len(m.Input)-1]
		}
	case KeyCtrlU:
		m.Input = nil
	case KeyCtrlW:
		i := len(m.Input)
		for i > 0 && m.Input[i-1] == ' ' {
			i--
		}
		for i > 0 && m.Input[i-1] != ' ' {
			i--
		}
		m.Input = m.Input[:i]
	case KeyTab:
		m.Input = append(m.Input, ' ')
	default:
		return false
	}
	return true
}

func (m *Model) keySteer(k Key) Action {
	switch k.Kind {
	case KeyEsc:
		m.Overlay = OverlayNone
		m.Input = nil
	case KeyEnter:
		text := strings.TrimSpace(string(m.Input))
		m.Overlay = OverlayNone
		m.Input = nil
		row, ok := m.Selected()
		if text == "" || !ok {
			return Action{}
		}
		return Action{Kind: ActSteer, ThreadID: row.Thread.Id, Title: row.Thread.Title, Text: text}
	default:
		m.editInput(k)
	}
	return Action{}
}

func (m *Model) keyStop(k Key) Action {
	m.Overlay = OverlayNone
	if k.Kind == KeyRune && (k.R == 'y' || k.R == 'Y') {
		if row, ok := m.Selected(); ok {
			return Action{Kind: ActStop, ThreadID: row.Thread.Id, Title: row.Thread.Title}
		}
	}
	return Action{}
}

func (m *Model) keyFilter(k Key) Action {
	switch k.Kind {
	case KeyEsc:
		m.Overlay = OverlayNone
		m.Filter = ""
		m.Input = nil
	case KeyEnter:
		m.Overlay = OverlayNone
		m.Input = nil
	case KeyUp:
		m.move(-1)
	case KeyDown:
		m.move(1)
	default:
		if m.editInput(k) {
			m.Filter = string(m.Input)
		}
	}
	m.clamp(m.Rows())
	return Action{}
}
