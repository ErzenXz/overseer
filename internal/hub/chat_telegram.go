package hub

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Telegram: the hub long-polls getUpdates, so there is no webhook and no
// public URL. Only the linked chat, and the user who linked it, can answer.

type telegramTransport struct {
	m *chatManager
}

func newTelegram(m *chatManager) *telegramTransport { return &telegramTransport{m: m} }

type tgReply struct {
	Ok          bool   `json:"ok"`
	Description string `json:"description"`
	ErrorCode   int    `json:"error_code"`
	Parameters  struct {
		RetryAfter int `json:"retry_after"`
	} `json:"parameters"`
}

type tgAPIError struct {
	code int
	desc string
}

func (e *tgAPIError) Error() string { return fmt.Sprintf("telegram: %s (%d)", e.desc, e.code) }

// call invokes one Bot API method with the saved token.
func (t *telegramTransport) call(ctx context.Context, method string, params, result any) error {
	return telegramCall(ctx, t.m.api.telegram, t.m.config(chatTelegram).BotToken, method, params, result)
}

func telegramCall(ctx context.Context, base, token, method string, params, result any) error {
	var env struct {
		tgReply
		Result any `json:"result"`
	}
	env.Result = result
	if params == nil {
		params = map[string]any{}
	}
	status, err := doJSON(ctx, http.MethodPost, base+"/bot"+token+"/"+method, nil, params, &env, token)
	if err != nil {
		return err
	}
	if !env.Ok {
		desc := env.Description
		if desc == "" {
			desc = http.StatusText(status)
		}
		return &tgAPIError{code: env.ErrorCode, desc: desc}
	}
	return nil
}

type tgUser struct {
	Id        int64  `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}

type tgChat struct {
	Id        int64  `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}

type tgMessage struct {
	MessageId int64      `json:"message_id"`
	From      *tgUser    `json:"from"`
	Chat      tgChat     `json:"chat"`
	Text      string     `json:"text"`
	ReplyTo   *tgMessage `json:"reply_to_message"`
}

type tgUpdate struct {
	UpdateId int64      `json:"update_id"`
	Message  *tgMessage `json:"message"`
	Callback *struct {
		Id      string     `json:"id"`
		From    tgUser     `json:"from"`
		Message *tgMessage `json:"message"`
		Data    string     `json:"data"`
	} `json:"callback_query"`
}

// validateTelegramToken asks Telegram who the bot is.
func (m *chatManager) validateTelegramToken(ctx context.Context, token string) (tgUser, error) {
	var me tgUser
	err := telegramCall(ctx, m.api.telegram, token, "getMe", nil, &me)
	return me, err
}

func (t *telegramTransport) run(ctx context.Context) {
	var bo chatBackoff
	for ctx.Err() == nil {
		err := t.session(ctx, &bo)
		if ctx.Err() != nil {
			return
		}
		t.m.setStatus(chatTelegram, "error", telegramFriendly(err))
		if !sleepCtx(ctx, bo.next()) {
			return
		}
	}
}

func telegramFriendly(err error) string {
	var api *tgAPIError
	if errors.As(err, &api) {
		switch api.code {
		case 401, 404:
			return "Telegram rejected the bot token."
		case 409:
			return "Another program is polling this bot. Stop it, or use a different bot."
		}
		return api.desc
	}
	return "Cannot reach Telegram: " + err.Error()
}

func (t *telegramTransport) session(ctx context.Context, bo *chatBackoff) error {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	me, err := t.m.validateTelegramToken(cctx, t.m.config(chatTelegram).BotToken)
	if err == nil {
		// getUpdates fails while a webhook is set.
		err = t.call(cctx, "deleteWebhook", map[string]any{"drop_pending_updates": false}, nil)
	}
	cancel()
	if err != nil {
		return err
	}
	if cfg := t.m.config(chatTelegram); cfg.BotName != me.Username || cfg.BotId != strconv.FormatInt(me.Id, 10) {
		t.m.updateConfig(chatTelegram, func(c *chatConfig) { c.BotName, c.BotId = me.Username, strconv.FormatInt(me.Id, 10) })
	}
	t.m.setStatus(chatTelegram, "connected", "")

	var offset int64
	for {
		var updates []tgUpdate
		pctx, pcancel := context.WithTimeout(ctx, 45*time.Second)
		err := t.call(pctx, "getUpdates", map[string]any{
			"offset": offset, "timeout": 25, "allowed_updates": []string{"message", "callback_query"},
		}, &updates)
		pcancel()
		if err != nil {
			return err
		}
		bo.reset()
		if st := t.m.statusOf(chatTelegram); st.State != "connected" {
			t.m.setStatus(chatTelegram, "connected", "")
		}
		for _, u := range updates {
			if u.UpdateId >= offset {
				offset = u.UpdateId + 1
			}
			t.handle(ctx, u)
		}
	}
}

func (t *telegramTransport) handle(ctx context.Context, u tgUpdate) {
	switch {
	case u.Callback != nil:
		t.handleCallback(ctx, u)
	case u.Message != nil && u.Message.From != nil:
		t.handleMessage(ctx, u.Message)
	}
}

func idStr(n int64) string { return strconv.FormatInt(n, 10) }

func (t *telegramTransport) handleMessage(ctx context.Context, msg *tgMessage) {
	cfg := t.m.config(chatTelegram)
	chatId, from := idStr(msg.Chat.Id), idStr(msg.From.Id)
	if cmd, arg, ok := parseTelegramCommand(msg.Text); ok && cmd == "start" {
		t.handleStart(ctx, msg, arg)
		return
	}
	if chatId != cfg.Channel || !cfg.allows(from) || msg.ReplyTo == nil {
		return // not the linked chat, or not a reply to one of our messages
	}
	name := msg.From.FirstName
	reply := t.m.act(chatTelegram, chatAction{Ref: idStr(msg.ReplyTo.MessageId), Op: "text", Text: msg.Text,
		Actor: chatActor{UserId: from, Name: name}})
	if reply.Alert && reply.Toast != "" {
		t.say(ctx, chatId, reply.Toast, msg.MessageId)
	}
	if reply.Prompt != nil {
		t.editPrompt(ctx, reply.Prompt)
	}
}

// parseTelegramCommand splits "/start@MyBot code" into ("start", "code").
func parseTelegramCommand(text string) (cmd, arg string, ok bool) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "/") {
		return "", "", false
	}
	word, rest, _ := strings.Cut(text[1:], " ")
	word, _, _ = strings.Cut(word, "@")
	return strings.ToLower(word), strings.TrimSpace(rest), true
}

func (t *telegramTransport) handleStart(ctx context.Context, msg *tgMessage, code string) {
	chatId := idStr(msg.Chat.Id)
	cfg := t.m.config(chatTelegram)
	if !cfg.codeMatches(code) {
		if cfg.LinkCode != "" && code != "" {
			t.m.updateConfig(chatTelegram, func(c *chatConfig) { c.LinkFails++ })
		}
		if chatId == cfg.Channel && cfg.allows(idStr(msg.From.Id)) {
			t.say(ctx, chatId, "Already connected. Overseer will message you here when an agent needs you.", 0)
			return
		}
		t.say(ctx, chatId, "Send /start followed by the code Overseer shows in Settings → Chat apps → Telegram.", 0)
		return
	}
	title := msg.Chat.Title
	if title == "" {
		title = strings.TrimSpace(msg.Chat.FirstName)
	}
	if title == "" && msg.Chat.Username != "" {
		title = "@" + msg.Chat.Username
	}
	changed := cfg.Channel != chatId
	t.m.updateConfig(chatTelegram, func(c *chatConfig) {
		c.Channel, c.ChatTitle, c.AllowedUsers = chatId, title, []string{idStr(msg.From.Id)}
		c.LinkCode, c.LinkExpires, c.LinkFails = "", 0, 0
		if len(c.Events) == 0 {
			c.Events = []string{evApproval, evQuestion}
		}
	})
	if changed {
		t.m.invalidate(chatTelegram, "Disconnected")
	}
	t.say(ctx, chatId, "✅ Connected to Overseer. I will message you here when an agent needs you.", 0)
}

func (t *telegramTransport) say(ctx context.Context, chatId, text string, replyTo int64) {
	params := map[string]any{"chat_id": chatId, "text": text}
	if replyTo != 0 {
		params["reply_parameters"] = map[string]any{"message_id": replyTo, "allow_sending_without_reply": true}
	}
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	t.call(cctx, "sendMessage", params, nil)
}

func (t *telegramTransport) handleCallback(ctx context.Context, u tgUpdate) {
	cq := u.Callback
	cfg := t.m.config(chatTelegram)
	answer := func(text string, alert bool) {
		cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		t.call(cctx, "answerCallbackQuery", map[string]any{"callback_query_id": cq.Id, "text": clipRunes(text, 190), "show_alert": alert}, nil)
	}
	from := idStr(cq.From.Id)
	if cq.Message == nil || idStr(cq.Message.Chat.Id) != cfg.Channel || !cfg.allows(from) {
		answer("You are not allowed to answer from here.", true)
		return
	}
	parts := strings.Split(cq.Data, ":")
	if len(parts) < 2 {
		answer("", false)
		return
	}
	a := chatAction{PromptId: parts[1], Actor: chatActor{UserId: from, Name: cq.From.FirstName}}
	switch parts[0] {
	case "a":
		a.Op = "pick"
	case "t":
		a.Op = "toggle"
	case "s":
		a.Op = "send"
	default:
		answer("", false)
		return
	}
	if len(parts) > 2 {
		n, err := strconv.Atoi(parts[2])
		if err != nil {
			answer("", false)
			return
		}
		a.Index = n
	}
	reply := t.m.act(chatTelegram, a)
	answer(reply.Toast, reply.Alert)
	if reply.Prompt != nil {
		t.editPrompt(ctx, reply.Prompt)
	}
}

// --- sending ---

func tgEsc(s string) string { return html.EscapeString(s) }

func telegramText(p *chatPrompt) string {
	c := p.Content
	emoji, who, what := chatHeadline(c)
	var b strings.Builder
	fmt.Fprintf(&b, "%s <b>%s</b> · %s", emoji, tgEsc(who), tgEsc(what))
	switch c.Event {
	case evApproval:
		if c.Detail != "" {
			fmt.Fprintf(&b, "\n<pre>%s</pre>", tgEsc(clipRunes(c.Detail, 1500)))
		}
	case evQuestion:
		fmt.Fprintf(&b, "\n\n%s", tgEsc(clipRunes(c.Title, 1500)))
		described := false
		for _, o := range c.Options {
			if o.Desc != "" {
				described = true
			}
		}
		if described {
			b.WriteString("\n")
			for _, o := range c.Options {
				fmt.Fprintf(&b, "\n• <b>%s</b>", tgEsc(clipRunes(o.Label, 80)))
				if o.Desc != "" {
					fmt.Fprintf(&b, " — %s", tgEsc(clipRunes(o.Desc, 160)))
				}
			}
		}
	case evFinished:
		if c.Detail != "" {
			fmt.Fprintf(&b, "\n%s", tgEsc(c.Detail))
		}
	case evFailed:
		if c.Detail != "" {
			fmt.Fprintf(&b, "\n<pre>%s</pre>", tgEsc(c.Detail))
		}
	default:
		if c.Detail != "" {
			fmt.Fprintf(&b, "\n%s", tgEsc(c.Detail))
		}
	}
	if c.Session != "" && c.Event != evTest {
		fmt.Fprintf(&b, "\n<i>%s</i>", tgEsc(clipRunes(c.Session, 120)))
	}
	if p.State == promptDone {
		if p.Outcome != "" {
			fmt.Fprintf(&b, "\n\n<b>%s</b>", tgEsc(p.Outcome))
		}
	} else if c.Event == evQuestion && c.AllowText {
		b.WriteString("\n\n<i>Reply to this message to answer in your own words.</i>")
	}
	return b.String()
}

type tgButton struct {
	Text string `json:"text"`
	Data string `json:"callback_data,omitempty"`
	URL  string `json:"url,omitempty"`
}

func telegramKeyboard(p *chatPrompt) [][]tgButton {
	c := p.Content
	var rows [][]tgButton
	if p.State != promptDone {
		switch {
		case c.Event == evApproval:
			per := 3
			if len(c.Options) == 4 {
				per = 2
			}
			var row []tgButton
			for i, o := range c.Options {
				row = append(row, tgButton{Text: o.buttonLabel(), Data: fmt.Sprintf("a:%s:%d", p.Id, i)})
				if len(row) == per || i == len(c.Options)-1 {
					rows = append(rows, row)
					row = nil
				}
			}
		case c.Event == evQuestion && c.Multiple:
			for i, o := range c.Options {
				label := clipRunes(o.Label, 60)
				if containsInt(c.Picked, i) {
					label = "✓ " + label
				}
				rows = append(rows, []tgButton{{Text: label, Data: fmt.Sprintf("t:%s:%d", p.Id, i)}})
			}
			rows = append(rows, []tgButton{{Text: "Send answer", Data: "s:" + p.Id}})
		case c.Event == evQuestion:
			for i, o := range c.Options {
				rows = append(rows, []tgButton{{Text: clipRunes(o.Label, 60), Data: fmt.Sprintf("a:%s:%d", p.Id, i)}})
			}
		}
	}
	if c.Link != "" {
		rows = append(rows, []tgButton{{Text: "Open", URL: c.Link}})
	}
	return rows
}

func containsInt(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func (t *telegramTransport) sendPrompt(ctx context.Context, p *chatPrompt) (string, error) {
	var msg tgMessage
	params := map[string]any{
		"chat_id": t.m.config(chatTelegram).Channel, "text": telegramText(p), "parse_mode": "HTML",
		"link_preview_options": map[string]any{"is_disabled": true},
	}
	if kb := telegramKeyboard(p); len(kb) > 0 {
		params["reply_markup"] = map[string]any{"inline_keyboard": kb}
	}
	if err := t.call(ctx, "sendMessage", params, &msg); err != nil {
		return "", err
	}
	return idStr(msg.MessageId), nil
}

func (t *telegramTransport) editPrompt(ctx context.Context, p *chatPrompt) error {
	id, err := strconv.ParseInt(p.Ref, 10, 64)
	if err != nil {
		return nil
	}
	kb := telegramKeyboard(p)
	if kb == nil {
		kb = [][]tgButton{}
	}
	err = t.call(ctx, "editMessageText", map[string]any{
		"chat_id": t.m.config(chatTelegram).Channel, "message_id": id, "text": telegramText(p), "parse_mode": "HTML",
		"link_preview_options": map[string]any{"is_disabled": true},
		"reply_markup":         map[string]any{"inline_keyboard": kb},
	}, nil)
	if e, ok := err.(*tgAPIError); ok && strings.Contains(e.desc, "not modified") {
		return nil
	}
	return err
}

func (t *telegramTransport) sendNote(ctx context.Context, n chatNote) error {
	_, err := t.sendPrompt(ctx, &chatPrompt{State: promptDone, Content: n.Content})
	return err
}
