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
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Discord: a bot token, one channel, and the gateway websocket. Buttons
// arrive as INTERACTION_CREATE events on the gateway, so no interactions URL
// (and no public address) is needed. No intents are requested: interactions
// and the bot's own messages need none.

type discordTransport struct {
	m   *chatManager
	wmu sync.Mutex
}

func newDiscord(m *chatManager) *discordTransport { return &discordTransport{m: m} }

type discordError struct {
	status int
	msg    string
}

func (e *discordError) Error() string { return fmt.Sprintf("discord: %s (%d)", e.msg, e.status) }

func discordFriendly(err error) string {
	var de *discordError
	if errors.As(err, &de) {
		switch de.status {
		case 401:
			return "Discord rejected the bot token."
		case 403:
			return "The bot cannot post in that channel. Invite it and allow View Channel and Send Messages."
		case 404:
			return "Discord cannot find that channel id."
		}
		return de.msg
	}
	var ce *websocket.CloseError
	if errors.As(err, &ce) {
		switch ce.Code {
		case 4004:
			return "Discord rejected the bot token."
		case 4013, 4014:
			return "Discord refused the gateway request (intents)."
		}
	}
	return "Cannot reach Discord: " + err.Error()
}

// discordCall calls the REST API as the bot.
func discordCall(ctx context.Context, base, token, method, path string, body, out any) error {
	status, err := doJSON(ctx, method, base+path, map[string]string{"Authorization": "Bot " + token}, body, out, token)
	if err != nil {
		return err
	}
	if status == http.StatusNoContent || (status >= 200 && status < 300) {
		return nil
	}
	msg := http.StatusText(status)
	if status == http.StatusTooManyRequests {
		msg = "Discord is rate limiting requests, retry shortly"
	}
	return &discordError{status: status, msg: msg}
}

type discordUser struct {
	Id       string `json:"id"`
	Username string `json:"username"`
}

func (m *chatManager) validateDiscordToken(ctx context.Context, token string) (discordUser, error) {
	var u discordUser
	err := discordCall(ctx, m.api.discord, token, http.MethodGet, "/users/@me", nil, &u)
	return u, err
}

func (t *discordTransport) call(ctx context.Context, method, path string, body, out any) error {
	return discordCall(ctx, t.m.api.discord, t.m.config(chatDiscord).BotToken, method, path, body, out)
}

func (t *discordTransport) run(ctx context.Context) {
	var bo chatBackoff
	for ctx.Err() == nil {
		err := t.session(ctx, &bo)
		if ctx.Err() != nil {
			return
		}
		t.m.setStatus(chatDiscord, "error", discordFriendly(err))
		if !sleepCtx(ctx, bo.next()) {
			return
		}
	}
}

type dcFrame struct {
	Op int             `json:"op"`
	S  *int64          `json:"s"`
	T  string          `json:"t"`
	D  json.RawMessage `json:"d"`
}

type dcInteraction struct {
	Id        string `json:"id"`
	Token     string `json:"token"`
	Type      int    `json:"type"`
	ChannelId string `json:"channel_id"`
	Member    *struct {
		User discordUser `json:"user"`
	} `json:"member"`
	User    *discordUser `json:"user"`
	Message *struct {
		Id string `json:"id"`
	} `json:"message"`
	Data struct {
		CustomId   string `json:"custom_id"`
		Components []struct {
			Components []struct {
				CustomId string `json:"custom_id"`
				Value    string `json:"value"`
			} `json:"components"`
		} `json:"components"`
	} `json:"data"`
}

var errDiscordReconnect = errors.New("discord asked to reconnect")

func (t *discordTransport) session(ctx context.Context, bo *chatBackoff) error {
	cfg := t.m.config(chatDiscord)
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	me, err := t.m.validateDiscordToken(cctx, cfg.BotToken)
	cancel()
	if err != nil {
		return err
	}
	if cfg.BotName != me.Username || cfg.BotId != me.Id {
		t.m.updateConfig(chatDiscord, func(c *chatConfig) { c.BotName, c.BotId = me.Username, me.Id })
	}
	dctx, dcancel := context.WithTimeout(ctx, 20*time.Second)
	conn, _, err := websocket.DefaultDialer.DialContext(dctx, t.m.api.discordGateway, nil)
	dcancel()
	if err != nil {
		return scrubErr(err, cfg.BotToken)
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
	write := func(v any) error {
		t.wmu.Lock()
		defer t.wmu.Unlock()
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(v)
	}

	var seq atomic.Int64
	seq.Store(-1)
	var acked atomic.Bool
	acked.Store(true)
	identified := false
	for {
		conn.SetReadDeadline(time.Now().Add(3 * time.Minute))
		_, data, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return scrubErr(err, cfg.BotToken)
		}
		var f dcFrame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		if f.S != nil {
			seq.Store(*f.S)
		}
		switch f.Op {
		case 10: // hello
			var hello struct {
				Interval float64 `json:"heartbeat_interval"`
			}
			json.Unmarshal(f.D, &hello)
			interval := time.Duration(hello.Interval) * time.Millisecond
			if interval < time.Second {
				interval = 41250 * time.Millisecond
			}
			go func() {
				if !sleepCtx(ctx, interval/2) {
					return
				}
				tick := time.NewTicker(interval)
				defer tick.Stop()
				for {
					if !acked.Swap(false) { // the last beat was never answered: the link is dead
						conn.Close()
						return
					}
					var d any
					if n := seq.Load(); n >= 0 {
						d = n
					}
					if write(map[string]any{"op": 1, "d": d}) != nil {
						conn.Close()
						return
					}
					select {
					case <-tick.C:
					case <-stop:
						return
					case <-ctx.Done():
						return
					}
				}
			}()
			if !identified {
				identified = true
				if err := write(map[string]any{"op": 2, "d": map[string]any{
					"token": cfg.BotToken, "intents": 0,
					"properties": map[string]string{"os": "linux", "browser": "overseer", "device": "overseer"},
				}}); err != nil {
					return err
				}
			}
		case 11:
			acked.Store(true)
		case 1: // the gateway asks for a beat now
			var d any
			if n := seq.Load(); n >= 0 {
				d = n
			}
			write(map[string]any{"op": 1, "d": d})
		case 7:
			return errDiscordReconnect
		case 9:
			return errors.New("discord invalidated the session")
		case 0:
			switch f.T {
			case "READY":
				bo.reset()
				t.m.setStatus(chatDiscord, "connected", "")
			case "INTERACTION_CREATE":
				var in dcInteraction
				if json.Unmarshal(f.D, &in) == nil {
					go t.handleInteraction(ctx, in)
				}
			}
		}
	}
}

func (in dcInteraction) userId() (id, name string) {
	switch {
	case in.Member != nil:
		return in.Member.User.Id, in.Member.User.Username
	case in.User != nil:
		return in.User.Id, in.User.Username
	}
	return "", ""
}

// respond answers an interaction (it must happen within 3 seconds).
func (t *discordTransport) respond(ctx context.Context, in dcInteraction, kind int, data map[string]any) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	body := map[string]any{"type": kind}
	if data != nil {
		body["data"] = data
	}
	t.call(cctx, http.MethodPost, "/interactions/"+in.Id+"/"+in.Token+"/callback", body, nil)
}

func (t *discordTransport) toast(ctx context.Context, in dcInteraction, text string) {
	t.respond(ctx, in, 4, map[string]any{"content": text, "flags": 64})
}

func (t *discordTransport) handleInteraction(ctx context.Context, in dcInteraction) {
	cfg := t.m.config(chatDiscord)
	if in.ChannelId != cfg.Channel || (in.Type != 3 && in.Type != 5) {
		return
	}
	user, name := in.userId()
	parts := strings.Split(in.Data.CustomId, ":")
	if len(parts) < 2 || parts[0] != "ov" {
		return
	}
	if parts[1] == "link" {
		switch {
		case len(cfg.AllowedUsers) == 0:
			t.m.updateConfig(chatDiscord, func(c *chatConfig) {
				if len(c.AllowedUsers) == 0 {
					c.AllowedUsers = []string{user}
				}
			})
			t.toast(ctx, in, "Linked. Only <@"+user+"> can answer agents from this channel now.")
		case cfg.allows(user):
			t.toast(ctx, in, "You are already linked.")
		default:
			t.toast(ctx, in, "Another account is already linked. Change it in Overseer: Settings → Chat apps.")
		}
		return
	}
	if !cfg.allows(user) {
		msg := "You are not allowed to answer from here."
		if len(cfg.AllowedUsers) == 0 {
			msg = "No account is linked yet. Press “Link me” on the test message in this channel first."
		}
		t.toast(ctx, in, msg)
		return
	}
	if len(parts) < 3 {
		return
	}
	a := chatAction{PromptId: parts[2], Actor: chatActor{UserId: user, Name: name}}
	switch {
	case in.Type == 5 && parts[1] == "text":
		a.Op = "text"
		for _, row := range in.Data.Components {
			for _, c := range row.Components {
				a.Text = c.Value
			}
		}
	case in.Type == 3 && parts[1] == "a":
		a.Op = "pick"
	case in.Type == 3 && parts[1] == "t":
		a.Op = "toggle"
	case in.Type == 3 && parts[1] == "s":
		a.Op = "send"
	case in.Type == 3 && parts[1] == "x":
		p, _ := t.m.s.store.chatPromptById(parts[2])
		label := "Your answer"
		if p != nil {
			label = clipRunes(p.Content.Title, 45)
		}
		t.respond(ctx, in, 9, map[string]any{"custom_id": "ov:text:" + parts[2], "title": "Answer", "components": []any{
			map[string]any{"type": 1, "components": []any{map[string]any{
				"type": 4, "custom_id": "text", "style": 2, "label": label, "required": true, "max_length": 1900,
			}}},
		}})
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
	reply := t.m.act(chatDiscord, a)
	if reply.Prompt != nil {
		// The response itself redraws the message (type 7).
		t.respond(ctx, in, 7, discordMessage(reply.Prompt, false))
		if reply.Alert && reply.Toast != "" {
			cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			// A follow-up only the user sees.
			t.call(cctx, http.MethodPost, "/webhooks/"+t.m.config(chatDiscord).BotId+"/"+in.Token,
				map[string]any{"content": reply.Toast, "flags": 64}, nil)
		}
		return
	}
	if reply.Toast != "" {
		t.toast(ctx, in, reply.Toast)
	}
}

// --- rendering ---

func dcEsc(s string) string {
	return strings.NewReplacer(`\`, `\\`, "*", `\*`, "_", `\_`, "~", `\~`, "`", "'", "|", `\|`, ">", `\>`, "@", "@​").Replace(s)
}

func dcCode(s string) string {
	return "```\n" + strings.ReplaceAll(strings.ReplaceAll(s, "```", "'''"), "@", "@​") + "\n```"
}

func discordText(p *chatPrompt) string {
	c := p.Content
	emoji, who, what := chatHeadline(c)
	var b strings.Builder
	fmt.Fprintf(&b, "%s **%s** · %s", emoji, dcEsc(who), dcEsc(what))
	switch c.Event {
	case evApproval, evFailed:
		if c.Detail != "" {
			b.WriteString("\n" + dcCode(clipRunes(c.Detail, 1200)))
		}
	case evQuestion:
		b.WriteString("\n\n" + dcEsc(clipRunes(c.Title, 1200)))
		for _, o := range c.Options {
			if o.Desc != "" {
				fmt.Fprintf(&b, "\n• **%s** — %s", dcEsc(clipRunes(o.Label, 80)), dcEsc(clipRunes(o.Desc, 160)))
			}
		}
	default:
		if c.Detail != "" {
			b.WriteString("\n" + dcEsc(c.Detail))
		}
	}
	if c.Session != "" && c.Event != evTest {
		fmt.Fprintf(&b, "\n*%s*", dcEsc(clipRunes(c.Session, 120)))
	}
	if p.State == promptDone && p.Outcome != "" {
		b.WriteString("\n\n**" + dcEsc(p.Outcome) + "**")
	}
	return clipRunes(b.String(), 1990)
}

func dcButton(label, customId string, style int) map[string]any {
	return map[string]any{"type": 2, "style": style, "label": clipRunes(label, 75), "custom_id": customId}
}

func discordComponents(p *chatPrompt, offerLink bool) []any {
	c := p.Content
	var buttons []any
	if p.State != promptDone {
		switch {
		case c.Event == evApproval:
			for i, o := range c.Options {
				style := 2
				switch o.Kind {
				case "allow_once":
					style = 3
				case "allow_always":
					style = 1
				case "reject_once", "reject_always":
					style = 4
				}
				buttons = append(buttons, dcButton(o.buttonLabel(), fmt.Sprintf("ov:a:%s:%d", p.Id, i), style))
			}
		case c.Event == evQuestion && c.Multiple:
			for i, o := range c.Options {
				style := 2
				label := o.Label
				if containsInt(c.Picked, i) {
					style, label = 1, "✓ "+label
				}
				buttons = append(buttons, dcButton(label, fmt.Sprintf("ov:t:%s:%d", p.Id, i), style))
			}
			buttons = append(buttons, dcButton("Send answer", "ov:s:"+p.Id, 3))
		case c.Event == evQuestion:
			for i, o := range c.Options {
				buttons = append(buttons, dcButton(o.Label, fmt.Sprintf("ov:a:%s:%d", p.Id, i), 2))
			}
		}
		if c.Event == evQuestion && c.AllowText {
			buttons = append(buttons, dcButton("Reply…", "ov:x:"+p.Id, 2))
		}
	}
	if offerLink {
		buttons = append(buttons, dcButton("Link me", "ov:link", 3))
	}
	if c.Link != "" {
		buttons = append(buttons, map[string]any{"type": 2, "style": 5, "label": "Open", "url": c.Link})
	}
	rows := []any{}
	for len(buttons) > 0 && len(rows) < 5 {
		n := min(len(buttons), 5)
		rows = append(rows, map[string]any{"type": 1, "components": buttons[:n]})
		buttons = buttons[n:]
	}
	return rows
}

func discordMessage(p *chatPrompt, offerLink bool) map[string]any {
	return map[string]any{
		"content": discordText(p), "components": discordComponents(p, offerLink),
		"allowed_mentions": map[string]any{"parse": []string{}},
	}
}

func (t *discordTransport) post(ctx context.Context, p *chatPrompt, offerLink bool) (string, error) {
	var msg struct {
		Id string `json:"id"`
	}
	err := t.call(ctx, http.MethodPost, "/channels/"+t.m.config(chatDiscord).Channel+"/messages", discordMessage(p, offerLink), &msg)
	return msg.Id, err
}

func (t *discordTransport) sendPrompt(ctx context.Context, p *chatPrompt) (string, error) {
	return t.post(ctx, p, false)
}

func (t *discordTransport) editPrompt(ctx context.Context, p *chatPrompt) error {
	return t.call(ctx, http.MethodPatch, "/channels/"+t.m.config(chatDiscord).Channel+"/messages/"+p.Ref, discordMessage(p, false), nil)
}

func (t *discordTransport) sendNote(ctx context.Context, n chatNote) error {
	cfg := t.m.config(chatDiscord)
	p := &chatPrompt{State: promptDone, Content: n.Content}
	if n.Content.Event == evTest && len(cfg.AllowedUsers) == 0 {
		p.Content.Detail += "\nPress “Link me” so only your account can answer agents from this channel."
		_, err := t.post(ctx, p, true)
		return err
	}
	_, err := t.post(ctx, p, false)
	return err
}
