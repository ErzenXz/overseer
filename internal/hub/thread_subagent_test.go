package hub

import (
	"encoding/json"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// A subagent row folds start, progress and result into one message, and its
// steps keep the parent id they were created with.
func TestFoldSubagentEvents(t *testing.T) {
	row := &ThreadMessage{}
	foldEvent(row, protocol.ThreadEvent{Id: "agent1", Role: "tool", Tool: &protocol.ThreadTool{
		Name: "agent", Title: "Find auth tests", Status: "running",
		Agent: &protocol.ThreadAgent{Type: "Explore", Task: "Find auth tests", Prompt: "look"},
	}})
	foldEvent(row, protocol.ThreadEvent{Id: "agent1", Tool: &protocol.ThreadTool{Agent: &protocol.ThreadAgent{Tools: 3, Tokens: 900}}})
	foldEvent(row, protocol.ThreadEvent{Id: "agent1", Tool: &protocol.ThreadTool{Status: "completed", Agent: &protocol.ThreadAgent{Result: "done", DurationMs: 4000}}})
	a := row.Tool.Agent
	if row.Tool.Status != "completed" || a.Type != "Explore" || a.Task != "Find auth tests" || a.Prompt != "look" || a.Tools != 3 || a.Tokens != 900 || a.Result != "done" || a.DurationMs != 4000 {
		t.Fatalf("folded: %+v %+v", row.Tool, a)
	}

	step := &ThreadMessage{}
	foldEvent(step, protocol.ThreadEvent{Id: "s1", Role: "tool", ParentId: "agent1", Tool: &protocol.ThreadTool{Name: "grep", Title: "Search", Status: "running"}})
	foldEvent(step, protocol.ThreadEvent{Id: "s1", Tool: &protocol.ThreadTool{Status: "completed", Output: "x"}})
	if step.ParentId != "agent1" || step.Tool.Status != "completed" {
		t.Fatalf("step: %+v", step)
	}

	// The parent id survives the store's data blob round trip.
	var d messageData
	if err := json.Unmarshal([]byte(step.data()), &d); err != nil || d.ParentId != "agent1" {
		t.Fatalf("data: %v %+v", err, d)
	}
}

func TestForkTranscriptSkipsSubagentSteps(t *testing.T) {
	msgs := []ThreadMessage{
		{Id: "u", Role: "user", Text: "go"},
		{Id: "a", Role: "tool", Tool: &protocol.ThreadTool{Title: "Explore the repo"}},
		{Id: "s", Role: "tool", ParentId: "a", Tool: &protocol.ThreadTool{Title: "Read secret.go"}},
	}
	out := forkTranscript(msgs)
	if !contains(out, "Explore the repo") || contains(out, "secret.go") {
		t.Fatalf("transcript: %q", out)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
