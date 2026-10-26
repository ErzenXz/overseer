package hub

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// The page behind /s/{token}: the normal UI bundle with a title and link
// preview tags filled in on the server, so Slack, X and Discord can unfurl it.

var shareTitleTag = regexp.MustCompile(`(?is)<title>.*?</title>`)

// sharePastTense turns the opening verb of a session title ("Fix flaky tests")
// into a sentence the agent did ("fixed flaky tests").
var sharePastTense = map[string]string{
	"add": "added", "build": "built", "change": "changed", "clean": "cleaned up", "create": "created",
	"debug": "debugged", "delete": "deleted", "document": "documented", "fix": "fixed", "implement": "implemented",
	"improve": "improved", "investigate": "investigated", "make": "made", "migrate": "migrated", "move": "moved",
	"optimize": "optimized", "port": "ported", "refactor": "refactored", "remove": "removed", "rename": "renamed",
	"replace": "replaced", "review": "reviewed", "rewrite": "rewrote", "set": "set", "speed": "sped", "split": "split",
	"test": "tested", "update": "updated", "upgrade": "upgraded", "write": "wrote", "audit": "audited",
	"redesign": "redesigned", "simplify": "simplified", "convert": "converted", "extract": "extracted",
	"enable": "enabled", "disable": "disabled", "handle": "handled", "support": "supported", "bump": "bumped",
}

func shareDuration(ms int64) string {
	total := (ms + 500) / 1000
	if total < 1 {
		total = 1
	}
	m, s := total/60, total%60
	switch {
	case m == 0:
		return fmt.Sprintf("%ds", s)
	case m < 60:
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%dh %dm", m/60, m%60)
}

func shareTrim(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// sharePreview builds the title and description for a shared session.
func sharePreview(p *publicShare) (title, desc string) {
	agent := p.Thread.AgentName
	if agent == "" {
		agent = "A coding agent"
	}
	name := strings.Join(strings.Fields(p.Thread.Title), " ")
	if p.Mode == shareLive {
		if name == "" {
			return agent + " is working, live · Overseer", "Follow this coding agent session live, view-only. Made with Overseer."
		}
		return "Live: " + shareTrim(name, 80) + " · " + agent + " · Overseer", "Follow this coding agent session live, view-only. Made with Overseer."
	}
	took := ""
	if p.Summary.DurationMs >= 1000 {
		took = " in " + shareDuration(p.Summary.DurationMs)
	}
	first, rest, _ := strings.Cut(name, " ")
	if past, ok := sharePastTense[strings.ToLower(first)]; ok && rest != "" {
		title = agent + " " + past + " " + shareTrim(rest, 90) + took + " · Overseer"
	} else if name != "" {
		title = shareTrim(name, 90) + " · " + agent + took + " · Overseer"
	} else {
		title = agent + " session" + took + " · Overseer"
	}
	parts := []string{"Watch the replay"}
	if n := p.Summary.Steps; n > 0 {
		parts = append(parts, fmt.Sprintf("%d step%s", n, sharePlural(n)))
	}
	if n := p.Summary.Files; n > 0 {
		parts = append(parts, fmt.Sprintf("%d file%s changed (+%d −%d)", n, sharePlural(n), p.Summary.Additions, p.Summary.Deletions))
	}
	return title, strings.Join(parts, " · ") + ". Run your coding agents on every machine with Overseer."
}

func sharePlural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func shareOneLine(s string) string { return html.EscapeString(strings.Join(strings.Fields(s), " ")) }

// renderSharePage fills a UI index.html with a title and preview tags.
func renderSharePage(index, title, desc, pageURL string) string {
	tags := []string{
		`<meta name="robots" content="noindex, nofollow" />`,
		`<meta name="referrer" content="no-referrer" />`,
		fmt.Sprintf(`<meta name="description" content="%s" />`, shareOneLine(desc)),
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="Overseer" />`,
		fmt.Sprintf(`<meta property="og:title" content="%s" />`, shareOneLine(title)),
		fmt.Sprintf(`<meta property="og:description" content="%s" />`, shareOneLine(desc)),
		`<meta property="og:image" content="https://overseer.sh/og.jpg" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
		fmt.Sprintf(`<meta name="twitter:title" content="%s" />`, shareOneLine(title)),
		fmt.Sprintf(`<meta name="twitter:description" content="%s" />`, shareOneLine(desc)),
		`<meta name="twitter:image" content="https://overseer.sh/og.jpg" />`,
	}
	if pageURL != "" {
		tags = append(tags, fmt.Sprintf(`<meta property="og:url" content="%s" />`, html.EscapeString(pageURL)))
	}
	out := shareTitleTag.ReplaceAllLiteralString(index, "<title>"+shareOneLine(title)+"</title>")
	block := "    " + strings.Join(tags, "\n    ") + "\n  "
	if i := strings.Index(strings.ToLower(out), "</head>"); i >= 0 {
		return out[:i] + block + out[i:]
	}
	return out + block
}

func (s *Server) handleSharePage(w http.ResponseWriter, r *http.Request) {
	rt := s.shareRT()
	if !s.publicGuard(w, r, rt.pages, false) {
		return
	}
	if s.opts.UI == nil {
		http.Error(w, "This hub was built without its web UI.", http.StatusNotFound)
		return
	}
	f, err := s.opts.UI.Open("index.html")
	if err != nil {
		http.Error(w, "UI not built into this binary", http.StatusNotFound)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(f, 1<<20))
	f.Close()
	if err != nil {
		http.Error(w, "UI not available", http.StatusInternalServerError)
		return
	}
	index := string(raw)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	sh, t := s.lookupShare(r.PathValue("token"))
	if sh == nil {
		if !rt.misses.allow(shareClientIP(r)) {
			http.Error(w, "Too many requests. Try again in a minute.", http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, renderSharePage(index, "This link has expired · Overseer", "This shared Overseer session is no longer available.", ""))
		return
	}
	var pub *publicShare
	if sh.Mode == shareReplay {
		pub = &publicShare{}
		if json.Unmarshal([]byte(sh.snapshot), pub) != nil {
			pub = nil
		}
	} else {
		pub, _ = s.buildPublic(t, sh, false)
	}
	if pub == nil {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, renderSharePage(index, "This link has expired · Overseer", "This shared Overseer session is no longer available.", ""))
		return
	}
	title, desc := sharePreview(pub)
	io.WriteString(w, renderSharePage(index, title, desc, s.shareBase(r)+"/s/"+r.PathValue("token")))
}
