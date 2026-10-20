package hub

import (
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Transcript handling for forks and undo. A "turn" is a (sent) user message
// plus everything after it up to the next sent user message; queued user
// prompts are not part of the transcript yet.

const forkTranscriptCap = 48 * 1024

func isSentUser(m ThreadMessage) bool { return m.Role == "user" && !m.Queued }

// forkCut splits msgs for a fork at messageId ("" = the whole thread). It
// returns the messages to keep (whole turns through the one containing
// messageId), the id of the last kept user message, and how many later
// turns are dropped. ok is false when messageId is not in msgs.
func forkCut(msgs []ThreadMessage, messageId string) (kept []ThreadMessage, cutUser string, dropped int, ok bool) {
	end := len(msgs)
	if messageId != "" {
		at := -1
		for i, m := range msgs {
			if m.Id == messageId {
				at = i
				break
			}
		}
		if at < 0 {
			return nil, "", 0, false
		}
		for j := at + 1; j < len(msgs); j++ {
			if isSentUser(msgs[j]) {
				end = j
				break
			}
		}
	}
	kept = []ThreadMessage{}
	for _, m := range msgs[:end] {
		if m.Role == "user" && m.Queued {
			continue
		}
		kept = append(kept, m)
		if m.Role == "user" {
			cutUser = m.Id
		}
	}
	for _, m := range msgs[end:] {
		if isSentUser(m) {
			dropped++
		}
	}
	return kept, cutUser, dropped, true
}

// lastTurnIds returns the ids of the messages making up the last turn
// (queued prompts stay).
func lastTurnIds(msgs []ThreadMessage) []string {
	start := -1
	for i, m := range msgs {
		if isSentUser(m) {
			start = i
		}
	}
	if start < 0 {
		return nil
	}
	var ids []string
	for _, m := range msgs[start:] {
		if m.Role == "user" && m.Queued {
			continue
		}
		ids = append(ids, m.Id)
	}
	return ids
}

// forkTranscript renders kept messages as context for a fresh session: user
// and assistant text plus one line per tool call, most recent part kept.
func forkTranscript(msgs []ThreadMessage) string {
	var b strings.Builder
	for _, m := range msgs {
		switch m.Role {
		case "user":
			b.WriteString("User: " + strings.TrimSpace(m.Text) + "\n\n")
		case "assistant":
			if t := strings.TrimSpace(m.Text); t != "" {
				b.WriteString("Assistant: " + t + "\n\n")
			}
		case "tool":
			if m.Tool != nil {
				line := "Tool: " + m.Tool.Title
				if m.Tool.Input != "" {
					line += " (" + clipText(m.Tool.Input, 200) + ")"
				}
				b.WriteString(line + "\n\n")
			}
		case "question":
			if m.Question != nil && len(m.Question.Answered) > 0 {
				b.WriteString("Question: " + m.Question.Text + "\nAnswer: " + strings.Join(m.Question.Answered, ", ") + "\n\n")
			}
		}
	}
	body := strings.TrimSpace(b.String())
	if body == "" {
		return ""
	}
	if len(body) > forkTranscriptCap {
		cut := len(body) - forkTranscriptCap
		for cut < len(body) && (body[cut]&0xC0) == 0x80 {
			cut++
		}
		body = "…\n" + body[cut:]
	}
	return "This conversation continues an earlier session. The transcript so far:\n\n" + body +
		"\n\n---\n\n"
}

func clipText(s string, n int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	if len(s) <= n {
		return s
	}
	for n > 0 && (s[n]&0xC0) == 0x80 {
		n--
	}
	return s[:n] + "…"
}

// defaultCapabilities is what an agent supports before it has reported in.
func defaultCapabilities(agent string) protocol.ThreadCapabilities {
	switch agent {
	case "claude":
		return protocol.ThreadCapabilities{Fork: true, Compact: true, Steer: true, Images: true, Commands: true}
	case "codex":
		return protocol.ThreadCapabilities{Fork: true, Compact: true, Undo: true, Steer: true, Images: true, Commands: true, Review: true}
	}
	return protocol.ThreadCapabilities{Fork: true}
}

// capabilities is what t's agent supports, as last reported.
func capabilities(t *Thread) protocol.ThreadCapabilities {
	if t.Meta.Capabilities != nil {
		return *t.Meta.Capabilities
	}
	return defaultCapabilities(t.Agent)
}
