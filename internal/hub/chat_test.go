package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Chat app tests run against fake Telegram / Slack / Discord servers: no
// real service is ever contacted.

const testTelegramToken = "123456789:AAHtestTOKENtestTOKENtestTOKEN12345"

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

type approveCall struct{ thread, id, option string }
type answerCall struct {
	id      string
	answers []string
	text    string
}

type chatHarness struct {
	t      *testing.T
	srv    *Server
	m      *chatManager
	thread *Thread

	mu       sync.Mutex
	approved []approveCall
	answered []answerCall
	failWith error // returned by the next deliveries while set
	failCode int
}

func newChatHarness(t *testing.T) *chatHarness {
	t.Helper()
	srv := newTestServer(t, "test")
	devId, _, err := srv.store.CreateDevice("Studio", "studio", "darwin", "arm64", false)
	if err != nil {
		t.Fatal(err)
	}
	th := &Thread{Id: "t1", Title: "Fix flaky auth tests", DeviceId: devId, Agent: "claude", Cwd: "/work", Access: "ask",
		Status: "working", CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix()}
	if err := srv.store.CreateThread(th); err != nil {
		t.Fatal(err)
	}
	h := &chatHarness{t: t, srv: srv, m: srv.chat, thread: th}
	h.m.approve = func(th *Thread, id, option string) (int, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.failWith != nil {
			return h.failCode, h.failWith
		}
		h.approved = append(h.approved, approveCall{th.Id, id, option})
		return 0, nil
	}
	h.m.answer = func(th *Thread, id string, answers []string, text string) (int, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.failWith != nil {
			return h.failCode, h.failWith
		}
		h.answered = append(h.answered, answerCall{id, answers, text})
		return 0, nil
	}
	srv.store.SetSetting(settingHubPublicURL, "https://hub.example.com")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.m.run(ctx); close(done) }()
	waitFor(t, "manager running", h.m.running.Load)
	t.Cleanup(func() { cancel(); <-done; h.m.wg.Wait() })
	return h
}

func (h *chatHarness) approvals() []approveCall {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]approveCall(nil), h.approved...)
}

func (h *chatHarness) answers() []answerCall {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]answerCall(nil), h.answered...)
}

// call runs a settings handler without the auth layer.
func (h *chatHarness) call(method, kind, action string, body any) (int, string) {
	h.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, "/api/chat/apps/"+kind+action, rd)
	req.SetPathValue("kind", kind)
	w := httptest.NewRecorder()
	switch {
	case method == "PUT":
		h.srv.handleChatPut(w, req)
	case method == "DELETE":
		h.srv.handleChatDelete(w, req)
	case action == "/connect":
		h.srv.handleChatConnect(w, req)
	case action == "/test":
		h.srv.handleChatTest(w, req)
	default:
		h.srv.handleChatList(w, req)
	}
	return w.Code, w.Body.String()
}

func (h *chatHarness) approval(id string, resolved string) {
	h.t.Helper()
	ev := protocol.ThreadEvent{Id: id, Role: "approval", Approval: &protocol.ThreadApprovalRequest{Id: id}}
	if resolved != "" {
		ev.Approval.Resolved = resolved
	} else {
		ev.Approval.Title = "Run the auth tests"
		ev.Approval.Detail = "go test ./internal/auth/..."
		ev.Approval.Options = []protocol.ApprovalOption{
			{Id: "allow", Label: "Allow", Kind: "allow_once"},
			{Id: "always", Label: "Always allow Bash", Kind: "allow_always"},
			{Id: "deny", Label: "Deny", Kind: "reject_once"},
		}
	}
	h.srv.threads.appendEvent(h.thread.Id, ev)
}

func (h *chatHarness) question(id string, multiple, allowText bool) {
	h.srv.threads.appendEvent(h.thread.Id, protocol.ThreadEvent{Id: id, Role: "question", Question: &protocol.ThreadQuestion{
		Id: id, Text: "Which database should I use?", Multiple: multiple, AllowText: allowText,
		Options: []protocol.QuestionOption{{Id: "pg", Label: "Postgres", Description: "Production grade"}, {Id: "sqlite", Label: "SQLite"}},
	}})
}

func (h *chatHarness) statusLines() []string {
	msgs, _ := h.srv.store.ThreadMessages(h.thread.Id)
	var out []string
	for _, m := range msgs {
		if m.Role == "status" {
			out = append(out, m.Text)
		}
	}
	return out
}

// --- fake Telegram ---

type fakeTelegram struct {
	t   *testing.T
	srv *httptest.Server

	mu        sync.Mutex
	updates   chan json.RawMessage
	sent      []map[string]any
	edits     []map[string]any
	callbacks []map[string]any
	nextId    int
	getMeFail bool
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	f := &fakeTelegram{t: t, updates: make(chan json.RawMessage, 50), nextId: 100}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeTelegram) serve(w http.ResponseWriter, r *http.Request) {
	prefix := "/bot" + testTelegramToken + "/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.Error(w, `{"ok":false,"error_code":401,"description":"Unauthorized"}`, 401)
		return
	}
	method := strings.TrimPrefix(r.URL.Path, prefix)
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	reply := func(result any) {
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result})
	}
	f.mu.Lock()
	switch method {
	case "getMe":
		fail := f.getMeFail
		f.mu.Unlock()
		if fail {
			w.WriteHeader(401)
			w.Write([]byte(`{"ok":false,"error_code":401,"description":"Unauthorized"}`))
			return
		}
		reply(map[string]any{"id": 4242, "username": "overseer_test_bot", "first_name": "Overseer"})
		return
	case "deleteWebhook":
		f.mu.Unlock()
		reply(true)
		return
	case "getUpdates":
		f.mu.Unlock()
		out := []json.RawMessage{}
		select {
		case u := <-f.updates:
			out = append(out, u)
		case <-time.After(250 * time.Millisecond):
		case <-r.Context().Done():
		}
		reply(out)
		return
	case "sendMessage":
		f.sent = append(f.sent, body)
		f.nextId++
		id := f.nextId
		f.mu.Unlock()
		chat, _ := strconv.ParseInt(fmt.Sprint(body["chat_id"]), 10, 64)
		reply(map[string]any{"message_id": id, "chat": map[string]any{"id": chat}})
		return
	case "editMessageText":
		f.edits = append(f.edits, body)
	case "answerCallbackQuery":
		f.callbacks = append(f.callbacks, body)
	}
	f.mu.Unlock()
	reply(true)
}

func (f *fakeTelegram) push(update map[string]any) {
	b, _ := json.Marshal(update)
	f.updates <- b
}

func (f *fakeTelegram) sentMessages() []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.sent...)
}
func (f *fakeTelegram) editedMessages() []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.edits...)
}
func (f *fakeTelegram) answeredCallbacks() []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.callbacks...)
}

func tgText(m map[string]any) string { s, _ := m["text"].(string); return s }

// buttons flattens a message's inline keyboard.
func tgButtons(m map[string]any) []map[string]any {
	markup, _ := m["reply_markup"].(map[string]any)
	rows, _ := markup["inline_keyboard"].([]any)
	var out []map[string]any
	for _, r := range rows {
		for _, b := range r.([]any) {
			out = append(out, b.(map[string]any))
		}
	}
	return out
}

func tgMessageUpdate(id int, chat, from int64, text string, replyTo int) map[string]any {
	msg := map[string]any{"message_id": id, "from": map[string]any{"id": from, "first_name": "Erzen"},
		"chat": map[string]any{"id": chat, "type": "private", "first_name": "Erzen"}, "text": text}
	if replyTo != 0 {
		msg["reply_to_message"] = map[string]any{"message_id": replyTo, "chat": map[string]any{"id": chat}}
	}
	return map[string]any{"update_id": id, "message": msg}
}

func tgCallbackUpdate(id int, chat, from int64, msgId int, data string) map[string]any {
	return map[string]any{"update_id": id, "callback_query": map[string]any{
		"id": fmt.Sprintf("cb%d", id), "from": map[string]any{"id": from, "first_name": "Erzen"}, "data": data,
		"message": map[string]any{"message_id": msgId, "chat": map[string]any{"id": chat, "type": "private"}},
	}}
}

// linkTelegram saves a token, presses Connect and sends /start <code> from
// chat 777 (user 777).
func (h *chatHarness) linkTelegram(f *fakeTelegram) {
	h.t.Helper()
	h.m.api.telegram = f.srv.URL
	code, body := h.call("PUT", chatTelegram, "", map[string]any{"botToken": testTelegramToken})
	if code != 200 {
		h.t.Fatalf("saving the token: %d %s", code, body)
	}
	if strings.Contains(body, testTelegramToken) || strings.Contains(body, "AAHtest") {
		h.t.Fatalf("settings response leaks the token: %s", body)
	}
	code, body = h.call("POST", chatTelegram, "/connect", nil)
	if code != 200 {
		h.t.Fatalf("connect: %d %s", code, body)
	}
	var view chatAppView
	json.Unmarshal([]byte(body), &view)
	if len(view.LinkCode) != 8 || !strings.Contains(view.LinkUrl, "t.me/overseer_test_bot?start="+view.LinkCode) {
		h.t.Fatalf("link code/url wrong: %+v", view)
	}
	waitFor(h.t, "telegram connected", func() bool { return h.m.statusOf(chatTelegram).State == "connected" })

	// A stranger with a wrong code gets nowhere.
	f.push(tgMessageUpdate(1, 999, 999, "/start wrongcode", 0))
	waitFor(h.t, "invalid code reply", func() bool { return len(f.sentMessages()) == 1 })
	if h.m.config(chatTelegram).Channel != "" {
		h.t.Fatal("a wrong code linked a chat")
	}
	f.push(tgMessageUpdate(2, 777, 777, "/start "+view.LinkCode, 0))
	waitFor(h.t, "linked", func() bool { return h.m.config(chatTelegram).Channel == "777" })
	waitFor(h.t, "welcome", func() bool { return len(f.sentMessages()) == 2 })
	cfg := h.m.config(chatTelegram)
	if cfg.LinkCode != "" || len(cfg.AllowedUsers) != 1 || cfg.AllowedUsers[0] != "777" || !cfg.Enabled {
		h.t.Fatalf("config after link: %+v", cfg)
	}
	// The code is single-use.
	f.push(tgMessageUpdate(3, 888, 888, "/start "+view.LinkCode, 0))
	waitFor(h.t, "reply to reused code", func() bool { return len(f.sentMessages()) == 3 })
	if h.m.config(chatTelegram).Channel != "777" {
		h.t.Fatal("a used code linked another chat")
	}
}

func TestTelegramApproveOnce(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.linkTelegram(f)
	base := len(f.sentMessages())

	h.approval("perm1", "")
	waitFor(t, "approval message", func() bool { return len(f.sentMessages()) == base+1 })
	msg := f.sentMessages()[base]
	text := tgText(msg)
	for _, want := range []string{"Studio", "Claude Code wants to run the auth tests", "go test ./internal/auth/...", "Fix flaky auth tests"} {
		if !strings.Contains(text, want) {
			t.Errorf("message missing %q:\n%s", want, text)
		}
	}
	buttons := tgButtons(msg)
	var labels []string
	for _, b := range buttons {
		labels = append(labels, b["text"].(string))
	}
	if strings.Join(labels, "|") != "Allow once|Always allow|Reject|Open" {
		t.Fatalf("buttons = %v", labels)
	}
	if buttons[3]["url"] != "https://hub.example.com/sessions/t1" {
		t.Errorf("open url = %v", buttons[3]["url"])
	}
	// A press from the wrong chat or user is refused and does nothing.
	allow := buttons[0]["callback_data"].(string)
	f.push(tgCallbackUpdate(10, 555, 555, 101+base, allow))
	f.push(tgCallbackUpdate(11, 777, 555, 101+base, allow))
	waitFor(t, "two refusals", func() bool { return len(f.answeredCallbacks()) == 2 })
	if len(h.approvals()) != 0 {
		t.Fatal("an unlinked chat or user answered")
	}

	f.push(tgCallbackUpdate(12, 777, 777, 101+base, allow))
	waitFor(t, "approval delivered", func() bool { return len(h.approvals()) == 1 })
	if got := h.approvals()[0]; got != (approveCall{"t1", "perm1", "allow"}) {
		t.Fatalf("approved = %+v", got)
	}
	waitFor(t, "message edited", func() bool { return len(f.editedMessages()) >= 1 })
	edit := f.editedMessages()[0]
	if !strings.Contains(tgText(edit), "Allowed by you") {
		t.Errorf("edit text = %s", tgText(edit))
	}
	if b := tgButtons(edit); len(b) != 1 || b[0]["text"] != "Open" {
		t.Errorf("buttons after answering = %v", b)
	}
	if lines := h.statusLines(); len(lines) == 0 || !strings.Contains(lines[len(lines)-1], "via Telegram") {
		t.Errorf("transcript note = %v", lines)
	}

	// Pressing again (a replay, or another tap) never answers twice.
	f.push(tgCallbackUpdate(13, 777, 777, 101+base, buttons[2]["callback_data"].(string)))
	waitFor(t, "replay answered", func() bool { return len(f.answeredCallbacks()) == 4 })
	if len(h.approvals()) != 1 {
		t.Fatalf("second press delivered: %+v", h.approvals())
	}
	if toast, _ := f.answeredCallbacks()[3]["text"].(string); !strings.Contains(toast, "Already answered") {
		t.Errorf("toast = %q", toast)
	}
}

func TestTelegramAnsweredInAppFirst(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.linkTelegram(f)
	base := len(f.sentMessages())

	h.approval("perm2", "")
	waitFor(t, "sent", func() bool { return len(f.sentMessages()) == base+1 })
	buttons := tgButtons(f.sentMessages()[base])

	h.approval("perm2", "deny") // someone rejected it in the app
	waitFor(t, "edited to say so", func() bool { return len(f.editedMessages()) == 1 })
	if text := tgText(f.editedMessages()[0]); !strings.Contains(text, "Rejected in Overseer") {
		t.Errorf("edit = %s", text)
	}
	f.push(tgCallbackUpdate(20, 777, 777, 101+base, buttons[0]["callback_data"].(string)))
	waitFor(t, "callback answered", func() bool { return len(f.answeredCallbacks()) == 1 })
	if len(h.approvals()) != 0 {
		t.Fatal("answered a request that was already resolved")
	}
}

func TestTelegramStaleAndOffline(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.linkTelegram(f)
	base := len(f.sentMessages())

	h.approval("perm3", "")
	waitFor(t, "sent", func() bool { return len(f.sentMessages()) == base+1 })
	data := tgButtons(f.sentMessages()[base])[0]["callback_data"].(string)

	// The machine is offline: the answer is not lost, the prompt stays open.
	h.mu.Lock()
	h.failWith, h.failCode = errors.New("device is offline"), http.StatusServiceUnavailable
	h.mu.Unlock()
	f.push(tgCallbackUpdate(30, 777, 777, 101+base, data))
	waitFor(t, "offline toast", func() bool { return len(f.answeredCallbacks()) == 1 })
	if toast, _ := f.answeredCallbacks()[0]["text"].(string); !strings.Contains(toast, "Could not reach Studio") {
		t.Errorf("toast = %q", toast)
	}
	h.mu.Lock()
	h.failWith = nil
	h.mu.Unlock()
	f.push(tgCallbackUpdate(31, 777, 777, 101+base, data))
	waitFor(t, "delivered on retry", func() bool { return len(h.approvals()) == 1 })

	// The agent says it never asked: the prompt is closed, not answered.
	h.approval("perm4", "")
	waitFor(t, "second sent", func() bool { return len(f.sentMessages()) == base+2 })
	data = tgButtons(f.sentMessages()[base+1])[0]["callback_data"].(string)
	h.mu.Lock()
	h.failWith, h.failCode = errors.New("no pending approval"), http.StatusConflict
	h.mu.Unlock()
	f.push(tgCallbackUpdate(32, 777, 777, 102+base, data))
	waitFor(t, "stale toast", func() bool { return len(f.answeredCallbacks()) == 3 })
	waitFor(t, "stale edit", func() bool {
		for _, e := range f.editedMessages() {
			if strings.Contains(tgText(e), "No longer waiting") {
				return true
			}
		}
		return false
	})
}

func TestTelegramQuestions(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.linkTelegram(f)
	base := len(f.sentMessages())

	// Single choice with free text: buttons, or reply to the message.
	h.question("q1", false, true)
	waitFor(t, "question sent", func() bool { return len(f.sentMessages()) == base+1 })
	msg := f.sentMessages()[base]
	if !strings.Contains(tgText(msg), "Which database") || !strings.Contains(tgText(msg), "Reply to this message") {
		t.Errorf("question text:\n%s", tgText(msg))
	}
	if b := tgButtons(msg); len(b) != 3 || b[0]["text"] != "Postgres" {
		t.Fatalf("question buttons = %v", b)
	}
	// Someone else's reply is ignored.
	f.push(tgMessageUpdate(40, 777, 123, "mysql please", 101+base))
	f.push(tgMessageUpdate(41, 777, 777, "use mysql", 101+base))
	waitFor(t, "text answer", func() bool { return len(h.answers()) == 1 })
	if got := h.answers()[0]; got.id != "q1" || got.text != "use mysql" || len(got.answers) != 0 {
		t.Fatalf("answer = %+v", got)
	}
	waitFor(t, "edited", func() bool { return len(f.editedMessages()) >= 1 })
	if text := tgText(f.editedMessages()[0]); !strings.Contains(text, "Answered") || !strings.Contains(text, "use mysql") {
		t.Errorf("edit = %s", text)
	}

	// Multiple choice: toggle, then send.
	h.question("q2", true, false)
	waitFor(t, "multi sent", func() bool { return len(f.sentMessages()) == base+2 })
	b := tgButtons(f.sentMessages()[base+1])
	f.push(tgCallbackUpdate(42, 777, 777, 102+base, b[0]["callback_data"].(string)))
	f.push(tgCallbackUpdate(43, 777, 777, 102+base, b[1]["callback_data"].(string)))
	f.push(tgCallbackUpdate(44, 777, 777, 102+base, b[1]["callback_data"].(string))) // off again
	f.push(tgCallbackUpdate(45, 777, 777, 102+base, b[2]["callback_data"].(string)))
	waitFor(t, "multi answered", func() bool { return len(h.answers()) == 2 })
	if got := h.answers()[1]; got.id != "q2" || len(got.answers) != 1 || got.answers[0] != "pg" {
		t.Fatalf("multi answer = %+v", got)
	}
}

func TestChatFinishedFailedAndFilters(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.linkTelegram(f)
	base := len(f.sentMessages())

	if code, body := h.call("PUT", chatTelegram, "", map[string]any{"events": []string{"approval", "question", "finished", "failed"}}); code != 200 {
		t.Fatal(code, body)
	}
	h.srv.threads.appendEvent("t1", protocol.ThreadEvent{Id: "a1", Role: "assistant", Text: "I fixed the race in the session cache.\n\nMore details follow."})
	h.srv.threads.setStatus("t1", "working", "") // first sight: nothing sent
	h.srv.threads.setStatus("t1", "idle", "")
	waitFor(t, "finished message", func() bool { return len(f.sentMessages()) == base+1 })
	text := tgText(f.sentMessages()[base])
	if !strings.Contains(text, "✅") || !strings.Contains(text, "finished") || !strings.Contains(text, "I fixed the race in the session cache.") || strings.Contains(text, "More details") {
		t.Errorf("finished text:\n%s", text)
	}
	h.srv.threads.setStatus("t1", "working", "")
	h.srv.threads.setStatus("t1", "error", "agent crashed: exit 2")
	waitFor(t, "failed message", func() bool { return len(f.sentMessages()) == base+2 })
	if text := tgText(f.sentMessages()[base+1]); !strings.Contains(text, "❌") || !strings.Contains(text, "agent crashed") {
		t.Errorf("failed text:\n%s", text)
	}

	// A machine filter that excludes this machine silences it.
	if code, body := h.call("PUT", chatTelegram, "", map[string]any{"machines": []string{"some-other-machine"}}); code != 200 {
		t.Fatal(code, body)
	}
	h.approval("perm9", "")
	h.srv.threads.setStatus("t1", "working", "")
	h.srv.threads.setStatus("t1", "idle", "")
	time.Sleep(300 * time.Millisecond)
	h.m.wg.Wait()
	if n := len(f.sentMessages()); n != base+2 {
		t.Fatalf("filtered machine still got %d messages", n-base-2)
	}
}

func TestChatTokenHandling(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.m.api.telegram = f.srv.URL

	if code, _ := h.call("PUT", chatTelegram, "", map[string]any{"botToken": "not a token"}); code != 400 {
		t.Errorf("garbage token: %d", code)
	}
	f.mu.Lock()
	f.getMeFail = true
	f.mu.Unlock()
	code, body := h.call("PUT", chatTelegram, "", map[string]any{"botToken": testTelegramToken})
	if code != 400 || strings.Contains(body, testTelegramToken) {
		t.Errorf("rejected token: %d %s", code, body)
	}
	if h.m.config(chatTelegram).BotToken != "" {
		t.Error("a rejected token was saved")
	}

	// A network failure never puts the token in the error text.
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	err := telegramCall(context.Background(), url, testTelegramToken, "getMe", nil, nil)
	if err == nil || strings.Contains(err.Error(), testTelegramToken) {
		t.Errorf("error leaks the token: %v", err)
	}

	f.mu.Lock()
	f.getMeFail = false
	f.mu.Unlock()
	h.linkTelegram(f)
	_, list := h.call("GET", "", "", nil)
	if strings.Contains(list, testTelegramToken) || strings.Contains(list, "TOKENtestTOKEN") {
		t.Errorf("list leaks the token: %s", list)
	}
	if !strings.Contains(list, "1234••••••••2345") {
		t.Errorf("token is not masked as expected: %s", list)
	}

	// Removing the integration forgets the token and closes open prompts.
	h.approval("perm7", "")
	waitFor(t, "sent", func() bool { return len(f.sentMessages()) == 4 })
	if code, _ := h.call("DELETE", chatTelegram, "", nil); code != 200 {
		t.Fatal(code)
	}
	if h.m.config(chatTelegram).BotToken != "" {
		t.Error("token kept after removing")
	}
	rows, _ := h.srv.store.chatPromptsFor("t1", "perm7")
	if len(rows) != 1 || rows[0].State != promptDone {
		t.Errorf("prompt after disconnect: %+v", rows)
	}
}

func TestChatTestMessageNeedsLink(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeTelegram(t)
	h.m.api.telegram = f.srv.URL
	h.call("PUT", chatTelegram, "", map[string]any{"botToken": testTelegramToken})
	waitFor(t, "connected", func() bool { return h.m.statusOf(chatTelegram).State == "connected" })
	if code, _ := h.call("POST", chatTelegram, "/test", nil); code != 409 {
		t.Errorf("test before linking: %d", code)
	}
	h.linkTelegram(f)
	base := len(f.sentMessages())
	if code, body := h.call("POST", chatTelegram, "/test", nil); code != 200 {
		t.Fatal(code, body)
	}
	if text := tgText(f.sentMessages()[base]); !strings.Contains(text, "test message") {
		t.Errorf("test text: %s", text)
	}
}
