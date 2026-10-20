package agent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- request handlers (writes) ---

func extToggle(req protocol.ExtToggleRequest) (protocol.ExtChangeResult, error) {
	if req.Enabled == nil {
		return protocol.ExtChangeResult{}, fmt.Errorf("enabled is required")
	}
	it, err := lookupItem(req.Key)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	if r := readOnlyReason(it); r != "" {
		return protocol.ExtChangeResult{}, errors.New(r)
	}
	on := *req.Enabled
	var res protocol.ExtChangeResult
	switch {
	case it.Agent == "claude" && it.Kind == protocol.ExtPlugin && isWritableScope(it.Scope):
		res, err = claudeTogglePlugin(it, on)
	case it.Agent == "claude" && it.Kind == protocol.ExtSkill && (it.Scope == protocol.ScopeUser || it.Scope == protocol.ScopeProject):
		res, err = claudeToggleSkill(it, on)
	case it.Agent == "codex" && (it.Kind == protocol.ExtSkill || it.Kind == protocol.ExtPlugin || it.Kind == protocol.ExtMcpServer):
		res, err = codexToggle(it, on)
	case it.Agent == "devin" && it.Kind == protocol.ExtMcpServer && isWritableScope(it.Scope):
		res, err = devinToggleMcp(it, on)
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("this item can't be turned on or off from Overseer")
	}
	forgetSnapshots()
	return res, err
}

func isWritableScope(s string) bool {
	return s == protocol.ScopeUser || s == protocol.ScopeProject || s == protocol.ScopeLocal
}

func extUninstall(req protocol.ExtKeyRequest) (protocol.ExtChangeResult, error) {
	it, err := lookupItem(req.Key)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	if r := readOnlyReason(it); r != "" {
		return protocol.ExtChangeResult{}, errors.New(r)
	}
	var res protocol.ExtChangeResult
	switch {
	case it.Agent == "claude" && it.Kind == protocol.ExtPlugin && isWritableScope(it.Scope):
		res, err = claudeUninstallPlugin(it)
	case it.Agent == "codex" && it.Kind == protocol.ExtPlugin:
		res, err = codexUninstall(it)
	case it.Kind == protocol.ExtSkill && (it.Scope == protocol.ScopeUser || it.Scope == protocol.ScopeProject):
		res, err = trashSkill(it)
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("this item can't be removed from Overseer")
	}
	forgetSnapshots()
	return res, err
}

var pluginIdRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$`)

func extInstall(req protocol.ExtInstallRequest) (protocol.ExtChangeResult, error) {
	if !pluginIdRe.MatchString(req.Id) {
		return protocol.ExtChangeResult{}, fmt.Errorf("id must look like plugin@marketplace")
	}
	if req.AcceptCommand != "" && !isSha256(req.AcceptCommand) {
		return protocol.ExtChangeResult{}, fmt.Errorf("acceptCommand must be the sha256 the install showed")
	}
	cwd, err := checkCwd(req.Cwd)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	req.Cwd = cwd
	switch req.Scope {
	case protocol.ScopeUser:
		req.Cwd = ""
	case protocol.ScopeProject, protocol.ScopeLocal:
		if req.Cwd == "" {
			return protocol.ExtChangeResult{}, fmt.Errorf("%s scope needs a cwd", req.Scope)
		}
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("scope must be user, project or local")
	}
	var res protocol.ExtChangeResult
	switch req.Agent {
	case "claude":
		if !strings.Contains(req.Id, "@") {
			return protocol.ExtChangeResult{}, fmt.Errorf("id must look like plugin@marketplace")
		}
		res, err = claudeInstall(req)
	case "codex":
		if req.Scope != protocol.ScopeUser {
			return protocol.ExtChangeResult{}, fmt.Errorf("Codex plugins install for the user only")
		}
		if req.AcceptCommand != "" {
			return protocol.ExtChangeResult{}, fmt.Errorf("acceptCommand is only for Claude Code plugins")
		}
		res, err = codexInstall(req)
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("installing is supported for claude and codex plugins")
	}
	if err == nil && res.NeedsApproval == nil {
		forgetSnapshots()
	}
	return res, err
}

func extCatalog(req protocol.ExtCatalogRequest) (protocol.ExtCatalogResult, error) {
	switch req.Agent {
	case "claude":
		return claudeCatalog(req.Q)
	case "codex":
		return codexCatalog(req.Q)
	}
	return protocol.ExtCatalogResult{}, fmt.Errorf("catalogs are available for claude and codex")
}

// --- skills: create, share, trash ---

var skillNameRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

const (
	maxSkillBody  = 256 * 1024
	maxCopyFiles  = 2000
	maxCopyBytes  = 64 << 20
	maxShareAgent = 16
)

func validSkillName(name string) error {
	if len(name) == 0 || len(name) > 64 || !skillNameRe.MatchString(name) {
		return fmt.Errorf("name must be 1-64 lowercase letters, digits and single hyphens (not at the ends)")
	}
	return nil
}

func validSkillDescription(d string) error {
	n := utf8.RuneCountInString(d)
	if n == 0 || n > 1024 || !utf8.ValidString(d) {
		return fmt.Errorf("description must be 1-1024 characters")
	}
	for _, r := range d {
		if r < 0x20 && r != '\n' && r != '\t' {
			return fmt.Errorf("description has control characters")
		}
	}
	return nil
}

// skillAgents validates the agents a skill is made available to.
func skillAgents(agents []string) ([]string, error) {
	if len(agents) == 0 {
		return nil, fmt.Errorf("choose at least one agent")
	}
	if len(agents) > maxShareAgent {
		return nil, fmt.Errorf("too many agents")
	}
	var out []string
	for _, a := range agents {
		if _, ok := skillRoots[a]; !ok {
			return nil, fmt.Errorf("unknown agent %q", a)
		}
		if !containsStr(out, a) {
			out = append(out, a)
		}
	}
	return out, nil
}

// skillTargetRoot is where an agent finds a skill of a scope: the shared
// .agents/skills root when it reads that, else its own skill folder.
func skillTargetRoot(env extEnv, agent, scope string) string {
	if readsAgentsSkills(agent) {
		return agentsSkillRoot(env, scope)
	}
	lr, ok := linkRoots[agent]
	if !ok {
		return ""
	}
	if scope == protocol.ScopeProject {
		return env.dir(lr[1])
	}
	return env.dir(lr[0])
}

// skillFile renders SKILL.md with spec-valid frontmatter.
func skillFile(name, description, body string) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.Encode(description) // a JSON string is a valid YAML double-quoted scalar
	desc := strings.TrimSpace(b.String())
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if body == "" {
		body = "# " + name + "\n\n" + strings.TrimSpace(description)
	}
	return []byte("---\nname: " + name + "\ndescription: " + desc + "\n---\n\n" + body + "\n")
}

func createSkill(req protocol.SkillCreateRequest) (protocol.ExtChangeResult, error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	if err := validSkillName(req.Name); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	if err := validSkillDescription(req.Description); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	if len(req.Body) > maxSkillBody {
		return protocol.ExtChangeResult{}, fmt.Errorf("body is too large")
	}
	agents, err := skillAgents(req.Agents)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	cwd := ""
	switch req.Scope {
	case protocol.ScopeUser:
	case protocol.ScopeProject:
		if cwd, err = checkCwd(req.Cwd); err != nil {
			return protocol.ExtChangeResult{}, err
		}
		if cwd == "" {
			return protocol.ExtChangeResult{}, fmt.Errorf("project scope needs a cwd")
		}
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("scope must be user or project")
	}
	env := newExtEnv(cwd)
	root := agentsSkillRoot(env, req.Scope)
	if root == "" {
		return protocol.ExtChangeResult{}, fmt.Errorf("no skill folder for this scope")
	}
	dir := filepath.Join(root, req.Name)
	if _, err := os.Lstat(dir); err == nil {
		return protocol.ExtChangeResult{}, fmt.Errorf("a skill named %s already exists in %s", req.Name, root)
	}
	// Links for agents that don't read .agents/skills; refuse before
	// writing anything when one of them already has that name.
	var links []string
	for _, a := range agents {
		t := skillTargetRoot(env, a, req.Scope)
		if t == "" || t == root || containsStr(links, filepath.Join(t, req.Name)) {
			continue
		}
		dst := filepath.Join(t, req.Name)
		if _, err := os.Lstat(dst); err == nil {
			return protocol.ExtChangeResult{}, fmt.Errorf("%s already has a skill named %s (%s)", a, req.Name, dst)
		}
		links = append(links, dst)
	}
	if err := ensureSkillRoot(env, root, req.Scope); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	if err := os.Mkdir(dir, 0o755); err != nil {
		if os.IsExist(err) {
			return protocol.ExtChangeResult{}, fmt.Errorf("a skill named %s already exists in %s", req.Name, root)
		}
		return protocol.ExtChangeResult{}, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "SKILL.md"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	_, werr := f.Write(skillFile(req.Name, req.Description, req.Body))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return protocol.ExtChangeResult{}, werr
	}
	note := ""
	for _, dst := range links {
		if err := ensureSkillRoot(env, filepath.Dir(dst), req.Scope); err != nil {
			return protocol.ExtChangeResult{}, err
		}
		copied, err := linkSkill(dir, dst)
		if err != nil {
			return protocol.ExtChangeResult{}, fmt.Errorf("created %s but could not link it into %s: %v", dir, filepath.Dir(dst), err)
		}
		if copied {
			note = "Symlinks are not available here, so agents that need their own folder got a copy"
		}
	}
	forgetSnapshots()
	primary := agents[0]
	if containsStr(agents, "claude") {
		primary = "claude"
	}
	path := filepath.Join(skillTargetRoot(env, primary, req.Scope), req.Name, "SKILL.md")
	it := skillItem(env, primary, req.Scope, req.Name, req.Description, path)
	return protocol.ExtChangeResult{Item: &it, Note: note}, nil
}

// ensureSkillRoot creates a skill folder; a project's folder must stay
// inside the project once symlinks are resolved.
func ensureSkillRoot(env extEnv, root, scope string) error {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if scope == protocol.ScopeProject {
		real, base := realPath(root), realPath(env.cwd)
		if real == "" || base == "" || !isWithin(base, real) {
			return fmt.Errorf("%s resolves outside the project", root)
		}
	}
	return nil
}

// skillItem describes a skill an agent reads at path (after a change).
func skillItem(env extEnv, agent, scope, name, description, path string) protocol.ExtItem {
	it := protocol.ExtItem{Agent: agent, Kind: protocol.ExtSkill, Name: name, Description: description, Scope: scope,
		Path: path, Enabled: boolPtr(true), State: "on", Invocation: &protocol.ExtInvocation{User: true, Model: true}}
	if scope == protocol.ScopeProject {
		it.ProjectPath = env.cwd
	}
	finishItem(&it)
	real := itemRealPath(it)
	extState.mu.Lock()
	detect := extState.detect
	extState.mu.Unlock()
	for id := range extInstalled(detect) {
		if id == agent || real == "" {
			continue
		}
		for _, f := range scanAgentFiles(env, id) {
			if f.kind == protocol.ExtSkill && f.real == real {
				it.SharedWith = append(it.SharedWith, id)
				break
			}
		}
	}
	sortAgents(it.SharedWith)
	return it
}

// linkSkill points dst at the skill folder src (a relative symlink), or
// copies it where symlinks are not available.
func linkSkill(src, dst string) (bool, error) {
	target := src
	if rel, err := filepath.Rel(filepath.Dir(dst), src); err == nil {
		target = rel
	}
	if err := os.Symlink(target, dst); err == nil {
		return false, nil
	}
	return true, copySkillDir(src, dst)
}

// copySkillDir copies regular files only (symlinks inside a skill are not
// followed, so a copy can't pull in files from outside it).
func copySkillDir(src, dst string) error {
	files, size := 0, int64(0)
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return os.MkdirAll(out, 0o755)
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		files++
		size += info.Size()
		if files > maxCopyFiles || size > maxCopyBytes {
			return fmt.Errorf("skill folder is too large to copy")
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		o, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
		if err != nil {
			return err
		}
		if _, err := io.Copy(o, in); err != nil {
			o.Close()
			return err
		}
		return o.Close()
	})
}

// realSkillRoots are the real paths of every known skill folder.
func realSkillRoots(env extEnv) []string {
	var out []string
	for _, r := range allSkillRoots(env) {
		if p := realPath(r); p != "" && !containsStr(out, p) {
			out = append(out, p)
		}
	}
	return out
}

// skillSource validates an inventory skill as something that can be shared
// or trashed: a user or project skill whose folder (resolved) stays inside
// the known skill folders.
func skillSource(it protocol.ExtItem) (extEnv, string, string, error) {
	if it.Kind != protocol.ExtSkill || it.Path == "" || (it.Scope != protocol.ScopeUser && it.Scope != protocol.ScopeProject) {
		return extEnv{}, "", "", fmt.Errorf("only your own user or project skills can be shared or removed")
	}
	if r := readOnlyReason(it); r != "" {
		return extEnv{}, "", "", errors.New(r)
	}
	env := newExtEnv(it.ProjectPath)
	dir := filepath.Dir(it.Path)
	real := realPath(dir)
	if real == "" {
		return extEnv{}, "", "", fmt.Errorf("the skill folder is gone; refresh the list")
	}
	inside := false
	for _, root := range realSkillRoots(env) {
		if isWithin(root, real) && root != real {
			inside = true
			break
		}
	}
	if !inside {
		return extEnv{}, "", "", fmt.Errorf("the skill folder resolves outside the skill folders; not touching it")
	}
	return env, dir, real, nil
}

func shareSkill(req protocol.SkillShareRequest) (protocol.ExtChangeResult, error) {
	agents, err := skillAgents(req.Agents)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	it, err := lookupItem(req.Key)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	env, dir, real, err := skillSource(it)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	name := filepath.Base(dir)
	var links []string
	var conflicts []string
	for _, a := range agents {
		if a == it.Agent {
			continue
		}
		reads := false
		for _, f := range scanAgentFiles(env, a) {
			if f.kind == protocol.ExtSkill && f.real == real {
				reads = true // already shared (same real path)
				break
			}
		}
		if reads {
			continue
		}
		root := skillTargetRoot(env, a, it.Scope)
		if root == "" {
			continue
		}
		dst := filepath.Join(root, name)
		if containsStr(links, dst) {
			continue
		}
		if _, err := os.Lstat(dst); err == nil {
			if realPath(dst) == real {
				continue
			}
			conflicts = append(conflicts, fmt.Sprintf("%s already has a different skill named %s (%s)", a, name, dst))
			continue
		}
		links = append(links, dst)
	}
	if len(conflicts) > 0 {
		return protocol.ExtChangeResult{}, errors.New(strings.Join(conflicts, "; "))
	}
	note := ""
	for _, dst := range links {
		if err := ensureSkillRoot(env, filepath.Dir(dst), it.Scope); err != nil {
			return protocol.ExtChangeResult{}, err
		}
		copied, err := linkSkill(dir, dst)
		if err != nil {
			return protocol.ExtChangeResult{}, err
		}
		if copied {
			note = "Symlinks are not available here, so the skill was copied; edits to one copy don't reach the other"
		}
	}
	forgetSnapshots()
	out := skillItem(env, it.Agent, it.Scope, it.Name, it.Description, it.Path)
	out.DisplayName, out.Enabled, out.State, out.Invocation = it.DisplayName, it.Enabled, it.State, it.Invocation
	if note == "" && len(links) > 0 {
		note = "New sessions of those agents will see it"
	}
	return protocol.ExtChangeResult{Item: &out, Note: note}, nil
}

// trashSkill moves a user-authored skill folder (or the link to it) into a
// .trash folder next to it, with any links other agents had to it. Nothing
// is deleted.
func trashSkill(it protocol.ExtItem) (protocol.ExtChangeResult, error) {
	env, dir, real, err := skillSource(it)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	direct := false
	for _, root := range allSkillRoots(env) {
		if filepath.Dir(dir) == filepath.Clean(root) {
			direct = true
			break
		}
	}
	if !direct {
		return protocol.ExtChangeResult{}, fmt.Errorf("the skill is not directly in a skill folder; not touching it")
	}
	fi, err := os.Lstat(dir)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	// Links elsewhere that point at this (canonical) folder go too, so no
	// agent is left with a dangling link.
	var moves []string
	if fi.Mode()&os.ModeSymlink == 0 {
		for _, root := range allSkillRoots(env) {
			entries, err := os.ReadDir(root)
			if err != nil {
				continue
			}
			for _, de := range entries {
				p := filepath.Join(root, de.Name())
				if p == dir || de.Type()&os.ModeSymlink == 0 {
					continue
				}
				if realPath(p) == real {
					moves = append(moves, p)
				}
			}
		}
	}
	moves = append(moves, dir)
	var dest string
	for _, p := range moves {
		d, err := moveToTrash(p)
		if err != nil {
			return protocol.ExtChangeResult{}, err
		}
		dest = d
	}
	return protocol.ExtChangeResult{Ok: true, Note: "Moved to " + dest}, nil
}

func moveToTrash(p string) (string, error) {
	trash := filepath.Join(filepath.Dir(p), ".trash")
	if err := os.MkdirAll(trash, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(trash, filepath.Base(p))
	if _, err := os.Lstat(dest); err == nil {
		dest += "-" + time.Now().UTC().Format("20060102-150405")
	}
	if _, err := os.Lstat(dest); err == nil {
		return "", fmt.Errorf("%s already exists", dest)
	}
	return dest, os.Rename(p, dest)
}

// --- settings JSON (order-preserving edit) ---

type ojField struct {
	key string
	val any
}

// ojObject is a JSON object that keeps its key order.
type ojObject []ojField

func ojDecode(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := ojObject{}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				k, _ := kt.(string)
				v, err := ojDecode(dec)
				if err != nil {
					return nil, err
				}
				obj = append(obj, ojField{k, v})
			}
			_, err := dec.Token()
			return obj, err
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := ojDecode(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err := dec.Token()
			return arr, err
		}
		return nil, fmt.Errorf("unexpected %v", t)
	default:
		return t, nil
	}
}

func ojEncode(b *bytes.Buffer, v any, indent string, depth int) {
	nl := func(d int) {
		b.WriteByte('\n')
		b.WriteString(strings.Repeat(indent, d))
	}
	switch t := v.(type) {
	case ojObject:
		if len(t) == 0 {
			b.WriteString("{}")
			return
		}
		b.WriteByte('{')
		for i, f := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			nl(depth + 1)
			ojString(b, f.key)
			b.WriteString(": ")
			ojEncode(b, f.val, indent, depth+1)
		}
		nl(depth)
		b.WriteByte('}')
	case []any:
		if len(t) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteByte('[')
		for i, x := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			nl(depth + 1)
			ojEncode(b, x, indent, depth+1)
		}
		nl(depth)
		b.WriteByte(']')
	case string:
		ojString(b, t)
	case json.Number:
		b.WriteString(t.String())
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case nil:
		b.WriteString("null")
	default:
		j, _ := json.Marshal(t)
		b.Write(j)
	}
}

func ojString(b *bytes.Buffer, s string) {
	var tmp bytes.Buffer
	enc := json.NewEncoder(&tmp)
	enc.SetEscapeHTML(false)
	enc.Encode(s)
	b.Write(bytes.TrimRight(tmp.Bytes(), "\n"))
}

// detectIndent returns the indentation a JSON file uses (two spaces when it
// can't tell).
func detectIndent(data []byte) string {
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimLeft(line, " \t")
		if t != "" && len(t) < len(line) {
			return line[:len(line)-len(t)]
		}
	}
	return "  "
}

// setJSONSetting sets keys (an object path) in a JSON settings file to
// value, or removes the last key when value is nil (and its parent object
// when that leaves it empty). Other keys keep their order and values; a
// file that isn't valid JSON is left alone.
func setJSONSetting(path string, keys []string, value any) error {
	if len(keys) == 0 {
		return fmt.Errorf("no key")
	}
	data, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var root ojObject
	mode := os.FileMode(0o644)
	if exists {
		if fi, err := os.Stat(path); err == nil {
			mode = fi.Mode().Perm()
		}
		if len(bytes.TrimSpace(data)) > 0 {
			dec := json.NewDecoder(bytes.NewReader(data))
			dec.UseNumber()
			v, err := ojDecode(dec)
			if err != nil {
				return fmt.Errorf("%s is not valid JSON; not changing it", path)
			}
			if _, err := dec.Token(); err != io.EOF {
				return fmt.Errorf("%s is not valid JSON; not changing it", path)
			}
			obj, ok := v.(ojObject)
			if !ok {
				return fmt.Errorf("%s is not a JSON object; not changing it", path)
			}
			root = obj
		}
	}
	if root == nil {
		if value == nil {
			return nil // nothing to remove
		}
		root = ojObject{}
	}
	root, err = ojSet(root, keys, value)
	if err != nil {
		return fmt.Errorf("%s: %v", path, err)
	}
	indent := "  "
	if exists {
		indent = detectIndent(data)
	}
	var b bytes.Buffer
	ojEncode(&b, root, indent, 0)
	b.WriteByte('\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeFileAtomicMode(path, b.Bytes(), mode)
}

func ojSet(obj ojObject, keys []string, value any) (ojObject, error) {
	idx := -1
	for i, f := range obj {
		if f.key == keys[0] {
			idx = i
		}
	}
	if len(keys) == 1 {
		switch {
		case value == nil && idx >= 0:
			return append(obj[:idx:idx], obj[idx+1:]...), nil
		case value == nil:
			return obj, nil
		case idx >= 0:
			obj[idx].val = value
			return obj, nil
		}
		return append(obj, ojField{keys[0], value}), nil
	}
	var child ojObject
	if idx >= 0 {
		c, ok := obj[idx].val.(ojObject)
		if !ok {
			if obj[idx].val != nil {
				return nil, fmt.Errorf("%s is not an object", keys[0])
			}
		}
		child = c
	}
	if child == nil {
		if value == nil {
			return obj, nil
		}
		child = ojObject{}
	}
	child, err := ojSet(child, keys[1:], value)
	if err != nil {
		return nil, err
	}
	switch {
	case len(child) == 0 && value == nil && idx >= 0:
		return append(obj[:idx:idx], obj[idx+1:]...), nil
	case idx >= 0:
		obj[idx].val = child
		return obj, nil
	}
	return append(obj, ojField{keys[0], child}), nil
}

// writeFileAtomicMode replaces path through a temporary file in the same
// folder.
func writeFileAtomicMode(path string, data []byte, mode os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".overseer-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	os.Chmod(name, mode)
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
