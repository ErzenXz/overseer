package hub

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// toolOutputCap bounds stored tool output (the agent truncates too; this is
// the hub's own guarantee).
const toolOutputCap = 64 * 1024

// --- threads ---

// ThreadPR is the pull request a thread produced, if any.
type ThreadPR struct {
	Url    string `json:"url"`
	Number int    `json:"number"`
	State  string `json:"state"`
	Checks string `json:"checks,omitempty"`
}

// Thread is one conversation with one coding agent on one device.
type Thread struct {
	Id           string          `json:"id"`
	Title        string          `json:"title"`
	DeviceId     string          `json:"deviceId"`
	DeviceName   string          `json:"deviceName"`
	Agent        string          `json:"agent"`
	Command      string          `json:"command,omitempty"`
	Cwd          string          `json:"cwd"`
	Model        string          `json:"model,omitempty"`
	Access       string          `json:"access"`
	Status       string          `json:"status"`
	Error        string          `json:"error,omitempty"`
	CreatedAt    int64           `json:"createdAt"`
	UpdatedAt    int64           `json:"updatedAt"`
	LastReadAt   int64           `json:"lastReadAt"`
	Terminal     string          `json:"terminal,omitempty"`
	PR           *ThreadPR       `json:"pr,omitempty"`
	Usage        *protocol.Usage `json:"usage,omitempty"`
	AutomationId string          `json:"automationId,omitempty"`

	ResumeId string `json:"-"` // the agent's own session id, for resuming
}

const threadColumns = `t.id, t.title, t.device_id, COALESCE(d.name, ''), t.agent, t.command, t.cwd, t.model,
	t.access, t.status, t.error, t.created_at, t.updated_at, t.last_read_at, t.terminal, t.pr, t.usage,
	t.automation_id, t.resume_id`

type rowScanner interface{ Scan(dest ...any) error }

func scanThread(row rowScanner) (*Thread, error) {
	var t Thread
	var pr, usage string
	err := row.Scan(&t.Id, &t.Title, &t.DeviceId, &t.DeviceName, &t.Agent, &t.Command, &t.Cwd, &t.Model,
		&t.Access, &t.Status, &t.Error, &t.CreatedAt, &t.UpdatedAt, &t.LastReadAt, &t.Terminal, &pr, &usage,
		&t.AutomationId, &t.ResumeId)
	if err != nil {
		return nil, err
	}
	if pr != "" {
		json.Unmarshal([]byte(pr), &t.PR)
	}
	if usage != "" {
		json.Unmarshal([]byte(usage), &t.Usage)
	}
	return &t, nil
}

func (s *Store) CreateThread(t *Thread) error {
	_, err := s.db.Exec(`INSERT INTO threads (id, title, device_id, agent, command, cwd, model, access, status,
		error, created_at, updated_at, last_read_at, automation_id, resume_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.Id, t.Title, t.DeviceId, t.Agent, t.Command, t.Cwd, t.Model, t.Access, t.Status,
		t.Error, t.CreatedAt, t.UpdatedAt, t.LastReadAt, t.AutomationId, t.ResumeId)
	return err
}

func (s *Store) ThreadById(id string) (*Thread, error) {
	t, err := scanThread(s.db.QueryRow(`SELECT `+threadColumns+`
		FROM threads t LEFT JOIN devices d ON d.id = t.device_id WHERE t.id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

func (s *Store) ListThreads() ([]Thread, error) {
	rows, err := s.db.Query(`SELECT ` + threadColumns + `
		FROM threads t LEFT JOIN devices d ON d.id = t.device_id ORDER BY t.updated_at DESC, t.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Thread{}
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// SetThreadStatus records a status transition. The error text is cleared
// unless the new status is "error".
func (s *Store) SetThreadStatus(id, status, errText string) error {
	if status != "error" {
		errText = ""
	}
	_, err := s.db.Exec(`UPDATE threads SET status = ?, error = ?, updated_at = MAX(updated_at, ?) WHERE id = ?`,
		status, errText, time.Now().Unix(), id)
	return err
}

func (s *Store) SetThreadResumeId(id, resumeId string) error {
	_, err := s.db.Exec(`UPDATE threads SET resume_id = ? WHERE id = ?`, resumeId, id)
	return err
}

func (s *Store) SetThreadUsage(id string, usage protocol.Usage) error {
	b, _ := json.Marshal(usage)
	_, err := s.db.Exec(`UPDATE threads SET usage = ? WHERE id = ?`, string(b), id)
	return err
}

func (s *Store) SetThreadTerminal(id, terminal string) error {
	_, err := s.db.Exec(`UPDATE threads SET terminal = ? WHERE id = ?`, terminal, id)
	return err
}

// TouchThread bumps updated_at; it reports whether the stored value changed.
func (s *Store) TouchThread(id string, at int64) (bool, error) {
	res, err := s.db.Exec(`UPDATE threads SET updated_at = ? WHERE id = ? AND updated_at < ?`, at, id, at)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// threadPatch is a partial update from PATCH /api/threads/{id}.
type threadPatch struct {
	Title  *string `json:"title"`
	Access *string `json:"access"`
	Model  *string `json:"model"`
	Read   *bool   `json:"read"`
}

func (s *Store) PatchThread(id string, p threadPatch) error {
	if p.Title != nil {
		if _, err := s.db.Exec(`UPDATE threads SET title = ? WHERE id = ?`, *p.Title, id); err != nil {
			return err
		}
	}
	if p.Access != nil {
		if _, err := s.db.Exec(`UPDATE threads SET access = ? WHERE id = ?`, *p.Access, id); err != nil {
			return err
		}
	}
	if p.Model != nil {
		if _, err := s.db.Exec(`UPDATE threads SET model = ? WHERE id = ?`, *p.Model, id); err != nil {
			return err
		}
	}
	if p.Read != nil && *p.Read {
		if _, err := s.db.Exec(`UPDATE threads SET last_read_at = MAX(updated_at, ?) WHERE id = ?`, time.Now().Unix(), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteThread(id string) error {
	if _, err := s.db.Exec(`DELETE FROM thread_messages WHERE thread_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM threads WHERE id = ?`, id)
	return err
}

// ResetInterruptedThreads marks threads that were mid-flight when the hub
// stopped. Their agents will be resumed on the next prompt.
func (s *Store) ResetInterruptedThreads() error {
	_, err := s.db.Exec(`UPDATE threads SET status = 'stopped' WHERE status IN ('starting', 'working', 'waiting')`)
	return err
}

// --- thread messages ---

var errThreadGone = errors.New("thread no longer exists")

// ThreadMessage is one folded item of a thread.
type ThreadMessage struct {
	Id         string                          `json:"id"`
	Seq        int64                           `json:"seq"`
	At         int64                           `json:"at"`        // unix ms of first event
	UpdatedAt  int64                           `json:"updatedAt"` // unix ms of last event
	Role       string                          `json:"role"`
	Text       string                          `json:"text"`
	Turn       string                          `json:"turn,omitempty"`
	Tool       *protocol.ThreadTool            `json:"tool,omitempty"`
	Plan       []protocol.PlanEntry            `json:"plan,omitempty"`
	Approval   *protocol.ThreadApprovalRequest `json:"approval,omitempty"`
	DurationMs int64                           `json:"durationMs,omitempty"`
}

// messageData is the JSON blob column holding the structured fields.
type messageData struct {
	Turn       string                          `json:"turn,omitempty"`
	Tool       *protocol.ThreadTool            `json:"tool,omitempty"`
	Plan       []protocol.PlanEntry            `json:"plan,omitempty"`
	Approval   *protocol.ThreadApprovalRequest `json:"approval,omitempty"`
	DurationMs int64                           `json:"durationMs,omitempty"`
}

func scanMessage(row rowScanner) (*ThreadMessage, error) {
	var m ThreadMessage
	var data string
	if err := row.Scan(&m.Id, &m.Seq, &m.At, &m.UpdatedAt, &m.Role, &m.Text, &data); err != nil {
		return nil, err
	}
	if data != "" {
		var d messageData
		if json.Unmarshal([]byte(data), &d) == nil {
			m.Turn, m.Tool, m.Plan, m.Approval, m.DurationMs = d.Turn, d.Tool, d.Plan, d.Approval, d.DurationMs
		}
	}
	return &m, nil
}

func (s *Store) ThreadMessages(threadId string) ([]ThreadMessage, error) {
	rows, err := s.db.Query(`SELECT id, seq, at, updated_at, role, text, data FROM thread_messages
		WHERE thread_id = ? ORDER BY seq`, threadId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ThreadMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// LastUserMessageId returns the id of the thread's latest user message.
func (s *Store) LastUserMessageId(threadId string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM thread_messages WHERE thread_id = ? AND role = 'user'
		ORDER BY seq DESC LIMIT 1`, threadId).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}

// ApplyThreadEvent folds one adapter event into the stored message with the
// same id, creating it (with the next seq) on first sight. defaultTurn is
// stamped on new messages whose event carries no turn.
func (s *Store) ApplyThreadEvent(threadId string, ev protocol.ThreadEvent, defaultTurn string, now time.Time) (*ThreadMessage, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Late events for a deleted thread must not leave orphan rows behind.
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM threads WHERE id = ?`, threadId).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, errThreadGone
	}

	ms := now.UnixMilli()
	existing, err := scanMessage(tx.QueryRow(`SELECT id, seq, at, updated_at, role, text, data FROM thread_messages
		WHERE thread_id = ? AND id = ?`, threadId, ev.Id))
	isNew := err == sql.ErrNoRows
	if err != nil && !isNew {
		return nil, err
	}
	var msg *ThreadMessage
	if isNew {
		var seq int64
		if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) + 1 FROM thread_messages WHERE thread_id = ?`, threadId).Scan(&seq); err != nil {
			return nil, err
		}
		msg = &ThreadMessage{Id: ev.Id, Seq: seq, At: ms, Turn: defaultTurn}
	} else {
		msg = existing
	}
	foldEvent(msg, ev)
	msg.UpdatedAt = ms
	if msg.Role == "user" {
		msg.Turn = ""
	}

	data, _ := json.Marshal(messageData{Turn: msg.Turn, Tool: msg.Tool, Plan: msg.Plan, Approval: msg.Approval, DurationMs: msg.DurationMs})
	if isNew {
		_, err = tx.Exec(`INSERT INTO thread_messages (thread_id, id, seq, at, updated_at, role, text, data)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, threadId, msg.Id, msg.Seq, msg.At, msg.UpdatedAt, msg.Role, msg.Text, string(data))
	} else {
		_, err = tx.Exec(`UPDATE thread_messages SET updated_at = ?, role = ?, text = ?, data = ?
			WHERE thread_id = ? AND id = ?`, msg.UpdatedAt, msg.Role, msg.Text, string(data), threadId, msg.Id)
	}
	if err != nil {
		return nil, err
	}
	return msg, tx.Commit()
}

// foldEvent merges ev into msg: Append concatenates text, otherwise every
// non-empty field of ev replaces the stored one.
func foldEvent(msg *ThreadMessage, ev protocol.ThreadEvent) {
	if ev.Role != "" {
		msg.Role = ev.Role
	}
	if msg.Role == "" {
		switch {
		case ev.Tool != nil:
			msg.Role = "tool"
		case ev.Plan != nil:
			msg.Role = "plan"
		case ev.Approval != nil:
			msg.Role = "approval"
		default:
			msg.Role = "status"
		}
	}
	if ev.Append {
		msg.Text += ev.Text
	} else if ev.Text != "" {
		msg.Text = ev.Text
	}
	if ev.Turn != "" {
		msg.Turn = ev.Turn
	}
	if ev.DurationMs > 0 {
		msg.DurationMs = ev.DurationMs
	}
	if ev.Plan != nil {
		msg.Plan = ev.Plan
	}
	if t := ev.Tool; t != nil {
		if msg.Tool == nil {
			msg.Tool = &protocol.ThreadTool{}
		}
		mergeTool(msg.Tool, t)
	}
	if a := ev.Approval; a != nil {
		if msg.Approval == nil {
			msg.Approval = &protocol.ThreadApprovalRequest{}
		}
		if a.Id != "" {
			msg.Approval.Id = a.Id
		}
		if a.Title != "" {
			msg.Approval.Title = a.Title
		}
		if a.Detail != "" {
			msg.Approval.Detail = a.Detail
		}
		if a.Options != nil {
			msg.Approval.Options = a.Options
		}
		if a.Resolved != "" {
			msg.Approval.Resolved = a.Resolved
		}
	}
}

func mergeTool(dst, src *protocol.ThreadTool) {
	if src.Name != "" {
		dst.Name = src.Name
	}
	if src.Title != "" {
		dst.Title = src.Title
	}
	if src.Status != "" {
		dst.Status = src.Status
	}
	if src.Input != "" {
		dst.Input = src.Input
	}
	if src.Output != "" {
		dst.Output = src.Output
		if len(dst.Output) > toolOutputCap {
			cut := toolOutputCap
			for cut > 0 && (dst.Output[cut]&0xC0) == 0x80 {
				cut-- // don't split a UTF-8 sequence
			}
			dst.Output = dst.Output[:cut] + "\n… (output truncated)"
		}
	}
	if src.Files != nil {
		dst.Files = src.Files
	}
	if dst.Name == "" {
		dst.Name = "other"
	}
}

// --- MCP servers ---

func (s *Store) ListMcpServers() ([]protocol.McpServer, error) {
	rows, err := s.db.Query(`SELECT id, name, transport, command, args, env, url, headers, enabled
		FROM mcp_servers ORDER BY created_at, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []protocol.McpServer{}
	for rows.Next() {
		m, err := scanMcpServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func scanMcpServer(row rowScanner) (*protocol.McpServer, error) {
	var m protocol.McpServer
	var args, env, headers string
	var enabled int
	if err := row.Scan(&m.Id, &m.Name, &m.Transport, &m.Command, &args, &env, &m.Url, &headers, &enabled); err != nil {
		return nil, err
	}
	m.Enabled = enabled == 1
	if args != "" {
		json.Unmarshal([]byte(args), &m.Args)
	}
	if env != "" {
		json.Unmarshal([]byte(env), &m.Env)
	}
	if headers != "" {
		json.Unmarshal([]byte(headers), &m.Headers)
	}
	return &m, nil
}

func (s *Store) McpServerById(id string) (*protocol.McpServer, error) {
	m, err := scanMcpServer(s.db.QueryRow(`SELECT id, name, transport, command, args, env, url, headers, enabled
		FROM mcp_servers WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

func jsonText(v any) string {
	b, _ := json.Marshal(v)
	if string(b) == "null" {
		return ""
	}
	return string(b)
}

// SaveMcpServer inserts or replaces a registry entry.
func (s *Store) SaveMcpServer(m protocol.McpServer) error {
	_, err := s.db.Exec(`INSERT INTO mcp_servers (id, name, transport, command, args, env, url, headers, enabled, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, transport = excluded.transport, command = excluded.command,
			args = excluded.args, env = excluded.env, url = excluded.url, headers = excluded.headers, enabled = excluded.enabled`,
		m.Id, m.Name, m.Transport, m.Command, jsonText(m.Args), jsonText(m.Env), m.Url, jsonText(m.Headers),
		boolInt(m.Enabled), time.Now().Unix())
	return err
}

func (s *Store) DeleteMcpServer(id string) error {
	_, err := s.db.Exec(`DELETE FROM mcp_servers WHERE id = ?`, id)
	return err
}

// --- automations ---

// Automation runs a prompt on a schedule by creating a new thread.
type Automation struct {
	Id           string `json:"id"`
	Name         string `json:"name"`
	Prompt       string `json:"prompt"`
	DeviceId     string `json:"deviceId"`
	Agent        string `json:"agent"`
	Command      string `json:"command,omitempty"`
	Model        string `json:"model,omitempty"`
	Cwd          string `json:"cwd"`
	Access       string `json:"access"`
	Schedule     string `json:"schedule"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    int64  `json:"createdAt"`
	LastRunAt    int64  `json:"lastRunAt,omitempty"`
	LastThreadId string `json:"lastThreadId,omitempty"`
	NextRunAt    int64  `json:"nextRunAt,omitempty"`
}

const automationColumns = `id, name, prompt, device_id, agent, command, model, cwd, access, schedule, enabled,
	created_at, last_run_at, last_thread_id, next_run_at`

func scanAutomation(row rowScanner) (*Automation, error) {
	var a Automation
	var enabled int
	err := row.Scan(&a.Id, &a.Name, &a.Prompt, &a.DeviceId, &a.Agent, &a.Command, &a.Model, &a.Cwd, &a.Access,
		&a.Schedule, &enabled, &a.CreatedAt, &a.LastRunAt, &a.LastThreadId, &a.NextRunAt)
	if err != nil {
		return nil, err
	}
	a.Enabled = enabled == 1
	return &a, nil
}

func (s *Store) ListAutomations() ([]Automation, error) {
	rows, err := s.db.Query(`SELECT ` + automationColumns + ` FROM automations ORDER BY created_at, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Automation{}
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func (s *Store) AutomationById(id string) (*Automation, error) {
	a, err := scanAutomation(s.db.QueryRow(`SELECT `+automationColumns+` FROM automations WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return a, err
}

// SaveAutomation inserts or replaces an automation.
func (s *Store) SaveAutomation(a Automation) error {
	_, err := s.db.Exec(`INSERT INTO automations (`+automationColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt, device_id = excluded.device_id,
			agent = excluded.agent, command = excluded.command, model = excluded.model, cwd = excluded.cwd,
			access = excluded.access, schedule = excluded.schedule, enabled = excluded.enabled,
			last_run_at = excluded.last_run_at, last_thread_id = excluded.last_thread_id, next_run_at = excluded.next_run_at`,
		a.Id, a.Name, a.Prompt, a.DeviceId, a.Agent, a.Command, a.Model, a.Cwd, a.Access, a.Schedule,
		boolInt(a.Enabled), a.CreatedAt, a.LastRunAt, a.LastThreadId, a.NextRunAt)
	return err
}

// RecordAutomationRun stores the outcome of one run.
func (s *Store) RecordAutomationRun(id string, ranAt int64, threadId string, nextRunAt int64) error {
	_, err := s.db.Exec(`UPDATE automations SET last_run_at = ?, last_thread_id = ?, next_run_at = ? WHERE id = ?`,
		ranAt, threadId, nextRunAt, id)
	return err
}

func (s *Store) DeleteAutomation(id string) error {
	_, err := s.db.Exec(`DELETE FROM automations WHERE id = ?`, id)
	return err
}
