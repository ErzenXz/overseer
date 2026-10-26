package hub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Automation recipes: a portable description of an automation (what to run,
// when, with which agent) that can travel as a link. A recipe never carries a
// machine id, a folder or a secret, and it is untrusted input: it is checked
// strictly, shown in full before anyone adds it, and never runs by itself.

const (
	recipeVersion      = 1
	recipeMaxEncoded   = 16 * 1024
	recipeMaxPrompt    = 8000
	recipeMaxDesc      = 500
	recipeMaxRequires  = 8
	recipeMaxTags      = 6
	recipeUniversalURL = "https://overseer.sh/r#"
)

// recipe field order is the canonical JSON order used in links.
type recipe struct {
	V           int      `json:"v"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Schedule    string   `json:"schedule"`
	Prompt      string   `json:"prompt"`
	Agent       string   `json:"agent,omitempty"`  // claude, codex or gemini
	Model       string   `json:"model,omitempty"`  // a hint; the importer may not have it
	Effort      string   `json:"effort,omitempty"` // a hint
	Mode        string   `json:"mode,omitempty"`   // plan, ask, edits or auto
	Requires    []string `json:"requires,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type recipeWarning struct {
	Level string `json:"level"` // warn or info
	Text  string `json:"text"`
}

var (
	recipeModelRe   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,63}$`)
	recipeToolRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9._+-]{0,31}$`)
	recipeTagRe     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,23}$`)
	recipeEffortRe  = regexp.MustCompile(`^[a-z]{2,12}$`)
	recipeSecretRe  = regexp.MustCompile(`(?i)(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|tskey-[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)`)
	recipeAgents    = map[string]bool{"claude": true, "codex": true, "gemini": true}
	recipeModes     = map[string]bool{"plan": true, "ask": true, "edits": true, "auto": true}
	recipeLocalPath = regexp.MustCompile(`(^|[\s"'(])(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\)`)
)

func controlFree(s string, allowNewlines bool) bool {
	for _, r := range s {
		if r == 0 || r == 0x7f || (r < ' ' && !(allowNewlines && (r == '\n' || r == '\t' || r == '\r'))) {
			return false
		}
	}
	return utf8.ValidString(s)
}

// normalize trims fields and checks everything but the schedule syntax
// (which the caller checks with parseCron).
func (r *recipe) normalize() error {
	if r.V != recipeVersion {
		return fmt.Errorf("this recipe is version %d; this hub understands version %d", r.V, recipeVersion)
	}
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	r.Schedule = strings.Join(strings.Fields(r.Schedule), " ")
	r.Prompt = strings.TrimSpace(r.Prompt)
	r.Agent, r.Model = strings.TrimSpace(r.Agent), strings.TrimSpace(r.Model)
	r.Effort, r.Mode = strings.TrimSpace(r.Effort), strings.TrimSpace(r.Mode)
	switch {
	case r.Name == "" || utf8.RuneCountInString(r.Name) > 120 || !controlFree(r.Name, false):
		return errors.New("name must be 1-120 characters")
	case utf8.RuneCountInString(r.Description) > recipeMaxDesc || !controlFree(r.Description, true):
		return fmt.Errorf("description is longer than %d characters", recipeMaxDesc)
	case r.Prompt == "":
		return errors.New("the recipe has no prompt")
	case len(r.Prompt) > recipeMaxPrompt || !controlFree(r.Prompt, true):
		return fmt.Errorf("prompt is longer than %d characters or has control characters", recipeMaxPrompt)
	case r.Agent != "" && !recipeAgents[r.Agent]:
		return errors.New("agent must be claude, codex or gemini")
	case r.Model != "" && !recipeModelRe.MatchString(r.Model):
		return errors.New("model hint is invalid")
	case r.Effort != "" && !recipeEffortRe.MatchString(r.Effort):
		return errors.New("effort hint is invalid")
	case r.Mode != "" && !recipeModes[r.Mode]:
		return errors.New("mode must be plan, ask, edits or auto")
	case len(r.Requires) > recipeMaxRequires:
		return fmt.Errorf("a recipe can require at most %d tools", recipeMaxRequires)
	case len(r.Tags) > recipeMaxTags:
		return fmt.Errorf("a recipe can have at most %d tags", recipeMaxTags)
	}
	for _, t := range r.Requires {
		if !recipeToolRe.MatchString(t) {
			return fmt.Errorf("required tool %q is invalid", cloudCleanMessage(t, 40))
		}
	}
	for _, t := range r.Tags {
		if !recipeTagRe.MatchString(t) {
			return fmt.Errorf("tag %q is invalid", cloudCleanMessage(t, 40))
		}
	}
	if recipeSecretRe.MatchString(r.Prompt) || recipeSecretRe.MatchString(r.Description) || recipeSecretRe.MatchString(r.Name) {
		return errors.New("the recipe contains what looks like a secret (a key or token); recipes must not carry secrets")
	}
	return nil
}

// validate is normalize plus the schedule.
func (r *recipe) validate() error {
	if err := r.normalize(); err != nil {
		return err
	}
	if _, err := parseCron(r.Schedule); err != nil {
		return errors.New("schedule: " + err.Error())
	}
	return nil
}

// decodeRecipe reads a recipe from the base64url text of a link. Unknown
// fields are refused, so a recipe cannot smuggle in machine ids, folders or
// anything else the format doesn't define.
func decodeRecipe(encoded string) (*recipe, error) {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return nil, errors.New("the link has no recipe in it")
	}
	if len(encoded) > recipeMaxEncoded {
		return nil, errors.New("the recipe is too large")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(encoded, "="))
	if err != nil {
		return nil, errors.New("the recipe in this link is damaged (not valid base64)")
	}
	return parseRecipeJSON(raw)
}

func parseRecipeJSON(raw []byte) (*recipe, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var r recipe
	if err := dec.Decode(&r); err != nil {
		return nil, errors.New("the recipe is not valid: " + cloudCleanMessage(err.Error(), 160))
	}
	if dec.More() {
		return nil, errors.New("the recipe has extra data after it")
	}
	if err := r.validate(); err != nil {
		return nil, err
	}
	return &r, nil
}

func encodeRecipe(r *recipe) (string, error) {
	cp := *r
	cp.V = recipeVersion
	if err := cp.validate(); err != nil {
		return "", err
	}
	b, err := json.Marshal(cp)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding.EncodeToString(b)
	if len(enc) > recipeMaxEncoded {
		return "", errors.New("the recipe is too large to share as a link")
	}
	return enc, nil
}

// recipeFromAutomation keeps only what is portable: never the machine, the
// folder or access settings.
func recipeFromAutomation(a *Automation) *recipe {
	r := &recipe{V: recipeVersion, Name: a.Name, Schedule: a.Schedule, Prompt: a.Prompt}
	if recipeAgents[a.Agent] {
		r.Agent = a.Agent
	}
	r.Model = a.Model
	r.Effort = a.Effort
	switch a.Access {
	case "ask":
		r.Mode = "ask"
	case "edits":
		r.Mode = "edits"
	case "auto":
		r.Mode = "auto"
	}
	if !recipeModelRe.MatchString(r.Model) {
		r.Model = ""
	}
	if !recipeEffortRe.MatchString(r.Effort) {
		r.Effort = ""
	}
	return r
}

// recipeReadOnlyIntent is a prompt that says outright it changes nothing.
var recipeReadOnlyIntent = regexp.MustCompile(`(?i)(report only|read-only|changes? nothing|do not (edit|change|modify|delete|commit|push|comment|write)|don't (edit|change|modify|delete|commit|push)|without (editing|changing|committing)|never (edit|change|delete))`)

type recipeRule struct {
	re   *regexp.Regexp
	warn string
}

var recipeRules = []recipeRule{
	{regexp.MustCompile(`(?i)\b(git push|push (it|them|the|a|your|changes|to|a fix|fixes)|force[- ]push|open (a |the )?(pull request|pr)\b|create (a |the )?(pull request|pr)\b|gh pr create|gh pr merge|merge (the |a )?(pull request|pr|branch)|publish|npm publish|deploy|release it|tag a release)`), "Can push code, open pull requests or publish. Changes leave this machine."},
	{regexp.MustCompile(`(?i)\b(edit|fix|rewrite|refactor|rename|bump|upgrade|apply|git commit|commit (it|them|the|your|these|those|changes)|modify|replace|update (the|all|every|dependencies|deps|versions?|docs?|readme|changelog|config)|write (it |them |.{0,30})?(to|into) |save (it |the |a )?(to|as)|create (a |the )?(file|branch))`), "Changes files in the folder you choose."},
	{regexp.MustCompile(`(?i)(\brm -|\bdelete\b|\bdrop (table|database)\b|\bwipe\b|\bclear\b|\bclean (up|out)\b|\bremove (all|old|the files|files)\b|\bprune\b)`), "Deletes files or data."},
	{regexp.MustCompile(`(?i)(\bcurl\b|\bwget\b|\bsudo\b|\bssh\b|\bdocker\b|\bnpm (i|install|exec)\b|\bpip install\b|\bbrew\b|\bapt(-get)?\b)`), "Runs shell commands that may install software or use the network."},
}

// inspectRecipe lists what a person should know before adding r. It is a
// heuristic aid; the full prompt is always shown too.
func inspectRecipe(r *recipe) []recipeWarning {
	var out []recipeWarning
	// A prompt that says it changes nothing, in a mode that can't change
	// anything, isn't warned about editing, deleting or pushing.
	readOnly := recipeReadOnlyIntent.MatchString(r.Prompt) && (r.Mode == "plan" || r.Mode == "ask")
	for i, rule := range recipeRules {
		if readOnly && i < 3 {
			continue
		}
		if rule.re.MatchString(r.Prompt) {
			out = append(out, recipeWarning{"warn", rule.warn})
		}
	}
	switch r.Mode {
	case "auto":
		out = append(out, recipeWarning{"warn", "Asks to run in Auto mode: nobody approves each step while it runs."})
	case "edits":
		out = append(out, recipeWarning{"warn", "Asks to edit files without asking first."})
	case "plan", "ask":
		out = append(out, recipeWarning{"info", "Asks for a read-only or ask-first mode, so it changes nothing without approval."})
	}
	if strings.Contains(r.Prompt, "http://") || strings.Contains(r.Prompt, "https://") {
		out = append(out, recipeWarning{"warn", "The prompt mentions web addresses. Check each one."})
	}
	if recipeLocalPath.MatchString(r.Prompt) {
		out = append(out, recipeWarning{"info", "The prompt mentions a local path that may not exist on your machine."})
	}
	return out
}

// --- routes ---

func (s *Server) routesRecipes(m *http.ServeMux) {
	m.HandleFunc("POST /api/recipes/inspect", s.requireAuth(s.handleRecipeInspect))
	m.HandleFunc("GET /api/automations/{id}/recipe", s.requireAuth(s.handleAutomationRecipe))
}

// handleRecipeInspect checks a recipe from a link ({"data": "<base64url>"})
// and returns it normalized, with warnings. Nothing is created.
func (s *Server) handleRecipeInspect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Data string `json:"data"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, recipeMaxEncoded+1024)).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	rec, err := decodeRecipe(req.Data)
	if err != nil {
		httpError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, map[string]any{"recipe": rec, "warnings": inspectRecipe(rec)})
}

func (s *Server) handleAutomationRecipe(w http.ResponseWriter, r *http.Request) {
	a := s.automationFromPath(w, r)
	if a == nil {
		return
	}
	rec := recipeFromAutomation(a)
	enc, err := encodeRecipe(rec)
	if err != nil {
		httpError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"recipe":        rec,
		"link":          requestBaseURL(r) + "/automations/import#r=" + enc,
		"universalLink": recipeUniversalURL + enc,
	})
}
