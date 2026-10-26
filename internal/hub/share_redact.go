package hub

import (
	"regexp"
	"strings"
)

// Best-effort secret redaction for shared sessions. It catches the common,
// recognisable shapes (provider keys, JWTs, private keys, password=… pairs).
// It cannot know every secret, which is why the share dialog tells people to
// look before they send a link.

const shareRedacted = "[redacted]"

var secretPatterns = []*regexp.Regexp{
	// PEM private keys, up to the footer (or the end of the text if it was cut).
	regexp.MustCompile(`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)`),
	// GitHub tokens.
	regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{30,}\b`),
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}\b`),
	// Anthropic, OpenAI and other sk- keys.
	regexp.MustCompile(`\bsk-ant-[A-Za-z0-9_\-]{20,}`),
	regexp.MustCompile(`\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}`),
	// AWS access key ids.
	regexp.MustCompile(`\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b`),
	// Slack, Stripe, Google, npm, GitLab, SendGrid.
	regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9\-]{10,}`),
	regexp.MustCompile(`\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b`),
	regexp.MustCompile(`\bAIza[0-9A-Za-z_\-]{35}\b`),
	regexp.MustCompile(`\bnpm_[A-Za-z0-9]{30,}\b`),
	regexp.MustCompile(`\bglpat-[A-Za-z0-9_\-]{20,}`),
	regexp.MustCompile(`\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}`),
	// JSON web tokens.
	regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`),
}

// "Bearer abc…" and "Authorization: Basic abc…".
var bearerPattern = regexp.MustCompile(`(?i)\b(bearer|basic)(\s+)[A-Za-z0-9._~+/=\-]{16,}`)

// user:password@host in a URL.
var urlCredPattern = regexp.MustCompile(`(?i)([a-z][a-z0-9+.\-]*://[^\s/:@]+:)[^\s/@]+(@)`)

// password=…, "api_key": "…", TOKEN: …, export SECRET_KEY=…
var assignPattern = regexp.MustCompile(`(?i)(["']?[A-Za-z0-9_.\-]*(?:passw(?:or)?d|passwd|pwd|secret|token|api[_\-]?key|apikey|access[_\-]?key|private[_\-]?key|credential|auth)[A-Za-z0-9_.\-]*["']?\s*[=:]\s*)(["']?)([^\s"'&;,)}\]]{3,})`)

// placeholders and type names that look like a value but aren't one.
func looksLikePlaceholder(v string) bool {
	switch strings.ToLower(v) {
	case "string", "str", "null", "nil", "none", "true", "false", "undefined", "required", "optional", "bool", "int", "any", "env", "empty", "redacted", "[redacted]":
		return true
	}
	if v == shareRedacted {
		return true
	}
	if strings.Trim(v, "*x•.-_") == "" {
		return true
	}
	switch v[0] {
	case '$', '<', '{', '(', '[', '%', '*', '@', '#':
		return true
	}
	for _, p := range []string{"os.", "process.", "ctx.", "req.", "args.", "opts.", "config.", "cfg.", "self.", "this.", "env.", "settings.", "params.", "getenv", "environ"} {
		if strings.HasPrefix(strings.ToLower(v), p) {
			return true
		}
	}
	// Function calls and field accesses in code: token = foo(), token: r.Token.
	if strings.ContainsAny(v, "()") {
		return true
	}
	return false
}

// redactSecrets hides recognisable secrets in text.
func redactSecrets(s string) string {
	if s == "" {
		return s
	}
	for _, re := range secretPatterns {
		s = re.ReplaceAllString(s, shareRedacted)
	}
	s = bearerPattern.ReplaceAllString(s, "${1}${2}"+shareRedacted)
	s = urlCredPattern.ReplaceAllString(s, "${1}"+shareRedacted+"${2}")
	s = assignPattern.ReplaceAllStringFunc(s, func(m string) string {
		parts := assignPattern.FindStringSubmatch(m)
		if len(parts) != 4 || looksLikePlaceholder(parts[3]) {
			return m
		}
		return parts[1] + parts[2] + shareRedacted
	})
	return s
}

var (
	homeUnix = regexp.MustCompile(`/(?:Users|home)/[^/\s"'` + "`" + `:]+`)
	homeWin  = regexp.MustCompile(`(?i)[A-Z]:\\Users\\[^\\\s"'` + "`" + `:]+`)
)

// nameScrubber removes the machine and folder names from text.
type nameScrubber struct {
	pairs []string // old, new, old, new… for strings.NewReplacer
	r     *strings.Replacer
}

func newNameScrubber(cwd string, names ...string) *nameScrubber {
	n := &nameScrubber{}
	if cwd = strings.TrimRight(cwd, `/\`); len(cwd) > 1 {
		n.pairs = append(n.pairs, cwd+"/", "", cwd+`\`, "", cwd, ".")
	}
	seen := map[string]bool{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if len(name) < 3 || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		n.pairs = append(n.pairs, name, "the machine")
		// "studio.local" is also written "studio".
		if base, _, ok := strings.Cut(name, "."); ok && len(base) >= 3 && !seen[strings.ToLower(base)] {
			seen[strings.ToLower(base)] = true
			n.pairs = append(n.pairs, base, "the machine")
		}
	}
	if len(n.pairs) > 0 {
		n.r = strings.NewReplacer(n.pairs...)
	}
	return n
}

func (n *nameScrubber) scrub(s string) string {
	if n == nil || s == "" {
		return s
	}
	if n.r != nil {
		s = n.r.Replace(s)
	}
	s = homeUnix.ReplaceAllString(s, "~")
	return homeWin.ReplaceAllString(s, "~")
}
