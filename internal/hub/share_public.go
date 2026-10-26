package hub

import (
	"strings"
	"unicode/utf8"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// What a public link may show. Every type here is an allow-list: fields are
// copied across one by one, run through redaction (and, when asked, name
// scrubbing), and anything not named here (approvals, questions, images,
// device ids, usage, pull request links, the session id) is simply absent.

// Caps on what one message can carry into a shared page.
const (
	capText   = 120 << 10
	capOutput = 16 << 10
	capInput  = 4 << 10
	capDiff   = 48 << 10
	capShort  = 600
	maxShared = 6000 // messages
)

type publicThread struct {
	Title      string `json:"title"`
	Agent      string `json:"agent"`
	AgentName  string `json:"agentName"`
	Model      string `json:"model,omitempty"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	DeviceName string `json:"deviceName"` // empty when names are hidden
	Cwd        string `json:"cwd"`        // empty when names are hidden
}

type publicSummary struct {
	Steps      int   `json:"steps"`
	Files      int   `json:"files"`
	Additions  int   `json:"additions"`
	Deletions  int   `json:"deletions"`
	Turns      int   `json:"turns"`
	DurationMs int64 `json:"durationMs"`
}

type publicShare struct {
	Mode      string          `json:"mode"`
	HideNames bool            `json:"hideNames"`
	ExpiresAt int64           `json:"expiresAt"`
	Thread    publicThread    `json:"thread"`
	Summary   publicSummary   `json:"summary"`
	Messages  []ThreadMessage `json:"messages"`
}

// publicizer turns stored messages into what a viewer may see.
type publicizer struct {
	scrub     *nameScrubber // nil when names stay
	agent     string
	agentName string
	hide      bool
	device    string
	cwd       string
}

func (s *Server) agentDisplayName(id string) string {
	for _, a := range s.agents.list() {
		if a.Id == id {
			return a.Name
		}
	}
	return id
}

func (s *Server) newSharePublicizer(t *Thread, hide bool) *publicizer {
	p := &publicizer{agent: t.Agent, agentName: s.agentDisplayName(t.Agent), hide: hide, device: t.DeviceName, cwd: t.Cwd}
	if hide {
		names := []string{t.DeviceName}
		if d, err := s.store.DeviceById(t.DeviceId); err == nil && d != nil {
			names = append(names, d.Hostname)
		}
		p.scrub = newNameScrubber(t.Cwd, names...)
	}
	return p
}

func clipShared(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "\n…"
}

// text redacts, scrubs and caps one string.
func (p *publicizer) text(s string, max int) string {
	if s == "" {
		return s
	}
	return clipShared(p.scrub.scrub(redactSecrets(s)), max)
}

func (p *publicizer) thread(t *Thread) publicThread {
	out := publicThread{
		Title: strings.TrimSpace(p.text(t.Title, capShort)), Agent: t.Agent, AgentName: p.agentName, Model: t.Model,
		Status: t.Status, Error: p.text(t.Error, capShort), CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
	if !p.hide {
		out.DeviceName, out.Cwd = t.DeviceName, t.Cwd
	}
	return out
}

// message returns the public copy of m, or nil when it must not be shown.
func (p *publicizer) message(m ThreadMessage) *ThreadMessage {
	switch m.Role {
	case "user", "assistant", "thought", "tool", "plan", "error", "status":
	default:
		return nil // approvals and questions are the owner's to answer
	}
	if m.Role == "user" && m.Queued {
		return nil
	}
	out := ThreadMessage{
		Id: m.Id, Seq: m.Seq, At: m.At, UpdatedAt: m.UpdatedAt, Role: m.Role,
		Text: p.text(m.Text, capText), Turn: m.Turn, DurationMs: m.DurationMs, ParentId: m.ParentId,
	}
	if m.Tool != nil {
		t := protocol.ThreadTool{
			Name: m.Tool.Name, Title: p.text(m.Tool.Title, capShort), Status: m.Tool.Status,
			Input: p.text(m.Tool.Input, capInput), Output: p.text(m.Tool.Output, capOutput),
		}
		for _, f := range m.Tool.Files {
			t.Files = append(t.Files, protocol.ThreadToolFile{
				Path: p.text(f.Path, capShort), Additions: f.Additions, Deletions: f.Deletions, Diff: p.text(f.Diff, capDiff),
			})
		}
		if a := m.Tool.Agent; a != nil {
			t.Agent = &protocol.ThreadAgent{
				Type: a.Type, Name: a.Name, Task: p.text(a.Task, capShort), Prompt: p.text(a.Prompt, capInput),
				Result: p.text(a.Result, capText), Model: a.Model, Tools: a.Tools, Tokens: a.Tokens,
				DurationMs: a.DurationMs, Background: a.Background,
			}
		}
		out.Tool = &t
	}
	for _, e := range m.Plan {
		out.Plan = append(out.Plan, protocol.PlanEntry{Content: p.text(e.Content, capShort), Status: e.Status})
	}
	return &out
}

// buildPublic assembles the page data for a share. When freeze is true the
// session is shown as stopped, since a snapshot never sees it move again.
func (s *Server) buildPublic(t *Thread, sh *Share, freeze bool) (*publicShare, error) {
	msgs, err := s.store.ThreadMessages(t.Id)
	if err != nil {
		return nil, err
	}
	p := s.newSharePublicizer(t, sh.HideNames)
	if len(msgs) > maxShared {
		msgs = msgs[len(msgs)-maxShared:]
	}
	out := &publicShare{Mode: sh.Mode, HideNames: sh.HideNames, ExpiresAt: sh.ExpiresAt, Messages: []ThreadMessage{}}
	for _, m := range msgs {
		if pm := p.message(m); pm != nil {
			out.Messages = append(out.Messages, *pm)
		}
	}
	out.Thread = p.thread(t)
	if freeze && (out.Thread.Status == "working" || out.Thread.Status == "starting" || out.Thread.Status == "waiting") {
		out.Thread.Status = "idle"
	}
	out.Summary = summarizeShare(out.Messages)
	return out, nil
}

// summarizeShare counts what the session did, for the page header and link previews.
func summarizeShare(msgs []ThreadMessage) publicSummary {
	var sum publicSummary
	files := map[string]bool{}
	var first, last, turns int64
	for _, m := range msgs {
		if first == 0 || m.At < first {
			first = m.At
		}
		if m.UpdatedAt > last {
			last = m.UpdatedAt
		}
		switch m.Role {
		case "user":
			sum.Turns++
		case "assistant", "status":
			turns += m.DurationMs
		case "tool":
			sum.Steps++
			if m.Tool != nil {
				for _, f := range m.Tool.Files {
					files[f.Path] = true
					sum.Additions += f.Additions
					sum.Deletions += f.Deletions
				}
			}
		}
	}
	sum.Files = len(files)
	// Time the agent spent working; idle gaps between turns don't count.
	if turns > 0 {
		sum.DurationMs = turns
	} else if last > first {
		sum.DurationMs = last - first
	}
	return sum
}
