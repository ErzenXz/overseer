package top

import (
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/ErzenXz/overseer/internal/fleet"
	"github.com/ErzenXz/overseer/internal/protocol"
)

// A simplified port of ui/src/lib/steps.ts: describe a tool call as one
// short line ("Reading auth.go", "Ran go test ./...").

var (
	shellWrap = regexp.MustCompile(`^(?:\S*/)?(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)['"]$`)
	leadingCd = regexp.MustCompile(`^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*`)
	multiCmd  = regexp.MustCompile(`&&|;|\n|\|\|`)
)

func unquote(s string) string {
	if len(s) >= 2 {
		q := s[0]
		if (q == '\'' || q == '"' || q == '`') && s[len(s)-1] == q {
			return s[1 : len(s)-1]
		}
	}
	return s
}

func baseName(p string) string {
	p = strings.TrimRight(p, "/")
	if p == "" {
		return ""
	}
	return path.Base(strings.ReplaceAll(p, "\\", "/"))
}

// cleanCommand drops a `bash -lc '...'` wrapper and a leading `cd dir &&`.
func cleanCommand(raw string) string {
	c := strings.TrimSpace(raw)
	if m := shellWrap.FindStringSubmatch(c); m != nil {
		c = strings.TrimSpace(m[2])
	}
	return leadingCd.ReplaceAllString(c, "")
}

func stripPrefix(title string, prefixes ...string) string {
	t := title
	for _, p := range prefixes {
		t = regexp.MustCompile(`(?i)^`+p+`\s+`).ReplaceAllString(t, "")
	}
	return strings.TrimSpace(t)
}

type toolInfo struct{ verb, verbing, target string }

var (
	readers   = map[string]bool{"cat": true, "head": true, "tail": true, "bat": true, "less": true, "nl": true}
	searchers = map[string]bool{"rg": true, "grep": true, "ag": true, "ack": true}
	listers   = map[string]bool{"ls": true, "tree": true, "fd": true, "find": true}
)

func classifyCommand(command string) toolInfo {
	first := strings.SplitN(command, "\n", 2)[0]
	generic := toolInfo{"Ran", "Running", first}
	if multiCmd.MatchString(command) {
		return generic
	}
	seg := strings.TrimSpace(strings.SplitN(command, "|", 2)[0])
	words := strings.Fields(seg)
	if len(words) == 0 {
		return generic
	}
	bin := path.Base(words[0])
	var args []string
	for _, w := range words[1:] {
		if !strings.HasPrefix(w, "-") {
			args = append(args, w)
		}
	}
	last := func() string { return baseName(unquote(args[len(args)-1])) }
	switch {
	case bin == "git" && len(words) > 1 && words[1] == "grep" && len(args) > 1:
		return toolInfo{"Searched for", "Searching for", unquote(args[1])}
	case readers[bin] && len(args) > 0:
		return toolInfo{"Read", "Reading", last()}
	case bin == "sed" && len(args) >= 2 && containsWord(words, "-n"):
		return toolInfo{"Read", "Reading", last()}
	case searchers[bin] && len(args) > 0:
		return toolInfo{"Searched for", "Searching for", unquote(args[0])}
	case bin == "find" || bin == "fd":
		return toolInfo{"Searched files", "Searching files", ""}
	case listers[bin]:
		t := "the folder"
		if len(args) > 0 {
			t = last()
		}
		return toolInfo{"Listed", "Listing", t}
	}
	return generic
}

func containsWord(words []string, w string) bool {
	for _, x := range words {
		if x == w {
			return true
		}
	}
	return false
}

func describeTool(t *protocol.ThreadTool) toolInfo {
	if t == nil {
		return toolInfo{"", "", "Step"}
	}
	title, input := t.Title, t.Input
	switch t.Name {
	case "bash":
		cmd := cleanCommand(input)
		if cmd == "" {
			cmd = title
		}
		return classifyCommand(cmd)
	case "read":
		p := input
		if p == "" {
			p = stripPrefix(title, `Read(ing)?`)
		}
		return toolInfo{"Read", "Reading", orDefault(baseName(p), "file")}
	case "edit", "write":
		wrote := t.Name == "write"
		target := ""
		switch {
		case len(t.Files) > 1:
			target = strconv.Itoa(len(t.Files)) + " files"
		case len(t.Files) == 1:
			target = baseName(t.Files[0].Path)
		default:
			p := input
			if p == "" {
				p = stripPrefix(title, `(Edit|Write)(ing)?`)
			}
			target = baseName(p)
		}
		target = orDefault(target, "files")
		if wrote {
			return toolInfo{"Wrote", "Writing", target}
		}
		return toolInfo{"Edited", "Editing", target}
	case "grep":
		return toolInfo{"Searched for", "Searching for", orDefault(stripPrefix(title, `Search(ed|ing)?( for)?`), input)}
	case "glob":
		return toolInfo{"Searched files", "Searching files", orDefault(stripPrefix(title, `(Find|Found|Search(ed|ing)?( for)?)`), input)}
	case "webfetch":
		u := input
		if u == "" {
			u = stripPrefix(title, `Fetch(ed|ing)?`)
		}
		u = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://"), "/")
		return toolInfo{"Fetched", "Fetching", u}
	case "websearch":
		return toolInfo{"Searched the web for", "Searching the web for", input}
	case "mcp":
		return toolInfo{"Used", "Using", title}
	}
	if t.Agent != nil {
		label := orDefault(t.Agent.Name, orDefault(t.Agent.Type, "subagent"))
		return toolInfo{"Ran agent", "Running agent", strings.TrimSpace(label + " " + t.Agent.Task)}
	}
	return toolInfo{"", "", orDefault(title, orDefault(t.Name, "Step"))}
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

// stepLine is one tool call as "Reading auth.go" (running) or "Read auth.go".
func stepLine(msg fleet.ThreadMessage) string {
	info := describeTool(msg.Tool)
	verb := info.verb
	if msg.Tool != nil && msg.Tool.Status == "running" {
		verb = info.verbing
	}
	return oneLine(strings.TrimSpace(verb + " " + info.target))
}

// stepState says how a tool call ended: running, done, error.
func stepState(msg fleet.ThreadMessage) string {
	if msg.Tool == nil {
		return "done"
	}
	switch msg.Tool.Status {
	case "running":
		return "running"
	case "error":
		return "error"
	}
	return "done"
}

// --- session activity ---

// Pending is what a waiting session is blocked on.
type Pending struct {
	Approval *protocol.ThreadApprovalRequest // set for permission requests
	Question *protocol.ThreadQuestion        // set for questions (answer in the browser)
	At       int64
}

// Activity is what the hub's transcript says a session is doing right now.
type Activity struct {
	Step      string   // "Reading auth.go"
	Pending   *Pending // when the session is waiting on you
	TurnStart int64    // unix ms the current turn began
	LastText  string   // last assistant message
	LastError string
}

func deriveActivity(t fleet.Thread, msgs []fleet.ThreadMessage) Activity {
	var a Activity
	a.TurnStart = t.CreatedAt
	for i := len(msgs) - 1; i >= 0; i-- {
		if m := msgs[i]; m.Role == "user" && !m.Queued {
			a.TurnStart = m.At
			break
		}
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if a.LastText == "" && m.Role == "assistant" && strings.TrimSpace(m.Text) != "" && m.ParentId == "" {
			a.LastText = m.Text
		}
		if a.LastError == "" && m.Role == "error" && m.Text != "" {
			a.LastError = m.Text
		}
		if a.Pending == nil && t.Status == "waiting" {
			if m.Role == "approval" && m.Approval != nil && m.Approval.Resolved == "" {
				a.Pending = &Pending{Approval: m.Approval, At: m.At}
			} else if m.Role == "question" && m.Question != nil && len(m.Question.Answered) == 0 {
				a.Pending = &Pending{Question: m.Question, At: m.At}
			}
		}
	}
	switch t.Status {
	case "waiting":
		switch {
		case a.Pending != nil && a.Pending.Approval != nil:
			a.Step = oneLine(a.Pending.Approval.Title)
		case a.Pending != nil && a.Pending.Question != nil:
			a.Step = oneLine(a.Pending.Question.Text)
		}
	case "working", "starting":
		a.Step = currentStep(msgs)
	case "idle":
		if a.LastText != "" {
			a.Step = oneLine(a.LastText)
		}
	case "error":
		a.Step = oneLine(orDefault(t.Error, a.LastError))
	}
	return a
}

// currentStep derives the live activity from the newest transcript item
// that is a step: tool call, thinking, or reply text.
func currentStep(msgs []fleet.ThreadMessage) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		switch m.Role {
		case "tool":
			if m.Tool != nil {
				return stepLine(m)
			}
		case "thought":
			return "Thinking…"
		case "assistant":
			return "Writing…"
		case "plan":
			return "Planning…"
		case "user":
			return "Starting…"
		}
	}
	return "Starting…"
}
