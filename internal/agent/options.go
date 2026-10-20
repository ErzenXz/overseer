package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent option discovery (agent.options): which models, thinking levels,
// fast tiers and modes an agent's CLI offers on this machine. Discovery never
// sends a prompt, so it uses no quota; the probe process is always killed.
// Anything that fails falls back to the builtin tables.

const discoveryTimeout = 20 * time.Second

func discoverAgentOptions(req protocol.AgentOptionsRequest) protocol.AgentOptions {
	ctx, cancel := context.WithTimeout(context.Background(), discoveryTimeout)
	defer cancel()
	opts, err := discover(ctx, req)
	if err != nil {
		log.Printf("agent options for %s: %v (using builtin)", req.Agent, err)
		return protocol.BuiltinAgentOptions(req.Agent)
	}
	opts.Agent = req.Agent
	opts.Source = protocol.OptionsDiscovered
	return opts
}

func discover(ctx context.Context, req protocol.AgentOptionsRequest) (protocol.AgentOptions, error) {
	switch req.Agent {
	case "claude":
		return discoverClaude(ctx)
	case "codex":
		return discoverCodex(ctx)
	}
	bin, candidates, err := acpLaunch(req.Agent, req.Command)
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	return discoverACP(ctx, req.Agent, bin, candidates)
}

// probeDir is an empty working directory for a probe process.
func probeDir() (string, func(), error) {
	dir, err := os.MkdirTemp("", "overseer-probe-")
	if err != nil {
		return "", nil, err
	}
	return dir, func() { os.RemoveAll(dir) }, nil
}

// --- Claude Code: stream-json initialize control request ---

func discoverClaude(ctx context.Context) (protocol.AgentOptions, error) {
	path, err := lookAgentBinary("claude")
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	dir, cleanup, err := probeDir()
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	defer cleanup()
	args := []string{"--print", "--input-format", "stream-json", "--output-format", "stream-json",
		"--verbose", "--permission-prompt-tool", "stdio"}
	proc, err := startAgentProcess(path, args, dir, agentEnv())
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	defer proc.kill()
	got := make(chan jsonObj, 1)
	proc.readLines(func(line []byte) {
		m := decodeObj(line)
		if jStr(m, "type") != "control_response" {
			return
		}
		if r := jObj(m, "response"); jStr(r, "request_id") == "probe-init" {
			select {
			case got <- r:
			default:
			}
		}
	})
	if err := proc.writeJSON(map[string]any{"type": "control_request", "request_id": "probe-init",
		"request": map[string]any{"subtype": "initialize"}}); err != nil {
		return protocol.AgentOptions{}, err
	}
	select {
	case r := <-got:
		if jStr(r, "subtype") == "error" {
			return protocol.AgentOptions{}, fmt.Errorf("initialize: %s", jStr(r, "error"))
		}
		return claudeOptionsFrom(jObj(r, "response"))
	case <-proc.done:
		return protocol.AgentOptions{}, errors.New(proc.exitError())
	case <-ctx.Done():
		return protocol.AgentOptions{}, fmt.Errorf("claude did not answer initialize: %w", ctx.Err())
	}
}

// stringList reads a list of strings (or of objects carrying the string
// under value/id/level/name).
func stringList(v any) ([]string, bool) {
	arr, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := []string{}
	for _, x := range arr {
		switch t := x.(type) {
		case string:
			out = append(out, t)
		case map[string]any:
			if s := jStr(t, "value", "id", "level", "reasoningEffort", "name"); s != "" {
				out = append(out, s)
			}
		}
	}
	return out, true
}

func firstList(m jsonObj, keys ...string) ([]string, bool) {
	for _, k := range keys {
		if l, ok := stringList(m[k]); ok {
			return l, true
		}
	}
	return nil, false
}

// findArray returns m[key] as an array, also looking one object level down
// (the CLI has nested its initialize payload differently across versions).
func findArray(m jsonObj, key string) []any {
	if a := jArr(m, key); a != nil {
		return a
	}
	for _, v := range m {
		if o, ok := v.(map[string]any); ok {
			if a := jArr(o, key); a != nil {
				return a
			}
		}
	}
	return nil
}

// claudeOptionsFrom maps Claude Code's initialize response onto AgentOptions.
func claudeOptionsFrom(resp jsonObj) (protocol.AgentOptions, error) {
	o := protocol.BuiltinAgentOptions("claude")
	var models []protocol.AgentModel
	var allEfforts []string
	anyEfforts, autoKnown, autoAny, fastAny := false, false, false, false
	type raw struct {
		m        jsonObj
		efforts  []string
		reported bool
	}
	var entries []raw
	for _, x := range findArray(resp, "models") {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		efforts, reported := firstList(m, "supportedEffortLevels", "supported_effort_levels", "effortLevels", "efforts")
		if reported && len(efforts) > 0 {
			anyEfforts = true
			allEfforts = append(allEfforts, efforts...)
		}
		if _, ok := m["supportsAutoMode"]; ok {
			autoKnown = true
			autoAny = autoAny || jBool(m, "supportsAutoMode")
		}
		fastAny = fastAny || jBool(m, "supportsFastMode")
		entries = append(entries, raw{m, efforts, reported})
	}
	for _, e := range entries {
		id := jStr(e.m, "value", "id", "model")
		if id == "" {
			continue
		}
		label := jStr(e.m, "displayName", "display_name", "label", "name")
		if label == "" {
			label = id
		}
		model := protocol.AgentModel{
			Id: id, Label: label, Description: jStr(e.m, "description"),
			DefaultEffort: jStr(e.m, "defaultEffort", "defaultEffortLevel", "default_effort"),
			Default:       id == "default" || jBool(e.m, "isDefault") || jBool(e.m, "default"),
		}
		switch {
		case e.reported:
			model.Efforts = protocol.SortEfforts(e.efforts)
			if model.Efforts == nil {
				model.Efforts = []string{}
			}
		case anyEfforts:
			model.Efforts = []string{} // the catalog reports efforts, just none for this model
		}
		models = append(models, model)
	}
	if len(models) == 0 {
		return o, errors.New("initialize response has no model catalog")
	}
	o.Models = models
	if anyEfforts {
		o.Efforts = protocol.EffortsFromIds(allEfforts)
	}
	_, fastState := resp["fast_mode_state"]
	if !fastAny && !fastState {
		o.Fast = nil
	}
	listed, hasList := firstList(resp, "available_permission_modes", "permission_modes", "permissionModes", "availablePermissionModes")
	keep := func(id string) bool {
		if hasList {
			for _, l := range listed {
				if l == id || (id == "default" && l == "manual") {
					return true
				}
			}
			return false
		}
		return id != "auto" || !autoKnown || autoAny
	}
	o.Modes = o.Modes[:0]
	for _, m := range protocol.ClaudeModes {
		if keep(m.Id) {
			o.Modes = append(o.Modes, m)
		}
	}
	if len(o.Modes) == 0 {
		o.Modes = append(o.Modes, protocol.ClaudeModes...)
	}
	o.DefaultMode = o.Modes[0].Id
	if cur := jStr(resp, "current_permission_mode", "permissionMode", "permission_mode"); cur != "" {
		for _, m := range o.Modes {
			if m.Id == cur {
				o.DefaultMode = cur
			}
		}
	}
	return o, nil
}

// --- Codex: app-server model/list ---

type codexModel struct {
	id, model, label, description string
	efforts                       []protocol.AgentEffort
	defaultEffort                 string
	isDefault, hidden             bool
	tier, tierName, tierDesc      string
}

// parseCodexModels decodes one model/list page.
func parseCodexModels(raw json.RawMessage) ([]codexModel, string) {
	r := decodeObj(raw)
	var out []codexModel
	for _, x := range jArr(r, "data") {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		cm := codexModel{
			id: jStr(m, "id"), model: jStr(m, "model"), label: jStr(m, "displayName", "display_name"),
			description: jStr(m, "description"), defaultEffort: jStr(m, "defaultReasoningEffort", "default_reasoning_effort"),
			isDefault: jBool(m, "isDefault"), hidden: jBool(m, "hidden"),
		}
		for _, e := range jArr(m, "supportedReasoningEfforts") {
			switch t := e.(type) {
			case map[string]any:
				if id := jStr(t, "reasoningEffort", "effort", "id"); id != "" {
					cm.efforts = append(cm.efforts, protocol.AgentEffort{Id: id, Label: protocol.EffortLabel(id), Description: jStr(t, "description")})
				}
			case string:
				cm.efforts = append(cm.efforts, protocol.AgentEffort{Id: t, Label: protocol.EffortLabel(t)})
			}
		}
		for _, t := range jArr(m, "serviceTiers") {
			if tm, ok := t.(map[string]any); ok && jStr(tm, "id") != "" {
				cm.tier, cm.tierName, cm.tierDesc = jStr(tm, "id"), jStr(tm, "name"), jStr(tm, "description")
				break
			}
		}
		if cm.model == "" {
			cm.model = cm.id
		}
		if cm.model != "" {
			out = append(out, cm)
		}
	}
	next, _ := r["nextCursor"].(string)
	return out, next
}

// codexListModels pages through model/list.
func codexListModels(ctx context.Context, rpc *rpcConn) ([]codexModel, error) {
	var all []codexModel
	cursor := ""
	for page := 0; page < 20; page++ {
		params := map[string]any{"limit": 100}
		if cursor != "" {
			params["cursor"] = cursor
		}
		var res json.RawMessage
		if err := rpc.call(ctx, "model/list", params, &res); err != nil {
			return nil, err
		}
		models, next := parseCodexModels(res)
		all = append(all, models...)
		if next == "" || next == cursor {
			break
		}
		cursor = next
	}
	return all, nil
}

// codexOptionsFrom builds AgentOptions from the catalog. collab lists the
// collaboration modes the server reported (nil = unknown).
func codexOptionsFrom(models []codexModel, collab []string) (protocol.AgentOptions, error) {
	o := protocol.BuiltinAgentOptions("codex")
	o.Models = []protocol.AgentModel{}
	var effortIds []string
	effortDesc := map[string]string{}
	var fast *protocol.AgentFast
	for _, m := range models {
		if m.hidden {
			continue
		}
		label := m.label
		if label == "" {
			label = m.model
		}
		am := protocol.AgentModel{Id: m.model, Label: label, Description: m.description,
			DefaultEffort: m.defaultEffort, Default: m.isDefault, Efforts: []string{}}
		for _, e := range m.efforts {
			am.Efforts = append(am.Efforts, e.Id)
			effortIds = append(effortIds, e.Id)
			if effortDesc[e.Id] == "" {
				effortDesc[e.Id] = e.Description
			}
		}
		am.Efforts = protocol.SortEfforts(am.Efforts)
		if am.Efforts == nil {
			am.Efforts = []string{}
		}
		if m.tier != "" && (fast == nil || m.isDefault) {
			name := m.tierName
			if name == "" {
				name = protocol.CodexFast.Label
			}
			desc := m.tierDesc
			if desc == "" {
				desc = protocol.CodexFast.Description
			}
			fast = &protocol.AgentFast{Label: name, Description: desc}
		}
		o.Models = append(o.Models, am)
	}
	if len(o.Models) == 0 {
		return o, errors.New("model/list returned no models")
	}
	o.Efforts = protocol.EffortsFromIds(effortIds)
	for i := range o.Efforts {
		o.Efforts[i].Description = effortDesc[o.Efforts[i].Id]
	}
	o.Fast = fast
	if collab != nil {
		plan := false
		for _, c := range collab {
			plan = plan || c == "plan"
		}
		if !plan {
			modes := o.Modes[:0]
			for _, m := range o.Modes {
				if m.Id != "plan" {
					modes = append(modes, m)
				}
			}
			o.Modes = modes
		}
	}
	return o, nil
}

func discoverCodex(ctx context.Context) (protocol.AgentOptions, error) {
	path, err := lookAgentBinary("codex")
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	dir, cleanup, err := probeDir()
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	defer cleanup()
	proc, err := startAgentProcess(path, []string{"app-server"}, dir, agentEnv())
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	defer proc.kill()
	rpc := newRPCConn(false)
	rpc.proc = proc
	proc.readLines(rpc.handleLine)
	go func() { <-proc.done; rpc.shutdown() }()

	if err := rpc.call(ctx, "initialize", map[string]any{
		"clientInfo":   map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		return protocol.AgentOptions{}, err
	}
	if err := rpc.notify("initialized", nil); err != nil {
		return protocol.AgentOptions{}, err
	}
	models, err := codexListModels(ctx, rpc)
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	var collab []string
	var res json.RawMessage
	if rpc.call(ctx, "collaborationMode/list", map[string]any{}, &res) == nil {
		collab = []string{}
		for _, x := range jArr(decodeObj(res), "data") {
			if m, ok := x.(map[string]any); ok {
				collab = append(collab, jStr(m, "mode"))
			}
		}
	}
	return codexOptionsFrom(models, collab)
}

// --- ACP: initialize + session/new ---

type acpChoice struct {
	Id, Name, Description string
}

type acpConfigOption struct {
	Id, Name, Category, Current string
	Options                     []acpChoice
}

// acpSessionInfo is what session/new (or session/load) says about modes,
// models and config options.
type acpSessionInfo struct {
	SessionId    string
	HasModes     bool
	Modes        []acpChoice
	CurrentMode  string
	HasModels    bool
	Models       []acpChoice
	CurrentModel string
	Config       []acpConfigOption
}

func acpChoices(arr []any, idKeys ...string) []acpChoice {
	var out []acpChoice
	for _, x := range arr {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		if id := jStr(m, idKeys...); id != "" {
			out = append(out, acpChoice{Id: id, Name: jStr(m, "name"), Description: jStr(m, "description")})
		}
	}
	return out
}

// parseACPConfigOptions reads configOptions; select options may be flat or
// grouped ({group, name, options}).
func parseACPConfigOptions(arr []any) []acpConfigOption {
	var out []acpConfigOption
	for _, x := range arr {
		m, ok := x.(map[string]any)
		if !ok || jStr(m, "id") == "" {
			continue
		}
		opt := acpConfigOption{Id: jStr(m, "id"), Name: jStr(m, "name"), Category: jStr(m, "category"), Current: jStr(m, "currentValue")}
		for _, o := range jArr(m, "options") {
			om, ok := o.(map[string]any)
			if !ok {
				continue
			}
			if sub := jArr(om, "options"); sub != nil {
				opt.Options = append(opt.Options, acpChoices(sub, "value")...)
			} else if v := jStr(om, "value"); v != "" {
				opt.Options = append(opt.Options, acpChoice{Id: v, Name: jStr(om, "name"), Description: jStr(om, "description")})
			}
		}
		out = append(out, opt)
	}
	return out
}

func parseACPSession(raw json.RawMessage) acpSessionInfo {
	r := decodeObj(raw)
	info := acpSessionInfo{SessionId: jStr(r, "sessionId")}
	if modes := jObj(r, "modes"); len(modes) > 0 {
		info.Modes = acpChoices(jArr(modes, "availableModes"), "id", "modeId")
		info.CurrentMode = jStr(modes, "currentModeId")
		info.HasModes = len(info.Modes) > 0
	}
	if models := jObj(r, "models"); len(models) > 0 {
		info.Models = acpChoices(jArr(models, "availableModels"), "modelId", "id")
		info.CurrentModel = jStr(models, "currentModelId")
		info.HasModels = len(info.Models) > 0
	}
	info.Config = parseACPConfigOptions(jArr(r, "configOptions"))
	return info
}

// option returns the first config option of category (or with that id).
func (i acpSessionInfo) option(category string) *acpConfigOption {
	for k := range i.Config {
		if i.Config[k].Category == category {
			return &i.Config[k]
		}
	}
	for k := range i.Config {
		if i.Config[k].Category == "" && i.Config[k].Id == category {
			return &i.Config[k]
		}
	}
	return nil
}

func (i acpSessionInfo) modeChoices() []acpChoice {
	if i.HasModes {
		return i.Modes
	}
	if o := i.option("mode"); o != nil {
		return o.Options
	}
	return nil
}

func (i acpSessionInfo) initialMode() string {
	if i.HasModes {
		return i.CurrentMode
	}
	if o := i.option("mode"); o != nil {
		return o.Current
	}
	return ""
}

func (i acpSessionInfo) modelChoices() ([]acpChoice, string) {
	if i.HasModels {
		return i.Models, i.CurrentModel
	}
	if o := i.option("model"); o != nil {
		return o.Options, o.Current
	}
	return nil, ""
}

// acpOptionsFrom maps session info onto AgentOptions.
func acpOptionsFrom(agent string, info acpSessionInfo) protocol.AgentOptions {
	o := protocol.BuiltinAgentOptions(agent)
	if choices := info.modeChoices(); len(choices) > 0 {
		o.Modes = make([]protocol.AgentMode, 0, len(choices))
		for _, c := range choices {
			label := c.Name
			if label == "" {
				label = c.Id
			}
			o.Modes = append(o.Modes, protocol.AgentMode{Id: c.Id, Label: label, Description: c.Description,
				Kind: protocol.GuessModeKind(c.Id, c.Name)})
		}
		o.DefaultMode = o.Modes[0].Id
		if cur := info.initialMode(); cur != "" {
			o.DefaultMode = cur
		}
	}
	models, current := info.modelChoices()
	for _, c := range models {
		label := c.Name
		if label == "" {
			label = c.Id
		}
		o.Models = append(o.Models, protocol.AgentModel{Id: c.Id, Label: label, Description: c.Description, Default: c.Id == current})
	}
	if t := info.option("thought_level"); t != nil {
		for _, c := range t.Options {
			label := c.Name
			if label == "" {
				label = protocol.EffortLabel(c.Id)
			}
			o.Efforts = append(o.Efforts, protocol.AgentEffort{Id: c.Id, Label: label, Description: c.Description})
		}
	}
	return o
}

func discoverACP(ctx context.Context, agent, bin string, candidates [][]string) (protocol.AgentOptions, error) {
	path, err := lookAgentBinary(bin)
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	dir, cleanup, err := probeDir()
	if err != nil {
		return protocol.AgentOptions{}, err
	}
	defer cleanup()
	var lastErr error
	for _, args := range candidates {
		info, err := probeACP(ctx, path, args, dir)
		if err == nil {
			return acpOptionsFrom(agent, info), nil
		}
		lastErr = err
		if ctx.Err() != nil {
			break
		}
	}
	return protocol.AgentOptions{}, lastErr
}

// probeACP runs initialize + session/new, then deletes or closes the probe
// session when the agent supports it, and kills the process.
func probeACP(ctx context.Context, path string, args []string, dir string) (acpSessionInfo, error) {
	proc, err := startAgentProcess(path, args, dir, agentEnv())
	if err != nil {
		return acpSessionInfo{}, err
	}
	defer proc.kill()
	rpc := newRPCConn(true)
	rpc.proc = proc
	proc.readLines(rpc.handleLine)
	go func() { <-proc.done; rpc.shutdown() }()

	fail := func(err error) (acpSessionInfo, error) {
		if !proc.alive() {
			return acpSessionInfo{}, fmt.Errorf("%v: %s", err, proc.exitError())
		}
		return acpSessionInfo{}, err
	}
	var init json.RawMessage
	err = rpc.call(ctx, "initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]bool{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
		"clientInfo": map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
	}, &init)
	if err != nil {
		return fail(err)
	}
	var sess json.RawMessage
	if err := rpc.call(ctx, "session/new", map[string]any{"cwd": dir, "mcpServers": []any{}}, &sess); err != nil {
		return fail(err)
	}
	info := parseACPSession(sess)
	if info.SessionId == "" {
		return acpSessionInfo{}, errors.New("agent returned no session id")
	}
	caps := jObj(jObj(decodeObj(init), "agentCapabilities"), "sessionCapabilities")
	cctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ref := map[string]string{"sessionId": info.SessionId}
	if _, ok := caps["delete"]; ok {
		rpc.call(cctx, "session/delete", ref, nil)
	} else if _, ok := caps["close"]; ok {
		rpc.call(cctx, "session/close", ref, nil)
	}
	return info, nil
}
