package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Slack over Socket Mode: the hub opens a websocket to Slack (app-level
// token, connections:write), so Slack never needs to reach the hub. Messages
// are Block Kit with buttons; presses arrive as interactive envelopes.
// Only the linked channel and the allowed user ids can answer.

type slackTransport struct {
	m   *chatManager
	wmu sync.Mutex // one writer on the websocket
}

func newSlack(m *chatManager) *slackTransport { return &slackTransport{m: m} }

type slackResp struct {
	Ok      bool   `json:"ok"`
	Error   string `json:"error"`
	Channel string `json:"channel"`
	Ts      string `json:"ts"`
	URL     string `json:"url"`
	UserId  string `json:"user_id"`
	User    string `json:"user"`
}

type slackAPIError struct{ code string }

func (e *slackAPIError) Error() string { return "slack: " + e.code }

func slackFriendly(err error) string {
	var api *slackAPIError
	if errors.As(err, &api) {
		switch api.code {
		case "invalid_auth", "not_authed", "account_inactive", "token_revoked":
			return "Slack rejected a token. Check the bot token and the app-level token."
		case "channel_not_found", "not_in_channel":
			return "The bot cannot see that channel. Invite it with /invite @Overseer."
		case "missing_scope":
			return "The app is missing a scope. Re-create it from the manifest."
		case "invalid_arguments", "invalid_post_type":
			return "Slack refused the request: " + api.code
		}
		return "Slack said: " + api.code
	}
	return "Cannot reach Slack: " + err.Error()
}

// slackCall invokes a Web API method. form selects the content type for
// methods that only take form bodies (auth.test, apps.connections.open).
func slackCall(ctx context.Context, base, token, method string, body map[string]any, form bool) (slackResp, error) {
	var out slackResp
	headers := map[string]string{"Authorization": "Bearer " + token}
	var payload any = body
	if form {
		headers["Content-Type"] = "application/x-www-form-urlencoded"
		payload = nil
	}
	status, err := doJSON(ctx, http.MethodPost, base+"/"+method, headers, payload, &out, token)
	if err != nil {
		return out, err
	}
	if status == http.StatusTooManyRequests {
		return out, errors.New("slack is rate limiting requests, retry shortly")
	}
	if !out.Ok {
		code := out.Error
		if code == "" {
			code = http.StatusText(status)
		}
		return out, &slackAPIError{code}
	}
	return out, nil
}

// validateSlackToken checks the bot token and returns the bot's name and id.
func (m *chatManager) validateSlackToken(ctx context.Context, token string) (slackResp, error) {
	return slackCall(ctx, m.api.slack, token, "auth.test", nil, true)
}

var errSlackRefresh = errors.New("slack asked for a new connection")

func (t *slackTransport) run(ctx context.Context) {
	var bo chatBackoff
	for ctx.Err() == nil {
		err := t.session(ctx, &bo)
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, errSlackRefresh) {
			t.m.setStatus(chatSlack, "connecting", "")
			if !sleepCtx(ctx, time.Second) {
				return
			}
			continue
		}
		t.m.setStatus(chatSlack, "error", slackFriendly(err))
		if !sleepCtx(ctx, bo.next()) {
			return
		}
	}
}

type slackEnvelope struct {
	Type       string          `json:"type"`
	EnvelopeId string          `json:"envelope_id"`
	Reason     string          `json:"reason"`
	Payload    json.RawMessage `json:"payload"`
}

type slackInteraction struct {
	Type      string `json:"type"`
	TriggerId string `json:"trigger_id"`
	User      struct {
		Id       string `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
	} `json:"user"`
	Channel struct {
		Id string `json:"id"`
	} `json:"channel"`
	Container struct {
		ChannelId string `json:"channel_id"`
	} `json:"container"`
	Actions []struct {
		ActionId string `json:"action_id"`
	} `json:"actions"`
	View struct {
		CallbackId      string `json:"callback_id"`
		PrivateMetadata string `json:"private_metadata"`
		State           struct {
			Values map[string]map[string]struct {
				Value string `json:"value"`
			} `json:"values"`
		} `json:"state"`
	} `json:"view"`
}

func (t *slackTransport) session(ctx context.Context, bo *chatBackoff) error {
	cfg := t.m.config(chatSlack)
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	me, err := t.m.validateSlackToken(cctx, cfg.BotToken)
	if err != nil {
		return err
	}
	if cfg.BotName != me.User || cfg.BotId != me.UserId {
		t.m.updateConfig(chatSlack, func(c *chatConfig) { c.BotName, c.BotId = me.User, me.UserId })
	}
	open, err := slackCall(cctx, t.m.api.slack, cfg.AppToken, "apps.connections.open", nil, true)
	if err != nil {
		return err
	}
	conn, _, err := websocket.DefaultDialer.DialContext(cctx, open.URL, nil)
	if err != nil {
		return scrubErr(err, cfg.AppToken, cfg.BotToken)
	}
	defer conn.Close()
	conn.SetReadLimit(4 << 20)

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-stop:
		}
	}()
	const idle = 2 * time.Minute
	conn.SetReadDeadline(time.Now().Add(idle))
	conn.SetPongHandler(func(string) error { conn.SetReadDeadline(time.Now().Add(idle)); return nil })
	conn.SetPingHandler(func(data string) error {
		conn.SetReadDeadline(time.Now().Add(idle))
		t.wmu.Lock()
		defer t.wmu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(5*time.Second))
	})
	go func() { // keep the link alive and notice a dead one
		tick := time.NewTicker(30 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				t.wmu.Lock()
				err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
				t.wmu.Unlock()
				if err != nil {
					conn.Close()
					return
				}
			case <-stop:
				return
			}
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("connection to Slack lost: %w", scrubErr(err, cfg.AppToken))
		}
		conn.SetReadDeadline(time.Now().Add(idle))
		var env slackEnvelope
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		switch env.Type {
		case "hello":
			bo.reset()
			t.m.setStatus(chatSlack, "connected", "")
		case "disconnect":
			return errSlackRefresh
		default:
			if env.EnvelopeId != "" {
				t.wmu.Lock()
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				werr := conn.WriteJSON(map[string]string{"envelope_id": env.EnvelopeId})
				t.wmu.Unlock()
				if werr != nil {
					return werr
				}
			}
			if env.Type == "interactive" {
				go t.handleInteraction(ctx, env.Payload)
			}
		}
	}
}

func (t *slackTransport) handleInteraction(ctx context.Context, raw json.RawMessage) {
	var in slackInteraction
	if json.Unmarshal(raw, &in) != nil {
		return
	}
	cfg := t.m.config(chatSlack)
	user := in.User.Id
	switch in.Type {
	case "block_actions":
		channel := in.Channel.Id
		if channel == "" {
			channel = in.Container.ChannelId
		}
		if channel != cfg.Channel || len(in.Actions) == 0 {
			return
		}
		id := in.Actions[0].ActionId
		parts := strings.Split(id, ":")
		if len(parts) < 2 || parts[0] != "ov" || parts[1] == "open" {
			return
		}
		if parts[1] == "link" {
			t.link(ctx, cfg, channel, user)
			return
		}
		if !cfg.allows(user) {
			msg := "You are not allowed to answer from here."
			if len(cfg.AllowedUsers) == 0 {
				msg = "No account is linked yet. Press “Link me” on the test message in this channel first."
			}
			t.ephemeral(ctx, channel, user, msg)
			return
		}
		if len(parts) < 3 {
			return
		}
		a := chatAction{PromptId: parts[2], Actor: chatActor{UserId: user, Name: in.User.Name}}
		switch parts[1] {
		case "a":
			a.Op = "pick"
		case "t":
			a.Op = "toggle"
		case "s":
			a.Op = "send"
		case "x":
			t.openModal(ctx, in.TriggerId, parts[2])
			return
		default:
			return
		}
		if len(parts) > 3 {
			n, err := strconv.Atoi(parts[3])
			if err != nil {
				return
			}
			a.Index = n
		}
		t.finishAction(ctx, channel, user, t.m.act(chatSlack, a))
	case "view_submission":
		if in.View.CallbackId != "ov:text" {
			return
		}
		var text string
		for _, block := range in.View.State.Values {
			for _, field := range block {
				text = field.Value
			}
		}
		a := chatAction{PromptId: in.View.PrivateMetadata, Op: "text", Text: text, Actor: chatActor{UserId: user, Name: in.User.Name}}
		t.finishAction(ctx, cfg.Channel, user, t.m.act(chatSlack, a))
	}
}

func (t *slackTransport) finishAction(ctx context.Context, channel, user string, reply chatReply) {
	if reply.Alert && reply.Toast != "" {
		t.ephemeral(ctx, channel, user, reply.Toast)
	}
	if reply.Prompt != nil {
		t.editPrompt(ctx, reply.Prompt)
	}
}

// link records the first account that presses "Link me" as allowed to answer.
func (t *slackTransport) link(ctx context.Context, cfg chatConfig, channel, user string) {
	switch {
	case len(cfg.AllowedUsers) == 0:
		t.m.updateConfig(chatSlack, func(c *chatConfig) {
			if len(c.AllowedUsers) == 0 {
				c.AllowedUsers = []string{user}
			}
		})
		t.ephemeral(ctx, channel, user, "Linked. Only <@"+user+"> can answer agents from this channel now.")
	case cfg.allows(user):
		t.ephemeral(ctx, channel, user, "You are already linked.")
	default:
		t.ephemeral(ctx, channel, user, "Another account is already linked. Change it in Overseer: Settings → Chat apps.")
	}
}

func (t *slackTransport) ephemeral(ctx context.Context, channel, user, text string) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	t.call(cctx, "chat.postEphemeral", map[string]any{"channel": channel, "user": user, "text": text})
}

func (t *slackTransport) openModal(ctx context.Context, triggerId, promptId string) {
	p, _ := t.m.s.store.chatPromptById(promptId)
	label := "Your answer"
	if p != nil {
		label = clipRunes(p.Content.Title, 1900)
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	t.call(cctx, "views.open", map[string]any{"trigger_id": triggerId, "view": map[string]any{
		"type": "modal", "callback_id": "ov:text", "private_metadata": promptId,
		"title":  map[string]any{"type": "plain_text", "text": "Answer"},
		"submit": map[string]any{"type": "plain_text", "text": "Send"},
		"close":  map[string]any{"type": "plain_text", "text": "Cancel"},
		"blocks": []any{map[string]any{
			"type": "input", "block_id": "answer",
			"label":   map[string]any{"type": "plain_text", "text": label},
			"element": map[string]any{"type": "plain_text_input", "action_id": "text", "multiline": true},
		}},
	}})
}

func (t *slackTransport) call(ctx context.Context, method string, body map[string]any) (slackResp, error) {
	cfg := t.m.config(chatSlack)
	return slackCall(ctx, t.m.api.slack, cfg.BotToken, method, body, false)
}

// --- rendering ---

func slackEsc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func slackCode(s string) string { return "```" + slackEsc(strings.ReplaceAll(s, "```", "'''")) + "```" }

func slackText(p *chatPrompt) string {
	c := p.Content
	emoji, who, what := chatHeadline(c)
	var b strings.Builder
	fmt.Fprintf(&b, "%s *%s* · %s", emoji, slackEsc(who), slackEsc(what))
	switch c.Event {
	case evApproval, evFailed:
		if c.Detail != "" {
			b.WriteString("\n" + slackCode(clipRunes(c.Detail, 1500)))
		}
	case evQuestion:
		b.WriteString("\n\n" + slackEsc(clipRunes(c.Title, 1500)))
		for _, o := range c.Options {
			if o.Desc != "" {
				fmt.Fprintf(&b, "\n• *%s* — %s", slackEsc(clipRunes(o.Label, 80)), slackEsc(clipRunes(o.Desc, 160)))
			}
		}
	default:
		if c.Detail != "" {
			b.WriteString("\n" + slackEsc(c.Detail))
		}
	}
	if c.Session != "" && c.Event != evTest {
		fmt.Fprintf(&b, "\n_%s_", slackEsc(clipRunes(c.Session, 120)))
	}
	return b.String()
}

func slackButton(label, actionId, style string) map[string]any {
	btn := map[string]any{"type": "button", "text": map[string]any{"type": "plain_text", "text": clipRunes(label, 70)}, "action_id": actionId, "value": "x"}
	if style != "" {
		btn["style"] = style
	}
	return btn
}

func slackBlocks(p *chatPrompt, offerLink bool) []any {
	c := p.Content
	blocks := []any{map[string]any{"type": "section", "text": map[string]any{"type": "mrkdwn", "text": clipRunes(slackText(p), 2900)}}}
	var buttons []any
	if p.State != promptDone {
		switch {
		case c.Event == evApproval:
			for i, o := range c.Options {
				style := ""
				switch o.Kind {
				case "allow_once":
					style = "primary"
				case "reject_once", "reject_always":
					style = "danger"
				}
				buttons = append(buttons, slackButton(o.buttonLabel(), fmt.Sprintf("ov:a:%s:%d", p.Id, i), style))
			}
		case c.Event == evQuestion && c.Multiple:
			for i, o := range c.Options {
				label, style := o.Label, ""
				if containsInt(c.Picked, i) {
					label, style = "✓ "+label, "primary"
				}
				buttons = append(buttons, slackButton(label, fmt.Sprintf("ov:t:%s:%d", p.Id, i), style))
			}
			buttons = append(buttons, slackButton("Send answer", "ov:s:"+p.Id, "primary"))
		case c.Event == evQuestion:
			for i, o := range c.Options {
				buttons = append(buttons, slackButton(o.Label, fmt.Sprintf("ov:a:%s:%d", p.Id, i), ""))
			}
		}
		if c.Event == evQuestion && c.AllowText {
			buttons = append(buttons, slackButton("Reply…", "ov:x:"+p.Id, ""))
		}
	} else if p.Outcome != "" {
		blocks = append(blocks, map[string]any{"type": "context", "elements": []any{map[string]any{"type": "mrkdwn", "text": "*" + slackEsc(p.Outcome) + "*"}}})
	}
	if offerLink {
		buttons = append(buttons, slackButton("Link me", "ov:link", "primary"))
	}
	if c.Link != "" {
		buttons = append(buttons, map[string]any{"type": "button", "text": map[string]any{"type": "plain_text", "text": "Open"}, "url": c.Link, "action_id": "ov:open"})
	}
	for len(buttons) > 0 {
		n := min(len(buttons), 5)
		blocks = append(blocks, map[string]any{"type": "actions", "elements": buttons[:n]})
		buttons = buttons[n:]
	}
	return blocks
}

func slackPlain(p *chatPrompt) string {
	_, who, what := chatHeadline(p.Content)
	return who + " · " + what
}

func (t *slackTransport) post(ctx context.Context, p *chatPrompt, offerLink bool) (string, error) {
	cfg := t.m.config(chatSlack)
	resp, err := t.call(ctx, "chat.postMessage", map[string]any{
		"channel": cfg.Channel, "text": slackPlain(p), "blocks": slackBlocks(p, offerLink), "unfurl_links": false,
	})
	if err != nil {
		return "", err
	}
	if resp.Channel != "" && resp.Channel != cfg.Channel {
		// A user id was entered: from here on the conversation is the DM.
		t.m.updateConfig(chatSlack, func(c *chatConfig) { c.Channel = resp.Channel })
	}
	return resp.Ts, nil
}

func (t *slackTransport) sendPrompt(ctx context.Context, p *chatPrompt) (string, error) {
	return t.post(ctx, p, false)
}

func (t *slackTransport) editPrompt(ctx context.Context, p *chatPrompt) error {
	_, err := t.call(ctx, "chat.update", map[string]any{
		"channel": t.m.config(chatSlack).Channel, "ts": p.Ref, "text": slackPlain(p), "blocks": slackBlocks(p, false),
	})
	return err
}

func (t *slackTransport) sendNote(ctx context.Context, n chatNote) error {
	cfg := t.m.config(chatSlack)
	p := &chatPrompt{State: promptDone, Content: n.Content}
	if n.Content.Event == evTest && len(cfg.AllowedUsers) == 0 {
		p.Content.Detail += "\nPress “Link me” so only your account can answer agents from this channel."
		_, err := t.post(ctx, p, true)
		return err
	}
	_, err := t.post(ctx, p, false)
	return err
}
