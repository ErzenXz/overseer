package hub

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Small helpers shared by the chat transports.

// chatHTTP is the client for every outgoing chat call. No redirects: the
// services answer directly, and a redirect would carry the token elsewhere.
var chatHTTP = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// scrubErr removes secrets from an error before it is logged or shown: Go's
// HTTP errors quote the full URL, which for Telegram contains the bot token.
func scrubErr(err error, secrets ...string) error {
	if err == nil {
		return nil
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		err = fmt.Errorf("%s: %w", ue.Op, ue.Err)
	}
	msg := err.Error()
	for _, s := range secrets {
		if len(s) >= 6 {
			msg = strings.ReplaceAll(msg, s, "***")
		}
	}
	return errors.New(msg)
}

// doJSON sends body as JSON (nil = no body) and decodes the reply into out.
// It returns the HTTP status; err is set for transport failures only.
func doJSON(ctx context.Context, method, endpoint string, headers map[string]string, body, out any, secrets ...string) (int, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, rd)
	if err != nil {
		return 0, scrubErr(err, secrets...)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("User-Agent", "Overseer")
	res, err := chatHTTP.Do(req)
	if err != nil {
		return 0, scrubErr(err, secrets...)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil && res.StatusCode < 300 {
			return res.StatusCode, fmt.Errorf("unexpected reply (%d)", res.StatusCode)
		}
	}
	return res.StatusCode, nil
}

// sleepCtx waits d (or until ctx ends) and reports whether to carry on.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// backoff doubles up to a minute, with up to a quarter of jitter.
type chatBackoff struct{ d time.Duration }

func (b *chatBackoff) reset() { b.d = 0 }

func (b *chatBackoff) next() time.Duration {
	if b.d == 0 {
		b.d = time.Second
	} else if b.d < time.Minute {
		b.d *= 2
	}
	var r [1]byte
	rand.Read(r[:])
	return b.d + time.Duration(int64(b.d)/4*int64(r[0])/255)
}

// A short random code for linking a chat (no look-alike characters).
func linkCode() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
