package hub

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Generic webhook: POSTs a JSON event for everything the settings ask for.
// Nothing comes back, so it cannot answer approvals; it is for ntfy, Home
// Assistant, n8n and similar.

type webhookTransport struct{ m *chatManager }

func newWebhook(m *chatManager) *webhookTransport { return &webhookTransport{m: m} }

func (w *webhookTransport) run(ctx context.Context) {
	w.m.setStatus(chatWebhook, "connected", "Ready")
	<-ctx.Done()
}

func (w *webhookTransport) sendPrompt(ctx context.Context, p *chatPrompt) (string, error) {
	return "", w.post(ctx, p.Content)
}

func (w *webhookTransport) editPrompt(context.Context, *chatPrompt) error { return nil }

func (w *webhookTransport) sendNote(ctx context.Context, n chatNote) error {
	return w.post(ctx, n.Content)
}

type webhookEvent struct {
	Type    string `json:"type"` // approval | question | finished | failed | test
	At      string `json:"at"`
	Text    string `json:"text"` // one readable line
	Session struct {
		Id    string `json:"id"`
		Title string `json:"title"`
	} `json:"session"`
	Machine struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	} `json:"machine"`
	Agent struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	} `json:"agent"`
	Title    string           `json:"title,omitempty"`   // approval: what the agent wants to do
	Command  string           `json:"command,omitempty"` // approval: the command or details
	Question *webhookQuestion `json:"question,omitempty"`
	Summary  string           `json:"summary,omitempty"` // finished
	Error    string           `json:"error,omitempty"`   // failed
	Links    struct {
		Open string `json:"open,omitempty"`
	} `json:"links"`
}

type webhookQuestion struct {
	Text      string                  `json:"text"`
	Options   []webhookQuestionOption `json:"options"`
	Multiple  bool                    `json:"multiple,omitempty"`
	AllowText bool                    `json:"allowText,omitempty"`
}

type webhookQuestionOption struct {
	Id          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

func buildWebhookEvent(c chatContent) webhookEvent {
	var e webhookEvent
	e.Type, e.At = c.Event, time.Now().UTC().Format(time.RFC3339)
	_, who, what := chatHeadline(c)
	e.Text = who + " · " + what
	e.Session.Id, e.Session.Title = c.ThreadId, c.Session
	e.Machine.Id, e.Machine.Name = c.DeviceId, c.Machine
	e.Agent.Id, e.Agent.Name = c.AgentId, c.Agent
	e.Links.Open = c.Link
	switch c.Event {
	case evApproval:
		e.Title, e.Command = c.Title, c.Detail
	case evQuestion:
		q := &webhookQuestion{Text: c.Title, Multiple: c.Multiple, AllowText: c.AllowText, Options: []webhookQuestionOption{}}
		for _, o := range c.Options {
			q.Options = append(q.Options, webhookQuestionOption{Id: o.Id, Label: o.Label, Description: o.Desc})
		}
		e.Question = q
		e.Text = who + " · " + c.Agent + " asks: " + clipRunes(c.Title, 200)
	case evFinished:
		e.Summary = c.Detail
	case evFailed:
		e.Error = c.Detail
	default:
		e.Summary = c.Detail
	}
	return e
}

func (w *webhookTransport) post(ctx context.Context, c chatContent) error {
	cfg := w.m.config(chatWebhook)
	body, err := json.Marshal(buildWebhookEvent(c))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return scrubErr(err, cfg.WebhookURL, cfg.WebhookSecret)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Overseer")
	req.Header.Set("X-Overseer-Event", c.Event)
	if cfg.WebhookSecret != "" {
		mac := hmac.New(sha256.New, []byte(cfg.WebhookSecret))
		mac.Write(body)
		req.Header.Set("X-Overseer-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	res, err := chatHTTP.Do(req)
	if err != nil {
		err = fmt.Errorf("could not reach the webhook: %w", scrubErr(err, cfg.WebhookURL, cfg.WebhookSecret))
		w.m.setStatus(chatWebhook, "error", err.Error())
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		err = fmt.Errorf("the webhook answered %d", res.StatusCode)
		w.m.setStatus(chatWebhook, "error", err.Error())
		return err
	}
	w.m.setStatus(chatWebhook, "connected", "Last event delivered")
	return nil
}
