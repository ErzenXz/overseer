package hub

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Settings API for chat apps. Tokens are write-only: they are saved here,
// returned masked, and never logged.

func (s *Server) routesChat(m *http.ServeMux) {
	m.HandleFunc("GET /api/chat/apps", s.requireOwner(s.handleChatList))
	m.HandleFunc("PUT /api/chat/apps/{kind}", s.requireOwner(s.handleChatPut))
	m.HandleFunc("DELETE /api/chat/apps/{kind}", s.requireOwner(s.handleChatDelete))
	m.HandleFunc("POST /api/chat/apps/{kind}/connect", s.requireOwner(s.handleChatConnect))
	m.HandleFunc("POST /api/chat/apps/{kind}/test", s.requireOwner(s.handleChatTest))
}

type chatAppView struct {
	Kind          string     `json:"kind"`
	Name          string     `json:"name"`
	Configured    bool       `json:"configured"`
	Enabled       bool       `json:"enabled"`
	Linked        bool       `json:"linked"`
	Status        chatStatus `json:"status"`
	BotToken      string     `json:"botToken"`
	AppToken      string     `json:"appToken"`
	WebhookURL    string     `json:"webhookUrl"`
	WebhookSecret string     `json:"webhookSecret"`
	BotName       string     `json:"botName,omitempty"`
	Channel       string     `json:"channel,omitempty"`
	ChatTitle     string     `json:"chatTitle,omitempty"`
	AllowedUsers  []string   `json:"allowedUsers"`
	Events        []string   `json:"events"`
	Machines      []string   `json:"machines"`
	HideAlways    bool       `json:"hideAlways"`
	LinkCode      string     `json:"linkCode,omitempty"`
	LinkUrl       string     `json:"linkUrl,omitempty"`
	LinkExpires   int64      `json:"linkExpires,omitempty"`
	InviteUrl     string     `json:"inviteUrl,omitempty"`
	CanAnswer     bool       `json:"canAnswer"` // buttons work (false for the webhook)
}

// maskSecret shows enough to recognise a token, never enough to use it.
func maskSecret(s string) string {
	switch {
	case s == "":
		return ""
	case len(s) <= 12:
		return "••••••••"
	}
	return s[:4] + "••••••••" + s[len(s)-4:]
}

func maskURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "••••••••"
	}
	return u.Scheme + "://" + u.Host + "/••••••••"
}

func (m *chatManager) view(kind string) chatAppView {
	c := m.config(kind)
	v := chatAppView{
		Kind: kind, Name: chatKindNames[kind], Configured: c.ready(kind), Enabled: c.Enabled,
		BotToken: maskSecret(c.BotToken), AppToken: maskSecret(c.AppToken),
		BotName: c.BotName, Channel: c.Channel, ChatTitle: c.ChatTitle,
		AllowedUsers: nonNil(c.AllowedUsers), Events: nonNil(c.Events), Machines: nonNil(c.Machines),
		HideAlways: c.HideAlways, CanAnswer: kind != chatWebhook,
	}
	if c.WebhookURL != "" {
		v.WebhookURL = maskURL(c.WebhookURL)
	}
	if c.WebhookSecret != "" {
		v.WebhookSecret = "••••••••"
	}
	switch kind {
	case chatTelegram:
		v.Linked = c.Channel != ""
		if c.LinkCode != "" && time.Now().Unix() <= c.LinkExpires {
			v.LinkCode, v.LinkExpires = c.LinkCode, c.LinkExpires
			if c.BotName != "" {
				v.LinkUrl = "https://t.me/" + c.BotName + "?start=" + c.LinkCode
			}
		}
	case chatSlack:
		v.Linked = len(c.AllowedUsers) > 0
	case chatDiscord:
		v.Linked = len(c.AllowedUsers) > 0
		if c.BotId != "" {
			v.InviteUrl = "https://discord.com/oauth2/authorize?client_id=" + c.BotId + "&scope=bot&permissions=3072"
		}
	case chatWebhook:
		v.Linked = c.WebhookURL != ""
	}
	v.Status = m.statusOf(kind)
	if !c.Enabled || !c.ready(kind) {
		v.Status = chatStatus{State: "off"}
	}
	return v
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func (s *Server) handleChatList(w http.ResponseWriter, r *http.Request) {
	out := make([]chatAppView, 0, len(chatKinds))
	for _, kind := range chatKinds {
		out = append(out, s.chat.view(kind))
	}
	writeJSON(w, out)
}

func chatKindFromPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	kind := r.PathValue("kind")
	if !slices.Contains(chatKinds, kind) {
		httpError(w, http.StatusNotFound, "unknown chat app")
		return "", false
	}
	return kind, true
}

var (
	telegramTokenRe = regexp.MustCompile(`^[0-9]{5,15}:[A-Za-z0-9_-]{25,}$`)
	slackBotRe      = regexp.MustCompile(`^xoxb-[A-Za-z0-9-]{10,}$`)
	slackAppRe      = regexp.MustCompile(`^xapp-[A-Za-z0-9-]{10,}$`)
	slackChannelRe  = regexp.MustCompile(`^[CGDUW][A-Z0-9]{6,}$`)
	slackUserRe     = regexp.MustCompile(`^[UW][A-Z0-9]{6,}$`)
	snowflakeRe     = regexp.MustCompile(`^[0-9]{15,22}$`)
	tgUserIdRe      = regexp.MustCompile(`^-?[0-9]{3,16}$`)
)

type chatPut struct {
	Enabled            *bool     `json:"enabled"`
	BotToken           *string   `json:"botToken"`
	AppToken           *string   `json:"appToken"`
	Channel            *string   `json:"channel"`
	WebhookURL         *string   `json:"webhookUrl"`
	WebhookSecret      *string   `json:"webhookSecret"`
	ClearWebhookSecret bool      `json:"clearWebhookSecret"`
	AllowedUsers       *[]string `json:"allowedUsers"`
	Events             *[]string `json:"events"`
	Machines           *[]string `json:"machines"`
	HideAlways         *bool     `json:"hideAlways"`
}

func cleanList(in []string, max int, ok func(string) bool) ([]string, bool) {
	out := []string{}
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || slices.Contains(out, v) {
			continue
		}
		if !ok(v) {
			return nil, false
		}
		out = append(out, v)
	}
	return out, len(out) <= max
}

func (s *Server) handleChatPut(w http.ResponseWriter, r *http.Request) {
	kind, ok := chatKindFromPath(w, r)
	if !ok {
		return
	}
	var req chatPut
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	cur := s.chat.config(kind)
	var edits []func(c *chatConfig)
	restart := false
	edit := func(fn func(c *chatConfig)) { edits = append(edits, fn) }
	bad := func(msg string) { httpError(w, http.StatusBadRequest, msg) }
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	// Tokens: empty means "keep what is saved".
	if req.BotToken != nil && strings.TrimSpace(*req.BotToken) != "" {
		tok := strings.TrimSpace(*req.BotToken)
		switch kind {
		case chatTelegram:
			if !telegramTokenRe.MatchString(tok) {
				bad("That does not look like a Telegram bot token. It looks like 123456789:AAH… (from @BotFather).")
				return
			}
			me, err := s.chat.validateTelegramToken(ctx, tok)
			if err != nil {
				bad(telegramFriendly(err))
				return
			}
			edit(func(c *chatConfig) {
				c.BotToken, c.BotName, c.BotId = tok, me.Username, idStr(me.Id)
				c.Channel, c.ChatTitle, c.AllowedUsers, c.LinkCode, c.LinkExpires, c.LinkFails = "", "", nil, "", 0, 0
			})
		case chatSlack:
			if !slackBotRe.MatchString(tok) {
				bad("The bot token starts with xoxb-.")
				return
			}
			me, err := s.chat.validateSlackToken(ctx, tok)
			if err != nil {
				bad(slackFriendly(err))
				return
			}
			edit(func(c *chatConfig) { c.BotToken, c.BotName, c.BotId = tok, me.User, me.UserId })
		case chatDiscord:
			if len(tok) < 40 || len(tok) > 120 || strings.ContainsAny(tok, " \n\t") {
				bad("That does not look like a Discord bot token.")
				return
			}
			me, err := s.chat.validateDiscordToken(ctx, tok)
			if err != nil {
				bad(discordFriendly(err))
				return
			}
			edit(func(c *chatConfig) { c.BotToken, c.BotName, c.BotId = tok, me.Username, me.Id })
		default:
			bad("This integration has no bot token.")
			return
		}
		restart = true
	}
	if req.AppToken != nil && strings.TrimSpace(*req.AppToken) != "" {
		tok := strings.TrimSpace(*req.AppToken)
		if kind != chatSlack || !slackAppRe.MatchString(tok) {
			bad("The app-level token starts with xapp-.")
			return
		}
		edit(func(c *chatConfig) { c.AppToken = tok })
		restart = true
	}
	if req.Channel != nil && kind != chatTelegram && kind != chatWebhook {
		ch := strings.TrimSpace(*req.Channel)
		switch {
		case kind == chatSlack && !slackChannelRe.MatchString(ch):
			bad("A Slack channel id looks like C0123ABCDEF (right-click the channel, then Copy link). A member id (U…) sends to a direct message.")
			return
		case kind == chatDiscord && !snowflakeRe.MatchString(ch):
			bad("A Discord channel id is a long number (turn on Developer Mode, then right-click the channel and Copy Channel ID).")
			return
		}
		if ch != cur.Channel {
			edit(func(c *chatConfig) {
				c.Channel = ch
				if kind == chatSlack && (ch[0] == 'U' || ch[0] == 'W') && len(c.AllowedUsers) == 0 {
					c.AllowedUsers = []string{ch} // your own direct message: only you
				}
			})
			restart = true
			s.chat.invalidate(kind, "Disconnected")
		}
	}
	if req.WebhookURL != nil && kind == chatWebhook && strings.TrimSpace(*req.WebhookURL) != "" {
		raw := strings.TrimSpace(*req.WebhookURL)
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(raw) > 2000 {
			bad("Enter a full http:// or https:// address.")
			return
		}
		edit(func(c *chatConfig) { c.WebhookURL = raw })
		restart = true
	}
	if kind == chatWebhook {
		if req.ClearWebhookSecret {
			edit(func(c *chatConfig) { c.WebhookSecret = "" })
		} else if req.WebhookSecret != nil && strings.TrimSpace(*req.WebhookSecret) != "" {
			sec := strings.TrimSpace(*req.WebhookSecret)
			if len(sec) > 200 {
				bad("The signing secret is too long.")
				return
			}
			edit(func(c *chatConfig) { c.WebhookSecret = sec })
		}
	}
	if req.AllowedUsers != nil && kind != chatWebhook {
		re := snowflakeRe
		switch kind {
		case chatSlack:
			re = slackUserRe
		case chatTelegram:
			re = tgUserIdRe
		}
		users, ok := cleanList(*req.AllowedUsers, 20, re.MatchString)
		if !ok {
			bad("Those are not valid user ids for " + chatKindNames[kind] + ".")
			return
		}
		edit(func(c *chatConfig) { c.AllowedUsers = users })
	}
	if req.Events != nil {
		events, ok := cleanList(*req.Events, len(chatEventNames), func(v string) bool { return slices.Contains(chatEventNames, v) })
		if !ok {
			bad("Unknown event.")
			return
		}
		edit(func(c *chatConfig) { c.Events = events })
	}
	if req.Machines != nil {
		machines, ok := cleanList(*req.Machines, 200, func(v string) bool { return len(v) <= 64 })
		if !ok {
			bad("Too many machines.")
			return
		}
		edit(func(c *chatConfig) { c.Machines = machines })
	}
	if req.HideAlways != nil {
		v := *req.HideAlways
		edit(func(c *chatConfig) { c.HideAlways = v })
	}
	wasReady := cur.ready(kind)
	if req.Enabled != nil {
		v := *req.Enabled
		edit(func(c *chatConfig) { c.Enabled = v })
		restart = true
	}
	updated, err := s.chat.updateConfig(kind, func(c *chatConfig) {
		for _, fn := range edits {
			fn(c)
		}
		if !wasReady && c.ready(kind) && req.Enabled == nil {
			c.Enabled = true // a newly completed setup switches itself on
			restart = true
		}
		if len(c.Events) == 0 && req.Events == nil && c.ready(kind) {
			c.Events = []string{evApproval, evQuestion}
		}
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, "could not save")
		return
	}
	_ = updated
	if restart {
		s.chat.reload(kind)
	} else {
		s.chat.mu.Lock()
		s.chat.recomputeLocked()
		s.chat.mu.Unlock()
	}
	writeJSON(w, s.chat.view(kind))
}

func (s *Server) handleChatDelete(w http.ResponseWriter, r *http.Request) {
	kind, ok := chatKindFromPath(w, r)
	if !ok {
		return
	}
	s.chat.invalidate(kind, "Disconnected")
	if err := s.chat.dropConfig(kind); err != nil {
		httpError(w, http.StatusInternalServerError, "could not remove")
		return
	}
	s.chat.reload(kind)
	s.chat.setStatus(kind, "off", "")
	writeJSON(w, s.chat.view(kind))
}

// handleChatConnect starts linking a Telegram chat: it makes a one-time code
// the user sends to the bot as /start <code>.
func (s *Server) handleChatConnect(w http.ResponseWriter, r *http.Request) {
	kind, ok := chatKindFromPath(w, r)
	if !ok {
		return
	}
	cur := s.chat.config(kind)
	if kind != chatTelegram || cur.BotToken == "" {
		httpError(w, http.StatusConflict, "Save the bot token first.")
		return
	}
	code := linkCode()
	s.chat.updateConfig(kind, func(c *chatConfig) {
		c.LinkCode, c.LinkExpires, c.LinkFails = code, time.Now().Add(chatLinkTTL).Unix(), 0
		c.Enabled = true
	})
	if s.chat.transport(kind) == nil {
		s.chat.reload(kind)
	}
	writeJSON(w, s.chat.view(kind))
}

func (s *Server) handleChatTest(w http.ResponseWriter, r *http.Request) {
	kind, ok := chatKindFromPath(w, r)
	if !ok {
		return
	}
	cfg := s.chat.config(kind)
	switch {
	case !cfg.ready(kind):
		httpError(w, http.StatusConflict, "Finish the setup first.")
		return
	case !cfg.Enabled:
		httpError(w, http.StatusConflict, "Switch it on first.")
		return
	case kind == chatTelegram && cfg.Channel == "":
		httpError(w, http.StatusConflict, "Link a chat first: press Connect and send the code to your bot.")
		return
	}
	tr := s.chat.transport(kind)
	if tr == nil {
		httpError(w, http.StatusConflict, "Still connecting. Try again in a few seconds.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	content := chatContent{
		Event: evTest, Machine: "Overseer", Detail: "This is a test message. If you can read it, agents can reach you here.",
		Link: strings.TrimSuffix(s.chat.link(""), "/sessions/"),
	}
	if err := tr.sendNote(ctx, chatNote{Content: content}); err != nil {
		httpError(w, http.StatusBadGateway, "Could not send: "+friendlySendError(kind, err))
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func friendlySendError(kind string, err error) string {
	switch kind {
	case chatTelegram:
		return telegramFriendly(err)
	case chatSlack:
		return slackFriendly(err)
	case chatDiscord:
		return discordFriendly(err)
	}
	return err.Error()
}
