package hub

import (
	"database/sql"
	"encoding/json"
	"time"
)

// Chat apps (Telegram, Slack, Discord, webhook): storage. Settings hold the
// bot tokens, so they only ever leave the hub masked (see chat_api.go).

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS chat_apps (
	kind       TEXT PRIMARY KEY,
	config     TEXT NOT NULL,
	updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_prompts (
	id         TEXT PRIMARY KEY,
	kind       TEXT NOT NULL,
	thread_id  TEXT NOT NULL,
	prompt_id  TEXT NOT NULL,
	type       TEXT NOT NULL,
	body       TEXT NOT NULL,
	ref        TEXT NOT NULL DEFAULT '',
	state      TEXT NOT NULL DEFAULT 'pending',
	outcome    TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_prompts_thread ON chat_prompts(thread_id, prompt_id);
CREATE INDEX IF NOT EXISTS chat_prompts_ref ON chat_prompts(kind, ref);
`)
}

// Prompt states. A prompt is answered exactly once: pending -> answering
// (claimed by one press) -> done.
const (
	promptPending   = "pending"
	promptAnswering = "answering"
	promptDone      = "done"
)

func (s *Store) chatConfig(kind string) (chatConfig, error) {
	var raw string
	err := s.db.QueryRow(`SELECT config FROM chat_apps WHERE kind = ?`, kind).Scan(&raw)
	if err == sql.ErrNoRows {
		return chatConfig{}, nil
	}
	if err != nil {
		return chatConfig{}, err
	}
	var c chatConfig
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return chatConfig{}, err
	}
	return c, nil
}

func (s *Store) saveChatConfig(kind string, c chatConfig) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO chat_apps (kind, config, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(kind) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
		kind, string(b), time.Now().Unix())
	return err
}

func (s *Store) deleteChatConfig(kind string) error {
	_, err := s.db.Exec(`DELETE FROM chat_apps WHERE kind = ?`, kind)
	return err
}

const promptColumns = `id, kind, thread_id, prompt_id, type, body, ref, state, outcome, created_at`

func scanPrompt(row rowScanner) (*chatPrompt, error) {
	var p chatPrompt
	var body string
	if err := row.Scan(&p.Id, &p.Kind, &p.ThreadId, &p.PromptId, &p.Type, &body, &p.Ref, &p.State, &p.Outcome, &p.CreatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(body), &p.Content); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) insertChatPrompt(p *chatPrompt) error {
	b, err := json.Marshal(p.Content)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO chat_prompts (`+promptColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Id, p.Kind, p.ThreadId, p.PromptId, p.Type, string(b), p.Ref, p.State, p.Outcome, p.CreatedAt)
	return err
}

func (s *Store) chatPromptById(id string) (*chatPrompt, error) {
	p, err := scanPrompt(s.db.QueryRow(`SELECT `+promptColumns+` FROM chat_prompts WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) chatPromptByRef(kind, ref string) (*chatPrompt, error) {
	if ref == "" {
		return nil, nil
	}
	p, err := scanPrompt(s.db.QueryRow(`SELECT `+promptColumns+` FROM chat_prompts WHERE kind = ? AND ref = ?
		ORDER BY created_at DESC LIMIT 1`, kind, ref))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

// chatPromptsFor lists every integration's copy of one approval or question.
func (s *Store) chatPromptsFor(threadId, promptId string) ([]*chatPrompt, error) {
	rows, err := s.db.Query(`SELECT `+promptColumns+` FROM chat_prompts WHERE thread_id = ? AND prompt_id = ?`, threadId, promptId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*chatPrompt
	for rows.Next() {
		p, err := scanPrompt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) setChatPromptRef(id, ref string) error {
	_, err := s.db.Exec(`UPDATE chat_prompts SET ref = ? WHERE id = ?`, ref, id)
	return err
}

func (s *Store) setChatPromptPicked(id string, c chatContent) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE chat_prompts SET body = ? WHERE id = ? AND state = ?`, string(b), id, promptPending)
	return err
}

// claimChatPrompt moves a pending prompt to answering. It reports whether
// this caller won: concurrent presses and replays lose.
func (s *Store) claimChatPrompt(id string) (bool, error) {
	res, err := s.db.Exec(`UPDATE chat_prompts SET state = ? WHERE id = ? AND state = ?`, promptAnswering, id, promptPending)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// releaseChatPrompt puts a claimed prompt back to pending (the answer could
// not be delivered, so it can be tried again).
func (s *Store) releaseChatPrompt(id string) error {
	_, err := s.db.Exec(`UPDATE chat_prompts SET state = ? WHERE id = ? AND state = ?`, promptPending, id, promptAnswering)
	return err
}

// finishChatPrompt records the outcome. fromState guards against finishing
// a prompt somebody else already finished.
func (s *Store) finishChatPrompt(id, outcome string, fromStates ...string) (bool, error) {
	for _, from := range fromStates {
		res, err := s.db.Exec(`UPDATE chat_prompts SET state = ?, outcome = ? WHERE id = ? AND state = ?`, promptDone, outcome, id, from)
		if err != nil {
			return false, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return true, nil
		}
	}
	return false, nil
}

// pendingChatPromptsOf lists the open prompts of one integration.
func (s *Store) pendingChatPromptsOf(kind string) ([]*chatPrompt, error) {
	rows, err := s.db.Query(`SELECT `+promptColumns+` FROM chat_prompts WHERE kind = ? AND state != ?`, kind, promptDone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*chatPrompt
	for rows.Next() {
		p, err := scanPrompt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) pruneChatPrompts(before int64) error {
	_, err := s.db.Exec(`DELETE FROM chat_prompts WHERE created_at < ?`, before)
	return err
}

// threadMessageById reads one stored message of a thread.
func (s *Store) threadMessageById(threadId, id string) (*ThreadMessage, error) {
	m, err := scanMessage(s.db.QueryRow(`SELECT id, seq, at, updated_at, role, text, data FROM thread_messages
		WHERE thread_id = ? AND id = ?`, threadId, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

// lastAssistantText is the agent's latest reply in a thread (for the
// "finished" message).
func (s *Store) lastAssistantText(threadId string) string {
	var text string
	s.db.QueryRow(`SELECT text FROM thread_messages WHERE thread_id = ? AND role = 'assistant'
		ORDER BY seq DESC LIMIT 1`, threadId).Scan(&text)
	return text
}
