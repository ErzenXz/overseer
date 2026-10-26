package hub

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

const (
	testSlackBot = "xox" + "b-1234567890-abcdefghijklmnop" // split so secret scanners ignore the fake
	testSlackApp = "xa" + "pp-1-A0123456789-1234567890-abcdef0123"
	testSlackCh  = "C0123ABCDEF"
	testSlackMe  = "U111AAAAAA"
)

// --- fake Slack: Web API and Socket Mode ---

type fakeSlack struct {
	t   *testing.T
	srv *httptest.Server

	mu         sync.Mutex
	posts      []map[string]any
	updates    []map[string]any
	ephemerals []map[string]any
	views      []map[string]any
	acks       []string
	conn       *websocket.Conn
	connected  chan struct{}
	wmu        sync.Mutex
}

func newFakeSlack(t *testing.T) *fakeSlack {
	f := &fakeSlack{t: t, connected: make(chan struct{}, 4)}
	mux := http.NewServeMux()
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	json200 := func(w http.ResponseWriter, v any) { json.NewEncoder(w).Encode(v) }
	mux.HandleFunc("/auth.test", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSlackBot {
			json200(w, map[string]any{"ok": false, "error": "invalid_auth"})
			return
		}
		json200(w, map[string]any{"ok": true, "user_id": "UBOT00001", "user": "overseer"})
	})
	mux.HandleFunc("/apps.connections.open", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSlackApp {
			json200(w, map[string]any{"ok": false, "error": "invalid_auth"})
			return
		}
		json200(w, map[string]any{"ok": true, "url": "ws" + strings.TrimPrefix(f.srv.URL, "http") + "/ws"})
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.conn = conn
		f.mu.Unlock()
		f.wmu.Lock()
		conn.WriteJSON(map[string]any{"type": "hello"})
		f.wmu.Unlock()
		f.connected <- struct{}{}
		for {
			var v map[string]any
			if conn.ReadJSON(&v) != nil {
				return
			}
			if id, ok := v["envelope_id"].(string); ok {
				f.mu.Lock()
				f.acks = append(f.acks, id)
				f.mu.Unlock()
			}
		}
	})
	record := func(dst *[]map[string]any, reply func(body map[string]any) map[string]any) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+testSlackBot {
				json200(w, map[string]any{"ok": false, "error": "invalid_auth"})
				return
			}
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			f.mu.Lock()
			*dst = append(*dst, body)
			n := len(*dst)
			f.mu.Unlock()
			out := reply(body)
			out["ts"] = "1700000000.00" + string(rune('0'+n))
			json200(w, out)
		}
	}
	echo := func(body map[string]any) map[string]any {
		return map[string]any{"ok": true, "channel": body["channel"]}
	}
	mux.HandleFunc("/chat.postMessage", record(&f.posts, echo))
	mux.HandleFunc("/chat.update", record(&f.updates, echo))
	mux.HandleFunc("/chat.postEphemeral", record(&f.ephemerals, echo))
	mux.HandleFunc("/views.open", record(&f.views, func(map[string]any) map[string]any { return map[string]any{"ok": true} }))
	return f
}

func (f *fakeSlack) send(v any) {
	f.mu.Lock()
	c := f.conn
	f.mu.Unlock()
	f.wmu.Lock()
	defer f.wmu.Unlock()
	if err := c.WriteJSON(v); err != nil {
		f.t.Error(err)
	}
}

func (f *fakeSlack) count(list *[]map[string]any) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(*list)
}

func (f *fakeSlack) at(list *[]map[string]any, i int) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return (*list)[i]
}

func blockText(b any) string {
	out, _ := json.Marshal(b)
	return string(out)
}

// actionIds lists the button action ids in a message's blocks.
func actionIds(blocks any) []string {
	var ids []string
	for _, b := range blocks.([]any) {
		blk := b.(map[string]any)
		if blk["type"] != "actions" {
			continue
		}
		for _, e := range blk["elements"].([]any) {
			ids = append(ids, e.(map[string]any)["action_id"].(string))
		}
	}
	return ids
}

func (f *fakeSlack) press(envelope, user, channel, actionId string) {
	f.send(map[string]any{"envelope_id": envelope, "type": "interactive", "payload": map[string]any{
		"type": "block_actions", "trigger_id": "trig-" + envelope, "user": map[string]any{"id": user, "name": "erzen"},
		"channel": map[string]any{"id": channel}, "actions": []any{map[string]any{"action_id": actionId}},
	}})
}

func TestSlackSocketModeApproval(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeSlack(t)
	h.m.api.slack = f.srv.URL

	if code, body := h.call("PUT", chatSlack, "", map[string]any{"botToken": "xoxb-wrong-wrong-wrong"}); code != 400 {
		t.Errorf("bad bot token accepted: %d %s", code, body)
	}
	code, body := h.call("PUT", chatSlack, "", map[string]any{"botToken": testSlackBot, "appToken": testSlackApp, "channel": testSlackCh})
	if code != 200 {
		t.Fatal(code, body)
	}
	if strings.Contains(body, testSlackBot) || strings.Contains(body, testSlackApp) {
		t.Fatalf("settings response leaks a token: %s", body)
	}
	<-f.connected
	waitFor(t, "slack connected", func() bool { return h.m.statusOf(chatSlack).State == "connected" })

	// Nobody is linked yet: a press does nothing, "Link me" records the user.
	if code, body := h.call("POST", chatSlack, "/test", nil); code != 200 {
		t.Fatal(code, body)
	}
	if ids := actionIds(f.at(&f.posts, 0)["blocks"]); len(ids) == 0 || ids[0] != "ov:link" {
		t.Fatalf("test message buttons = %v", ids)
	}
	f.press("e0", "UEVIL0001", testSlackCh, "ov:link")
	waitFor(t, "first link", func() bool { return len(h.m.config(chatSlack).AllowedUsers) == 1 })
	f.press("e00", testSlackMe, testSlackCh, "ov:link") // too late: someone else holds it
	waitFor(t, "second link answered", func() bool { return f.count(&f.ephemerals) == 2 })
	if got := h.m.config(chatSlack).AllowedUsers[0]; got != "UEVIL0001" {
		t.Fatalf("linked user = %s", got)
	}
	// The owner corrects the allowed list in Settings.
	if code, body := h.call("PUT", chatSlack, "", map[string]any{"allowedUsers": []string{testSlackMe}}); code != 200 {
		t.Fatal(code, body)
	}

	h.approval("perm1", "")
	waitFor(t, "approval post", func() bool { return f.count(&f.posts) == 2 })
	post := f.at(&f.posts, 1)
	text := blockText(post["blocks"])
	for _, want := range []string{"Studio", "Claude Code wants to run the auth tests", "go test ./internal/auth/...", "Fix flaky auth tests"} {
		if !strings.Contains(text, want) {
			t.Errorf("blocks missing %q: %s", want, text)
		}
	}
	ids := actionIds(post["blocks"])
	if len(ids) != 4 || ids[3] != "ov:open" {
		t.Fatalf("action ids = %v", ids)
	}

	f.press("e1", "UEVIL0001", testSlackCh, ids[0])  // not allowed any more
	f.press("e2", testSlackMe, "COTHER0001", ids[0]) // wrong channel
	f.press("e3", testSlackMe, testSlackCh, ids[0])
	waitFor(t, "approval delivered", func() bool { return len(h.approvals()) == 1 })
	if got := h.approvals()[0]; got != (approveCall{"t1", "perm1", "allow"}) {
		t.Fatalf("approved = %+v", got)
	}
	waitFor(t, "message updated", func() bool { return f.count(&f.updates) == 1 })
	upd := f.at(&f.updates, 0)
	if !strings.Contains(blockText(upd["blocks"]), "Allowed by you") || upd["ts"] == nil {
		t.Errorf("update = %v", upd)
	}
	if ids := actionIds(upd["blocks"]); len(ids) != 1 || ids[0] != "ov:open" {
		t.Errorf("buttons after answering = %v", ids)
	}
	f.press("e4", testSlackMe, testSlackCh, ids[2]) // replay
	waitFor(t, "acks", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.acks) >= 6 })
	time.Sleep(100 * time.Millisecond)
	if len(h.approvals()) != 1 {
		t.Fatalf("replayed press delivered again: %+v", h.approvals())
	}
	f.mu.Lock()
	acks := strings.Join(f.acks, ",")
	f.mu.Unlock()
	for _, id := range []string{"e0", "e1", "e2", "e3", "e4"} {
		if !strings.Contains(acks, id) {
			t.Errorf("envelope %s was not acknowledged (acks: %s)", id, acks)
		}
	}
}

func TestSlackQuestionModalAndReconnect(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeSlack(t)
	h.m.api.slack = f.srv.URL
	h.call("PUT", chatSlack, "", map[string]any{"botToken": testSlackBot, "appToken": testSlackApp, "channel": testSlackCh, "allowedUsers": []string{testSlackMe}})
	<-f.connected
	waitFor(t, "connected", func() bool { return h.m.statusOf(chatSlack).State == "connected" })

	h.question("q1", false, true)
	waitFor(t, "question post", func() bool { return f.count(&f.posts) == 1 })
	ids := actionIds(f.at(&f.posts, 0)["blocks"])
	if len(ids) != 4 || !strings.HasPrefix(ids[2], "ov:x:") {
		t.Fatalf("question buttons = %v", ids)
	}
	f.press("q-a", testSlackMe, testSlackCh, ids[2])
	waitFor(t, "modal opened", func() bool { return f.count(&f.views) == 1 })
	view := f.at(&f.views, 0)["view"].(map[string]any)
	if view["callback_id"] != "ov:text" || view["private_metadata"] == "" {
		t.Fatalf("modal = %v", view)
	}
	f.send(map[string]any{"envelope_id": "v1", "type": "interactive", "payload": map[string]any{
		"type": "view_submission", "user": map[string]any{"id": testSlackMe},
		"view": map[string]any{"callback_id": "ov:text", "private_metadata": view["private_metadata"],
			"state": map[string]any{"values": map[string]any{"answer": map[string]any{"text": map[string]any{"value": "use sqlite"}}}}},
	}})
	waitFor(t, "text answer", func() bool { return len(h.answers()) == 1 })
	if got := h.answers()[0]; got.text != "use sqlite" || got.id != "q1" {
		t.Fatalf("answer = %+v", got)
	}

	// Slack asks for a new connection: the hub reconnects by itself.
	f.send(map[string]any{"type": "disconnect", "reason": "refresh_requested"})
	<-f.connected
	waitFor(t, "reconnected", func() bool { return h.m.statusOf(chatSlack).State == "connected" })
}

func TestSlackDirectMessageChannel(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeSlack(t)
	h.m.api.slack = f.srv.URL
	// A member id as the channel: the first post resolves it to the DM id.
	h.call("PUT", chatSlack, "", map[string]any{"botToken": testSlackBot, "appToken": testSlackApp, "channel": testSlackMe})
	if got := h.m.config(chatSlack); len(got.AllowedUsers) != 1 || got.AllowedUsers[0] != testSlackMe {
		t.Fatalf("a DM should allow only that user: %+v", got.AllowedUsers)
	}
	<-f.connected
	waitFor(t, "connected", func() bool { return h.m.statusOf(chatSlack).State == "connected" })
	h.approval("p1", "")
	waitFor(t, "post", func() bool { return f.count(&f.posts) == 1 })
	if f.at(&f.posts, 0)["channel"] != testSlackMe {
		t.Fatalf("posted to %v", f.at(&f.posts, 0)["channel"])
	}
}

// --- fake Discord: REST and gateway ---

const (
	testDiscordBot = "MTAwMDAwMDAwMDAwMDAwMDAw.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789"
	testDiscordCh  = "123456789012345678"
	testDiscordMe  = "223456789012345678"
)

type fakeDiscord struct {
	t   *testing.T
	srv *httptest.Server

	mu        sync.Mutex
	posts     []map[string]any
	patches   []map[string]any
	callbacks []map[string]any
	identify  map[string]any
	conn      *websocket.Conn
	ready     chan struct{}
	wmu       sync.Mutex
}

func newFakeDiscord(t *testing.T) *fakeDiscord {
	f := &fakeDiscord{t: t, ready: make(chan struct{}, 4)}
	mux := http.NewServeMux()
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	authed := func(r *http.Request) bool { return r.Header.Get("Authorization") == "Bot "+testDiscordBot }
	mux.HandleFunc("GET /users/@me", func(w http.ResponseWriter, r *http.Request) {
		if !authed(r) {
			w.WriteHeader(401)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "100000000000000001", "username": "overseer-bot"})
	})
	mux.HandleFunc("POST /channels/{ch}/messages", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.posts = append(f.posts, body)
		n := len(f.posts)
		f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"id": "90000000000000" + string(rune('0'+n))})
	})
	mux.HandleFunc("PATCH /channels/{ch}/messages/{id}", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.patches = append(f.patches, body)
		f.mu.Unlock()
		w.Write([]byte("{}"))
	})
	mux.HandleFunc("POST /interactions/{id}/{token}/callback", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.callbacks = append(f.callbacks, body)
		f.mu.Unlock()
		w.WriteHeader(204)
	})
	mux.HandleFunc("/gw", func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.conn = conn
		f.mu.Unlock()
		f.wmu.Lock()
		conn.WriteJSON(map[string]any{"op": 10, "d": map[string]any{"heartbeat_interval": 60000}})
		f.wmu.Unlock()
		for {
			var v struct {
				Op int            `json:"op"`
				D  map[string]any `json:"d"`
			}
			if conn.ReadJSON(&v) != nil {
				return
			}
			if v.Op == 2 {
				f.mu.Lock()
				f.identify = v.D
				f.mu.Unlock()
				f.wmu.Lock()
				conn.WriteJSON(map[string]any{"op": 0, "s": 1, "t": "READY", "d": map[string]any{}})
				f.wmu.Unlock()
				f.ready <- struct{}{}
			}
		}
	})
	return f
}

func (f *fakeDiscord) gatewayURL() string {
	return "ws" + strings.TrimPrefix(f.srv.URL, "http") + "/gw"
}

func (f *fakeDiscord) interact(typ int, user, channel, customId string, extra map[string]any) {
	data := map[string]any{"custom_id": customId}
	for k, v := range extra {
		data[k] = v
	}
	f.wmu.Lock()
	defer f.wmu.Unlock()
	f.mu.Lock()
	c := f.conn
	f.mu.Unlock()
	c.WriteJSON(map[string]any{"op": 0, "s": 2, "t": "INTERACTION_CREATE", "d": map[string]any{
		"id": "int" + customId, "token": "tok" + customId, "type": typ, "channel_id": channel,
		"member":  map[string]any{"user": map[string]any{"id": user, "username": "erzen"}},
		"message": map[string]any{"id": "900000000000001"}, "data": data,
	}})
}

func (f *fakeDiscord) callbackCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.callbacks)
}

func discordButtonIds(msg map[string]any) []string {
	var ids []string
	for _, row := range msg["components"].([]any) {
		for _, c := range row.(map[string]any)["components"].([]any) {
			if id, ok := c.(map[string]any)["custom_id"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func TestDiscordGatewayApproval(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeDiscord(t)
	h.m.api.discord = f.srv.URL
	h.m.api.discordGateway = f.gatewayURL()

	if code, _ := h.call("PUT", chatDiscord, "", map[string]any{"botToken": strings.Repeat("x", 60), "channel": testDiscordCh}); code != 400 {
		t.Errorf("rejected bot token accepted: %d", code)
	}
	code, body := h.call("PUT", chatDiscord, "", map[string]any{"botToken": testDiscordBot, "channel": testDiscordCh, "allowedUsers": []string{testDiscordMe}})
	if code != 200 {
		t.Fatal(code, body)
	}
	if strings.Contains(body, testDiscordBot) || !strings.Contains(body, "client_id=100000000000000001") {
		t.Fatalf("unexpected settings response: %s", body)
	}
	<-f.ready
	waitFor(t, "discord connected", func() bool { return h.m.statusOf(chatDiscord).State == "connected" })
	f.mu.Lock()
	if f.identify["token"] != testDiscordBot || f.identify["intents"].(float64) != 0 {
		t.Errorf("identify = %v", f.identify)
	}
	f.mu.Unlock()

	h.approval("perm1", "")
	waitFor(t, "approval post", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.posts) == 1 })
	f.mu.Lock()
	post := f.posts[0]
	f.mu.Unlock()
	if c := post["content"].(string); !strings.Contains(c, "Studio") || !strings.Contains(c, "go test ./internal/auth/...") {
		t.Errorf("content = %s", c)
	}
	ids := discordButtonIds(post)
	if len(ids) != 3 {
		t.Fatalf("buttons = %v", ids)
	}

	f.interact(3, "999999999999999999", testDiscordCh, ids[0], nil) // not allowed
	f.interact(3, testDiscordMe, "323456789012345678", ids[0], nil) // wrong channel: ignored
	waitFor(t, "refusal", func() bool { return f.callbackCount() == 1 })
	f.mu.Lock()
	if f.callbacks[0]["type"].(float64) != 4 {
		t.Errorf("refusal = %v", f.callbacks[0])
	}
	f.mu.Unlock()
	if len(h.approvals()) != 0 {
		t.Fatal("a stranger answered")
	}

	f.interact(3, testDiscordMe, testDiscordCh, ids[2], nil) // Reject
	waitFor(t, "delivered", func() bool { return len(h.approvals()) == 1 })
	if got := h.approvals()[0]; got.option != "deny" {
		t.Fatalf("approved = %+v", got)
	}
	waitFor(t, "update callback", func() bool { return f.callbackCount() == 2 })
	f.mu.Lock()
	cb := f.callbacks[1]
	f.mu.Unlock()
	data := cb["data"].(map[string]any)
	if cb["type"].(float64) != 7 || !strings.Contains(data["content"].(string), "Rejected by you") {
		t.Errorf("update = %v", cb)
	}
	if ids := discordButtonIds(data); len(ids) != 0 {
		t.Errorf("buttons stayed after answering: %v", ids)
	}
	f.interact(3, testDiscordMe, testDiscordCh, ids[0], nil) // replay
	waitFor(t, "replay answered", func() bool { return f.callbackCount() == 3 })
	if len(h.approvals()) != 1 {
		t.Fatal("replay delivered twice")
	}
}

func TestDiscordTextAnswerAndResolvedElsewhere(t *testing.T) {
	h := newChatHarness(t)
	f := newFakeDiscord(t)
	h.m.api.discord = f.srv.URL
	h.m.api.discordGateway = f.gatewayURL()
	h.call("PUT", chatDiscord, "", map[string]any{"botToken": testDiscordBot, "channel": testDiscordCh, "allowedUsers": []string{testDiscordMe}})
	<-f.ready
	waitFor(t, "connected", func() bool { return h.m.statusOf(chatDiscord).State == "connected" })

	h.question("q1", false, true)
	waitFor(t, "post", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.posts) == 1 })
	f.mu.Lock()
	ids := discordButtonIds(f.posts[0])
	f.mu.Unlock()
	f.interact(3, testDiscordMe, testDiscordCh, ids[2], nil) // Reply…
	waitFor(t, "modal", func() bool { return f.callbackCount() == 1 })
	f.mu.Lock()
	if f.callbacks[0]["type"].(float64) != 9 {
		t.Fatalf("expected a modal, got %v", f.callbacks[0])
	}
	f.mu.Unlock()
	f.interact(5, testDiscordMe, testDiscordCh, strings.Replace(ids[2], "ov:x:", "ov:text:", 1), map[string]any{
		"components": []any{map[string]any{"components": []any{map[string]any{"custom_id": "text", "value": "go with sqlite"}}}},
	})
	waitFor(t, "text answer", func() bool { return len(h.answers()) == 1 })
	if h.answers()[0].text != "go with sqlite" {
		t.Fatalf("answer = %+v", h.answers()[0])
	}

	// Answered in the app first: the Discord message is edited to say so.
	h.approval("perm2", "")
	waitFor(t, "approval post", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.posts) == 2 })
	h.approval("perm2", "allow")
	waitFor(t, "patched", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.patches) == 1 })
	f.mu.Lock()
	defer f.mu.Unlock()
	if !strings.Contains(f.patches[0]["content"].(string), "Allowed in Overseer") {
		t.Errorf("patch = %v", f.patches[0])
	}
}

// --- webhook ---

func TestWebhookEvents(t *testing.T) {
	h := newChatHarness(t)
	var mu sync.Mutex
	var bodies []map[string]any
	var sigs []string
	var raws []string
	rcv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 1<<16)
		n, _ := r.Body.Read(b)
		var v map[string]any
		json.Unmarshal(b[:n], &v)
		mu.Lock()
		bodies, sigs, raws = append(bodies, v), append(sigs, r.Header.Get("X-Overseer-Signature")), append(raws, string(b[:n]))
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer rcv.Close()

	if code, _ := h.call("PUT", chatWebhook, "", map[string]any{"webhookUrl": "ftp://nope"}); code != 400 {
		t.Errorf("bad url accepted: %d", code)
	}
	code, body := h.call("PUT", chatWebhook, "", map[string]any{
		"webhookUrl": rcv.URL + "/hook/secret-path", "webhookSecret": "s3cret-value", "events": []string{"approval", "question", "finished", "failed"},
	})
	if code != 200 || strings.Contains(body, "secret-path") || strings.Contains(body, "s3cret-value") {
		t.Fatalf("webhook settings: %d %s", code, body)
	}
	waitFor(t, "ready", func() bool { return h.m.statusOf(chatWebhook).State == "connected" })

	h.approval("perm1", "")
	waitFor(t, "approval event", func() bool { mu.Lock(); defer mu.Unlock(); return len(bodies) == 1 })
	mu.Lock()
	ev, sig, raw := bodies[0], sigs[0], raws[0]
	mu.Unlock()
	if ev["type"] != "approval" || ev["command"] != "go test ./internal/auth/..." || ev["title"] != "Run the auth tests" {
		t.Errorf("event = %v", ev)
	}
	if s := ev["session"].(map[string]any); s["id"] != "t1" || s["title"] != "Fix flaky auth tests" {
		t.Errorf("session = %v", s)
	}
	if m := ev["machine"].(map[string]any); m["name"] != "Studio" {
		t.Errorf("machine = %v", m)
	}
	if a := ev["agent"].(map[string]any); a["id"] != "claude" {
		t.Errorf("agent = %v", a)
	}
	if ev["links"].(map[string]any)["open"] != "https://hub.example.com/sessions/t1" {
		t.Errorf("links = %v", ev["links"])
	}
	mac := hmac.New(sha256.New, []byte("s3cret-value"))
	mac.Write([]byte(raw))
	if sig != "sha256="+hex.EncodeToString(mac.Sum(nil)) {
		t.Errorf("signature = %s", sig)
	}

	h.srv.threads.setStatus("t1", "working", "")
	h.srv.threads.setStatus("t1", "error", "boom")
	waitFor(t, "failed event", func() bool { mu.Lock(); defer mu.Unlock(); return len(bodies) == 2 })
	mu.Lock()
	if bodies[1]["type"] != "failed" || bodies[1]["error"] != "boom" {
		t.Errorf("failed event = %v", bodies[1])
	}
	mu.Unlock()
	_ = protocol.TypeThreadApproval
}
