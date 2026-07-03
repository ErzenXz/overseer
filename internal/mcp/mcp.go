// Package mcp implements a minimal Model Context Protocol server over stdio,
// exposing fleet operations so coding agents (Claude Code, Codex, ...) can
// orchestrate worker agents across every Overseer device.
package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/overseer-sh/overseer/internal/fleet"
)

const protocolVersion = "2024-11-05"

type rpcRequest struct {
	Jsonrpc string          `json:"jsonrpc"`
	Id      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	Jsonrpc string          `json:"jsonrpc"`
	Id      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// Serve runs the MCP server on stdin/stdout until EOF.
func Serve(client *fleet.Client, version string) error {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriter(os.Stdout)
	enc := json.NewEncoder(out)

	for {
		line, err := in.ReadBytes('\n')
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		if req.Id == nil {
			continue // notification; nothing requires action
		}
		resp := rpcResponse{Jsonrpc: "2.0", Id: req.Id}
		result, rerr := handle(client, version, req)
		if rerr != nil {
			resp.Error = &rpcError{Code: -32603, Message: rerr.Error()}
		} else {
			resp.Result = result
		}
		if err := enc.Encode(resp); err != nil {
			return err
		}
		out.Flush()
	}
}

func handle(client *fleet.Client, version string, req rpcRequest) (any, error) {
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "overseer", "version": version},
		}, nil
	case "tools/list":
		return map[string]any{"tools": toolDefs()}, nil
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		text, err := callTool(client, params.Name, params.Arguments)
		if err != nil {
			return map[string]any{
				"content": []map[string]any{{"type": "text", "text": "Error: " + err.Error()}},
				"isError": true,
			}, nil
		}
		return map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
		}, nil
	case "ping":
		return map[string]any{}, nil
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func obj(props map[string]any, required ...string) map[string]any {
	if required == nil {
		required = []string{}
	}
	return map[string]any{"type": "object", "properties": props, "required": required}
}

func str(desc string) map[string]any  { return map[string]any{"type": "string", "description": desc} }
func num(desc string) map[string]any  { return map[string]any{"type": "number", "description": desc} }
func boolp(desc string) map[string]any { return map[string]any{"type": "boolean", "description": desc} }

func toolDefs() []map[string]any {
	device := str("Device name or id (see list_devices)")
	session := str("Session name")
	return []map[string]any{
		{
			"name":        "list_devices",
			"description": "List every device in the Overseer fleet with online status, OS, and whether tmux is available.",
			"inputSchema": obj(map[string]any{}),
		},
		{
			"name":        "list_sessions",
			"description": "List terminal/agent sessions. Without a device, lists sessions across the whole fleet with their status (working/idle).",
			"inputSchema": obj(map[string]any{"device": str("Optional device name or id to filter")}),
		},
		{
			"name":        "create_session",
			"description": "Create a persistent (tmux) session on a device, optionally starting a command in it — e.g. launch a coding agent like `claude` in a project directory. Returns immediately; use read_output to observe it.",
			"inputSchema": obj(map[string]any{
				"device":  device,
				"name":    str("Session name (letters, digits, . _ -)"),
				"cwd":     str("Working directory (optional)"),
				"command": str("Command to run in the session (optional; empty = shell)"),
				"kind":    str("Label like 'claude', 'codex', 'shell' (optional)"),
			}, "device", "name"),
		},
		{
			"name":        "send_input",
			"description": "Type text into a session (like typing into its terminal). Set enter=true to press Enter after the text. Use this to answer prompts or steer an agent running in the session.",
			"inputSchema": obj(map[string]any{
				"device":  device,
				"session": session,
				"text":    str("Text to type (may be empty if only pressing Enter)"),
				"enter":   boolp("Press Enter after typing (default true)"),
			}, "device", "session"),
		},
		{
			"name":        "read_output",
			"description": "Read the most recent terminal output of a session (its visible scrollback). Use to check what an agent or command is doing.",
			"inputSchema": obj(map[string]any{
				"device":  device,
				"session": session,
				"lines":   num("How many lines of scrollback (default 200, max 10000)"),
			}, "device", "session"),
		},
		{
			"name":        "run_command",
			"description": "Run a shell command on a device and wait for it to finish. Returns exit code, stdout, and stderr. For long-running or interactive work use create_session instead.",
			"inputSchema": obj(map[string]any{
				"device":     device,
				"command":    str("Shell command to run"),
				"cwd":        str("Working directory (optional)"),
				"timeoutSec": num("Timeout in seconds (default 60, max 600)"),
			}, "device", "command"),
		},
		{
			"name":        "kill_session",
			"description": "Terminate a session on a device.",
			"inputSchema": obj(map[string]any{"device": device, "session": session}, "device", "session"),
		},
	}
}

func callTool(client *fleet.Client, name string, rawArgs json.RawMessage) (string, error) {
	var args struct {
		Device     string  `json:"device"`
		Name       string  `json:"name"`
		Session    string  `json:"session"`
		Cwd        string  `json:"cwd"`
		Command    string  `json:"command"`
		Kind       string  `json:"kind"`
		Text       string  `json:"text"`
		Enter      *bool   `json:"enter"`
		Lines      float64 `json:"lines"`
		TimeoutSec float64 `json:"timeoutSec"`
	}
	if len(rawArgs) > 0 {
		if err := json.Unmarshal(rawArgs, &args); err != nil {
			return "", fmt.Errorf("bad arguments: %w", err)
		}
	}
	resolve := func() (*fleet.Device, error) {
		if args.Device == "" {
			return nil, fmt.Errorf("device is required")
		}
		return client.ResolveDevice(args.Device)
	}

	switch name {
	case "list_devices":
		devices, err := client.Devices()
		if err != nil {
			return "", err
		}
		var b strings.Builder
		for _, d := range devices {
			status := "offline"
			if d.Online {
				status = "online"
			}
			hub := ""
			if d.IsHub {
				hub = " [hub]"
			}
			tmux := ""
			if d.Online && !d.Tmux {
				tmux = " (no tmux: sessions won't persist)"
			}
			fmt.Fprintf(&b, "- %s%s — id %s, %s/%s, %s%s\n", d.Name, hub, d.Id, d.OS, d.Arch, status, tmux)
		}
		if b.Len() == 0 {
			return "No devices in the fleet yet.", nil
		}
		return b.String(), nil

	case "list_sessions":
		var sessions []fleet.Session
		var err error
		if args.Device != "" {
			d, derr := resolve()
			if derr != nil {
				return "", derr
			}
			sessions, err = client.Sessions(d.Id)
			for i := range sessions {
				sessions[i].DeviceName = d.Name
			}
		} else {
			sessions, err = client.FleetSessions()
		}
		if err != nil {
			return "", err
		}
		if len(sessions) == 0 {
			return "No sessions running.", nil
		}
		var b strings.Builder
		for _, s := range sessions {
			kind := s.Kind
			if kind == "" {
				kind = "terminal"
			}
			fmt.Fprintf(&b, "- %s on %s — %s, %s\n", s.Name, s.DeviceName, kind, s.Status)
		}
		return b.String(), nil

	case "create_session":
		d, err := resolve()
		if err != nil {
			return "", err
		}
		if args.Name == "" {
			return "", fmt.Errorf("name is required")
		}
		if err := client.CreateSession(d.Id, args.Name, args.Cwd, args.Command, args.Kind); err != nil {
			return "", err
		}
		return fmt.Sprintf("Session %q created on %s.", args.Name, d.Name), nil

	case "send_input":
		d, err := resolve()
		if err != nil {
			return "", err
		}
		enter := true
		if args.Enter != nil {
			enter = *args.Enter
		}
		if err := client.SendInput(d.Id, args.Session, args.Text, enter); err != nil {
			return "", err
		}
		return "Input sent.", nil

	case "read_output":
		d, err := resolve()
		if err != nil {
			return "", err
		}
		lines := int(args.Lines)
		if lines <= 0 {
			lines = 200
		}
		out, err := client.ReadOutput(d.Id, args.Session, lines)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(out) == "" {
			return "(no output)", nil
		}
		return out, nil

	case "run_command":
		d, err := resolve()
		if err != nil {
			return "", err
		}
		if args.Command == "" {
			return "", fmt.Errorf("command is required")
		}
		res, err := client.Run(d.Id, args.Command, args.Cwd, int(args.TimeoutSec))
		if err != nil {
			return "", err
		}
		var b strings.Builder
		fmt.Fprintf(&b, "exit code: %d\n", res.ExitCode)
		if res.Stdout != "" {
			fmt.Fprintf(&b, "--- stdout ---\n%s\n", res.Stdout)
		}
		if res.Stderr != "" {
			fmt.Fprintf(&b, "--- stderr ---\n%s\n", res.Stderr)
		}
		if res.Truncated {
			b.WriteString("(output truncated)\n")
		}
		return b.String(), nil

	case "kill_session":
		d, err := resolve()
		if err != nil {
			return "", err
		}
		if err := client.KillSession(d.Id, args.Session); err != nil {
			return "", err
		}
		return fmt.Sprintf("Session %q on %s killed.", args.Session, d.Name), nil

	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}
