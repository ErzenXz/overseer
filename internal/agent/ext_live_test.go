package agent

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// OVERSEER_LIVE_EXT=1 reads the real agents on this machine (read-only, no
// prompt) and logs counts per agent and kind. OVERSEER_LIVE_EXT_CWD adds a
// project.
func TestExtensionsLive(t *testing.T) {
	if os.Getenv("OVERSEER_LIVE_EXT") != "1" {
		t.Skip("set OVERSEER_LIVE_EXT=1 to read the installed agents")
	}
	start := time.Now()
	res, err := listExtensions(protocol.ExtListRequest{Cwd: os.Getenv("OVERSEER_LIVE_EXT_CWD")})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("inventory in %v", time.Since(start).Round(time.Millisecond))
	limitProbes.Wait()
	for _, a := range res.Agents {
		t.Logf("agent %s ok=%v version=%s error=%q", a.Agent, a.Ok, a.Version, a.Error)
	}
	counts := map[string]int{}
	shared := 0
	for _, it := range res.Items {
		counts[it.Agent+" "+it.Kind]++
		if len(it.SharedWith) > 0 {
			shared++
		}
		if os.Getenv("OVERSEER_LIVE_EXT_V") == "1" {
			t.Logf("  %s %s %s %q enabled=%v state=%s locked=%s shared=%v path=%v", it.Agent, it.Kind, it.Scope, it.QualifiedName, deref(it.Enabled), it.State, it.LockedBy, it.SharedWith, it.Path != "")
		}
	}
	var keys []string
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		t.Logf("%s: %d", k, counts[k])
	}
	t.Logf("items %d, with sharedWith %d", len(res.Items), shared)
	for _, it := range res.Items {
		if it.Kind == protocol.ExtSkill && it.Path != "" {
			start := time.Now()
			d, err := extItemDetail(protocol.ExtKeyRequest{Key: it.Key})
			t.Logf("item %s: %d bytes, %d frontmatter keys, err=%v in %v", it.QualifiedName, len(d.Content), len(d.Frontmatter), err, time.Since(start).Round(time.Millisecond))
			break
		}
	}
	for _, agent := range []string{"claude", "codex"} {
		start := time.Now()
		cat, err := extCatalog(protocol.ExtCatalogRequest{Agent: agent})
		installed := 0
		for _, e := range cat.Entries {
			if e.Installed {
				installed++
			}
		}
		t.Logf("catalog %s: %d entries (%d installed), err=%v in %v", agent, len(cat.Entries), installed, err, time.Since(start).Round(time.Millisecond))
		assertNoExtSecrets(t, "catalog", cat)
	}
	assertNoExtSecrets(t, "live extensions", res)
}

func deref(b *bool) any {
	if b == nil {
		return nil
	}
	return *b
}

// extSecretMarkers must never appear in anything an inventory sends.
var extSecretMarkers = []string{"SECRET", "oauthAccount", `"env":`, `"headers":`, "Bearer ", "sk-ant", "emailAddress"}

func assertNoExtSecrets(t *testing.T, what string, v any) {
	t.Helper()
	m, err := protocol.NewMsg(protocol.TypeResult, 1, 0, v)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(m)
	for _, s := range extSecretMarkers {
		if strings.Contains(string(b), s) {
			i := strings.Index(string(b), s)
			t.Errorf("%s: hub-bound message contains %q: …%s…", what, s, string(b[max(0, i-200):min(len(b), i+100)]))
		}
	}
}
