package agent

import "testing"

func TestParseAuthStatus(t *testing.T) {
	cases := []struct {
		id, out string
		ok      bool
		state   string
		account string
	}{
		{"claude", `{"loggedIn": true, "authMethod": "claude.ai", "email": "me@example.com"}`, true, "ok", "me@example.com"},
		{"claude", `{"loggedIn": false}`, true, "signed-out", ""},
		{"claude", `not json`, true, "ok", ""},
		{"claude", ``, false, "signed-out", ""},
		{"codex", "Logged in using ChatGPT", true, "ok", "ChatGPT"},
		{"codex", "Logged in using an API key - sk-***", true, "ok", "API key"},
		{"codex", "Not logged in", false, "signed-out", ""},
		{"codex", "error: unrecognized subcommand 'status'", false, "", ""},
	}
	for _, c := range cases {
		state, account := parseAuthStatus(c.id, c.out, c.ok)
		if state != c.state || account != c.account {
			t.Errorf("%s %q: got (%q, %q), want (%q, %q)", c.id, c.out, state, account, c.state, c.account)
		}
	}
}
