package updater

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"
)

// rawBase serves repository files; a variable so tests can point at httptest.
var rawBase = "https://raw.githubusercontent.com"

// Entry is one release's notes, parsed from the CHANGELOG.md format
// (## vX.Y.Z — date, an intro paragraph, ### groups of "- " bullets).
// Bullets keep their inline markdown; the UI renders bold, code and links.
type Entry struct {
	Version string  `json:"version"`
	Date    string  `json:"date,omitempty"`
	Intro   string  `json:"intro,omitempty"`
	Groups  []Group `json:"groups"`
}

type Group struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}

var changelogHeading = regexp.MustCompile(`^## (\S+)(?:\s+[—-]\s+(.+))?$`)

// ParseChangelog parses CHANGELOG.md text into entries, newest first as
// written in the file.
func ParseChangelog(md string) []Entry {
	var entries []Entry
	var cur *Entry
	var group *Group
	flush := func() {
		if cur != nil {
			entries = append(entries, *cur)
		}
	}
	for _, raw := range strings.Split(md, "\n") {
		line := strings.TrimRight(raw, " \t\r")
		if m := changelogHeading.FindStringSubmatch(line); m != nil {
			flush()
			cur = &Entry{Version: m[1], Date: m[2], Groups: []Group{}}
			group = nil
			continue
		}
		if cur == nil {
			continue
		}
		if title, ok := strings.CutPrefix(line, "### "); ok {
			cur.Groups = append(cur.Groups, Group{Title: strings.TrimSpace(title), Items: []string{}})
			group = &cur.Groups[len(cur.Groups)-1]
			continue
		}
		switch {
		case strings.HasPrefix(line, "- ") && group != nil:
			group.Items = append(group.Items, strings.TrimSpace(line[2:]))
		case group != nil && len(group.Items) > 0 && (strings.HasPrefix(line, "  ") || strings.HasPrefix(line, "\t")) && strings.TrimSpace(line) != "":
			group.Items[len(group.Items)-1] += " " + strings.TrimSpace(line)
		case group == nil && strings.TrimSpace(line) != "":
			if cur.Intro != "" {
				cur.Intro += " "
			}
			cur.Intro += strings.TrimSpace(line)
		}
	}
	flush()
	return entries
}

// StableEntries keeps only entries for stable vX.Y.Z versions (dropping
// "Unreleased" and previews), sorted newest first.
func StableEntries(entries []Entry) []Entry {
	var out []Entry
	for _, e := range entries {
		if isStableVersion(e.Version) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return IsNewer(out[i].Version, out[j].Version) })
	return out
}

// Changelog returns the parsed notes of the repository at tag. It reads
// CHANGELOG.md from that tag and falls back to the GitHub release body (which
// carries just that release's section) when the file can't be fetched.
func Changelog(ctx context.Context, repo, tag string) ([]Entry, error) {
	if !isStableVersion(tag) {
		return nil, fmt.Errorf("%q is not a stable release version", tag)
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	entries, fileErr := fetchChangelogFile(ctx, repo, tag)
	if fileErr == nil {
		return entries, nil
	}
	entry, err := fetchReleaseBody(ctx, repo, tag)
	if err != nil {
		return nil, fileErr
	}
	return []Entry{entry}, nil
}

func fetchChangelogFile(ctx context.Context, repo, tag string) ([]Entry, error) {
	body, err := httpGet(ctx, fmt.Sprintf("%s/%s/%s/CHANGELOG.md", rawBase, repo, tag), 1<<20)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, err
	}
	entries := StableEntries(ParseChangelog(string(data)))
	if len(entries) == 0 {
		return nil, fmt.Errorf("CHANGELOG.md at %s has no release sections", tag)
	}
	return entries, nil
}

func fetchReleaseBody(ctx context.Context, repo, tag string) (Entry, error) {
	var release struct {
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
	}
	if err := getJSON(ctx, fmt.Sprintf("%s/repos/%s/releases/tags/%s", githubAPIBase, repo, tag), &release); err != nil {
		return Entry{}, err
	}
	// The body has no version heading; the first parsed section is the release.
	// Anything after it (GitHub's generated "What's Changed") is dropped.
	parsed := ParseChangelog("## " + tag + "\n" + release.Body)
	if len(parsed) == 0 || (parsed[0].Intro == "" && len(parsed[0].Groups) == 0) {
		return Entry{}, fmt.Errorf("release %s has no notes", tag)
	}
	entry := parsed[0]
	if len(release.PublishedAt) >= 10 {
		entry.Date = release.PublishedAt[:10]
	}
	return entry, nil
}
