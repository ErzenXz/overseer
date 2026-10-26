package hub

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Continue in another agent: when one agent is stuck (or out of plan limit),
// carry on in a different one. The hub condenses the transcript into a prompt
// the person can edit, starts a new session with it, and remembers the link so
// both sessions can point at each other.

const (
	contCap       = 24 * 1024 // longest prompt
	contGoalCap   = 1500
	contRecent    = 4 // turns shown in detail; older ones get a short line
	contMaxFiles  = 30
	contStatLines = 40
)

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS thread_continuations (
	to_id      TEXT PRIMARY KEY,
	from_id    TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS thread_continuations_from ON thread_continuations(from_id);
`)
}

// contInput is what the prompt is built from.
type contInput struct {
	Thread    *Thread
	Messages  []ThreadMessage
	FromName  string // "Claude Code"
	ToName    string // "Codex"
	DiffStat  string // output of git diff --stat on the machine, if it could be read
	GitStatus string // output of git status --short
	Note      string // extra instructions from the person
}

type contFile struct {
	Path      string `json:"path"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type contTurn struct {
	Ask    string
	Answer string // the last assistant message of the turn ("" when unfinished)
}

type contPlanItem struct{ Content, Status string }

// contStats is a one-line summary of what went into the prompt.
type contStats struct {
	Turns     int  `json:"turns"`
	Files     int  `json:"files"`
	PlanDone  int  `json:"planDone"`
	PlanTotal int  `json:"planTotal"`
	LastError bool `json:"lastError"`
	DiffStat  bool `json:"diffStat"`
}

// clipBlock shortens s to about n bytes on a rune boundary, keeping line
// breaks (clipText flattens them).
func clipBlock(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return strings.TrimSpace(s[:cut]) + "…"
}

// contTurns splits the transcript into turns: each sent user message and the
// last thing the assistant said before the next one.
func contTurns(msgs []ThreadMessage) []contTurn {
	var turns []contTurn
	for _, m := range msgs {
		switch {
		case isSentUser(m):
			turns = append(turns, contTurn{Ask: strings.TrimSpace(m.Text)})
		case m.Role == "assistant" && m.ParentId == "" && len(turns) > 0:
			if t := strings.TrimSpace(m.Text); t != "" {
				turns[len(turns)-1].Answer = t
			}
		}
	}
	return turns
}

// contFiles totals the edits the agent recorded, per file, in the order the
// files were first touched.
func contFiles(msgs []ThreadMessage) []contFile {
	var out []contFile
	index := map[string]int{}
	for _, m := range msgs {
		if m.Tool == nil {
			continue
		}
		for _, f := range m.Tool.Files {
			if f.Path == "" {
				continue
			}
			i, ok := index[f.Path]
			if !ok {
				i = len(out)
				index[f.Path] = i
				out = append(out, contFile{Path: f.Path})
			}
			out[i].Additions += f.Additions
			out[i].Deletions += f.Deletions
		}
	}
	return out
}

// lastTurnMessages returns the messages from the last sent user message on.
func lastTurnMessages(msgs []ThreadMessage) []ThreadMessage {
	start := -1
	for i, m := range msgs {
		if isSentUser(m) {
			start = i
		}
	}
	if start < 0 {
		return nil
	}
	return msgs[start:]
}

// contLastError finds the last error of the final turn: an error message, a
// failed tool call, or the error the thread itself ended with.
func contLastError(t *Thread, msgs []ThreadMessage) string {
	last := lastTurnMessages(msgs)
	for i := len(last) - 1; i >= 0; i-- {
		if m := last[i]; m.Role == "error" && strings.TrimSpace(m.Text) != "" {
			return clipBlock(m.Text, 700)
		}
	}
	for i := len(last) - 1; i >= 0; i-- {
		if m := last[i]; m.Role == "tool" && m.Tool != nil && m.Tool.Status == "error" {
			text := m.Tool.Title
			if out := strings.TrimSpace(m.Tool.Output); out != "" {
				text += ": " + clipBlock(out, 500)
			}
			return text
		}
	}
	if t != nil && t.Status == "error" && strings.TrimSpace(t.Error) != "" {
		return clipBlock(t.Error, 700)
	}
	return ""
}

func contLastPlan(msgs []ThreadMessage) []contPlanItem {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "plan" && len(msgs[i].Plan) > 0 {
			out := make([]contPlanItem, len(msgs[i].Plan))
			for j, p := range msgs[i].Plan {
				out[j] = contPlanItem{Content: p.Content, Status: p.Status}
			}
			return out
		}
	}
	return nil
}

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\r\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// buildContinuePrompt renders the prompt and a summary of what it holds.
func buildContinuePrompt(in contInput) (string, contStats) {
	var b strings.Builder
	var stats contStats
	turns := contTurns(in.Messages)
	stats.Turns = len(turns)
	from, to := in.FromName, in.ToName
	if from == "" {
		from = "another agent"
	}
	cwd := ""
	if in.Thread != nil {
		cwd = in.Thread.Cwd
	}

	b.WriteString("You are taking over a coding task from " + from)
	if to != "" {
		b.WriteString(" (you are " + to + ")")
	}
	b.WriteString(". Carry on in the same folder")
	if cwd != "" {
		b.WriteString(" (" + cwd + ")")
	}
	b.WriteString(" from where it left off. Do not redo finished work.\n\n")

	b.WriteString("## Original goal\n")
	if len(turns) > 0 {
		b.WriteString(clipBlock(turns[0].Ask, contGoalCap) + "\n\n")
	} else if in.Thread != nil {
		b.WriteString(in.Thread.Title + "\n\n")
	}

	if len(turns) > 0 {
		b.WriteString("## What happened so far\n")
		for i, t := range turns {
			recent := i >= len(turns)-contRecent
			askCap, ansCap := 160, 240
			if recent {
				askCap, ansCap = 400, 900
			}
			ask := clipText(t.Ask, askCap)
			switch {
			case t.Answer == "":
				fmt.Fprintf(&b, "%d. Asked: %s\n   Result: no final answer (interrupted or stuck).\n", i+1, ask)
			case recent:
				fmt.Fprintf(&b, "%d. Asked: %s\n   Result: %s\n", i+1, ask, strings.ReplaceAll(clipBlock(t.Answer, ansCap), "\n", "\n   "))
			default:
				fmt.Fprintf(&b, "%d. Asked: %s\n   Result: %s\n", i+1, ask, clipText(t.Answer, ansCap))
			}
		}
		b.WriteString("\n")
	}

	files := contFiles(in.Messages)
	stats.Files = len(files)
	stat := strings.TrimSpace(in.DiffStat)
	stats.DiffStat = stat != ""
	if len(files) > 0 || stat != "" || strings.TrimSpace(in.GitStatus) != "" {
		b.WriteString("## Files changed\n")
		for i, f := range files {
			if i == contMaxFiles {
				fmt.Fprintf(&b, "- …and %d more\n", len(files)-contMaxFiles)
				break
			}
			if f.Additions != 0 || f.Deletions != 0 {
				fmt.Fprintf(&b, "- %s (+%d −%d)\n", f.Path, f.Additions, f.Deletions)
			} else {
				fmt.Fprintf(&b, "- %s\n", f.Path)
			}
		}
		if stat != "" {
			b.WriteString("\nCurrent `git diff --stat`:\n```\n" + tailLines(stat, contStatLines) + "\n```\n")
		}
		if st := strings.TrimSpace(in.GitStatus); st != "" {
			b.WriteString("\nCurrent `git status --short`:\n```\n" + tailLines(st, contStatLines) + "\n```\n")
		}
		b.WriteString("\n")
	}

	plan := contLastPlan(in.Messages)
	stats.PlanTotal = len(plan)
	var left []string
	if len(plan) > 0 {
		b.WriteString("## Current plan\n")
		for _, p := range plan {
			mark := "[ ]"
			switch p.Status {
			case "completed":
				mark = "[x]"
				stats.PlanDone++
			case "in_progress":
				mark = "[~]"
			}
			if p.Status != "completed" && len(left) < 8 {
				left = append(left, p.Content)
			}
			fmt.Fprintf(&b, "- %s %s\n", mark, clipText(p.Content, 200))
		}
		b.WriteString("([x] done, [~] in progress, [ ] to do)\n\n")
	}

	lastErr := contLastError(in.Thread, in.Messages)
	stats.LastError = lastErr != ""
	if lastErr != "" {
		b.WriteString("## Last error\n```\n" + lastErr + "\n```\n\n")
	}

	b.WriteString("## What is left\n")
	switch {
	case len(left) > 0:
		for _, item := range left {
			b.WriteString("- " + clipText(item, 200) + "\n")
		}
	case len(turns) > 0 && turns[len(turns)-1].Answer == "":
		b.WriteString("- Finish the last request: " + clipText(turns[len(turns)-1].Ask, 300) + "\n")
	default:
		b.WriteString("- Check the work against the original goal and finish anything missing.\n")
	}
	if lastErr != "" {
		b.WriteString("- Work out why the last step failed and fix it.\n")
	}
	b.WriteString("\n")

	if note := strings.TrimSpace(in.Note); note != "" {
		b.WriteString("## Extra instructions\n" + clipBlock(note, 2000) + "\n\n")
	}
	b.WriteString("Start by running `git status` and `git diff` to see the current state of the folder, then continue.")

	out := b.String()
	if len(out) > contCap {
		out = clipBlock(out, contCap)
	}
	return out, stats
}

// --- HTTP ---

type contReq struct {
	Agent string `json:"agent"`
	Note  string `json:"note"`
	// MessageId limits the handoff to the conversation up to and including the
	// turn that holds this message.
	MessageId string `json:"messageId"`
	Prompt    string `json:"prompt"`
	Command   string `json:"command"` // only for the generic "acp" agent
	Title     string `json:"title"`
	Model     string `json:"model"`
	Effort    string `json:"effort"`
	Fast      bool   `json:"fast"`
	Mode      string `json:"mode"`
	Access    string `json:"access"`
	// DeviceId and Cwd default to the source session's.
	DeviceId        string `json:"deviceId"`
	Cwd             string `json:"cwd"`
	ClientRequestId string `json:"clientRequestId"`
}

// gitOutput runs a git command on the session's machine, best effort.
func (s *Server) gitOutput(t *Thread, command string) string {
	c := s.registry.get(t.DeviceId)
	if c == nil || t.Cwd == "" || strings.HasPrefix(t.Cwd, "~") {
		return ""
	}
	res, err := s.execOnDevice(c, command, t.Cwd, 8)
	if err != nil || res.ExitCode != 0 {
		return ""
	}
	return strings.TrimSpace(res.Stdout)
}

func (s *Server) contInputFor(t *Thread, to, note, messageId string, withGit bool) (contInput, error) {
	msgs, err := s.store.ThreadMessages(t.Id)
	if err != nil {
		return contInput{}, err
	}
	if messageId != "" {
		kept, _, _, ok := forkCut(msgs, messageId)
		if !ok {
			return contInput{}, errMessageNotFound
		}
		msgs = kept
	}
	in := contInput{Thread: t, Messages: msgs, FromName: agentName(s, t.Agent), Note: note}
	if to != "" {
		in.ToName = agentName(s, to)
	}
	if withGit {
		in.DiffStat = s.gitOutput(t, "git diff --stat HEAD")
		in.GitStatus = s.gitOutput(t, "git status --short")
	}
	return in, nil
}

var errMessageNotFound = errors.New("message not found")

func contTitle(title string) string {
	title = strings.TrimSpace(title)
	if strings.HasPrefix(title, "Continue: ") {
		return title
	}
	out := "Continue: " + title
	if len(out) > 200 {
		out = strings.TrimSpace(out[:200])
	}
	return out
}

func (s *Server) handleContinuePreview(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req contReq
	if r.ContentLength != 0 {
		if err := readJSON(r, &req); err != nil {
			httpError(w, http.StatusBadRequest, "invalid request")
			return
		}
	}
	in, err := s.contInputFor(t, strings.TrimSpace(req.Agent), req.Note, strings.TrimSpace(req.MessageId), true)
	if errors.Is(err, errMessageNotFound) {
		httpError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	prompt, stats := buildContinuePrompt(in)
	writeJSON(w, map[string]any{
		"prompt": prompt,
		"title":  contTitle(t.Title),
		"files":  contFiles(in.Messages),
		"stats":  stats,
	})
}

// handleContinueStart starts the new session from the (edited) prompt and links
// the two. A guardrail may hold it (answered 202, like POST /api/threads).
func (s *Server) handleContinueStart(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req contReq
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Prompt) == "" {
		httpError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	in := threadInput{
		DeviceId: req.DeviceId, Agent: req.Agent, Command: req.Command, Cwd: req.Cwd, Prompt: req.Prompt, Model: req.Model, Effort: req.Effort,
		Fast: req.Fast, Mode: req.Mode, Access: req.Access, Title: req.Title, ClientRequestId: req.ClientRequestId,
	}
	if strings.TrimSpace(in.DeviceId) == "" {
		in.DeviceId = t.DeviceId
	}
	if strings.TrimSpace(in.Cwd) == "" && in.DeviceId == t.DeviceId {
		in.Cwd = t.Cwd
	}
	if strings.TrimSpace(in.Title) == "" {
		in.Title = contTitle(t.Title)
	}
	if in.Access == "" && in.Mode == "" {
		in.Access = t.Access
	}
	if msg := in.validate(s.agents); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if in.ClientRequestId != "" {
		if existing, err := s.store.ThreadByRequestId(in.ClientRequestId); err == nil && existing != nil {
			w.Header().Set("Idempotent-Replayed", "true")
			writeJSON(w, existing)
			return
		}
	}
	if s.holdNewSession(w, in) {
		return
	}
	nt, replayed, err := s.startThreadOnce(in)
	switch {
	case errors.Is(err, errDeviceOffline):
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	case errors.Is(err, errBadStart):
		httpError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), errBadStart.Error()+": "))
		return
	case err != nil:
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !replayed {
		s.linkContinuation(t, nt)
	}
	writeJSON(w, nt)
}

func contStatus(text string) protocol.ThreadEvent {
	return protocol.ThreadEvent{Id: "s-" + randomToken()[:12], Role: "status", Text: text}
}

// linkContinuation records that to continues from and says so in both
// transcripts.
func (s *Server) linkContinuation(from, to *Thread) {
	if _, err := s.store.db.Exec(`INSERT OR IGNORE INTO thread_continuations (to_id, from_id, created_at) VALUES (?, ?, ?)`,
		to.Id, from.Id, time.Now().Unix()); err != nil {
		return
	}
	s.threads.appendEvent(to.Id, contStatus("Continued from “"+from.Title+"” ("+agentName(s, from.Agent)+")."))
	s.threads.appendEvent(from.Id, contStatus("Continued in “"+to.Title+"” ("+agentName(s, to.Agent)+")."))
}

type contLink struct {
	Id     string `json:"id"`
	Title  string `json:"title"`
	Agent  string `json:"agent"`
	Status string `json:"status"`
}

func (s *Server) handleContinueLinks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	link := func(threadId string) *contLink {
		t, err := s.store.ThreadById(threadId)
		if err != nil || t == nil {
			return nil
		}
		return &contLink{Id: t.Id, Title: t.Title, Agent: t.Agent, Status: t.Status}
	}
	out := struct {
		From *contLink  `json:"from"`
		To   []contLink `json:"to"`
	}{To: []contLink{}}
	var fromId string
	if err := s.store.db.QueryRow(`SELECT from_id FROM thread_continuations WHERE to_id = ?`, id).Scan(&fromId); err == nil {
		out.From = link(fromId)
	}
	rows, err := s.store.db.Query(`SELECT to_id FROM thread_continuations WHERE from_id = ? ORDER BY created_at`, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var ids []string
	for rows.Next() {
		var to string
		if rows.Scan(&to) == nil {
			ids = append(ids, to)
		}
	}
	rows.Close()
	for _, to := range ids {
		if l := link(to); l != nil {
			out.To = append(out.To, *l)
		}
	}
	writeJSON(w, out)
}
