// Package protocol defines the wire format between the hub and device agents.
//
// A single WebSocket connection carries everything:
//   - Text frames: JSON-encoded Msg control messages.
//   - Binary frames: [4-byte big-endian channel id][payload] for streams
//     (terminal I/O and file transfers).
package protocol

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

// Message types, agent <-> hub.
const (
	// Agent -> hub on connect.
	TypeHello = "hello"
	// Hub -> agent, accepts the connection.
	TypeWelcome = "welcome"
	// Agent -> hub, periodic system stats.
	TypeStats = "stats"

	// Hub -> agent requests (carry Id); agent replies with TypeResult.
	TypeSessionsList  = "sessions.list"
	TypeSessionCreate = "session.create"
	TypeSessionKill   = "session.kill"
	TypeExec          = "exec"
	TypeFsList        = "fs.list"

	// Generic response to any Id-carrying request.
	TypeResult = "result"

	// Terminal streaming (carry Channel).
	TypeTermOpen   = "term.open"
	TypeTermOpened = "term.opened"
	TypeTermResize = "term.resize"
	TypeTermClose  = "term.close"
	TypeTermExit   = "term.exit"

	// File streaming (carry Channel).
	TypeFsRead  = "fs.read"  // hub -> agent: start download stream
	TypeFsWrite = "fs.write" // hub -> agent: start upload stream
	TypeFsEOF   = "fs.eof"   // sender -> receiver: stream complete
	TypeFsErr   = "fs.err"   // either direction: stream failed
)

// Msg is the JSON control envelope. Fields are used per-type; unused ones are omitted.
type Msg struct {
	Type    string          `json:"type"`
	Id      uint64          `json:"id,omitempty"`
	Channel uint32          `json:"channel,omitempty"`
	Error   string          `json:"error,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// NewMsg builds a Msg with Data marshalled from v (nil v leaves Data empty).
func NewMsg(typ string, id uint64, channel uint32, v any) (Msg, error) {
	m := Msg{Type: typ, Id: id, Channel: channel}
	if v != nil {
		b, err := json.Marshal(v)
		if err != nil {
			return m, err
		}
		m.Data = b
	}
	return m, nil
}

// Hello is sent by the agent immediately after connecting.
type Hello struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
	Tmux     bool   `json:"tmux"`
}

// Welcome is the hub's acceptance of an agent connection.
type Welcome struct {
	DeviceId string `json:"deviceId"`
}

// Stats is a periodic system snapshot from the agent.
type Stats struct {
	CPUPercent float64 `json:"cpuPercent"`
	MemUsed    uint64  `json:"memUsed"`
	MemTotal   uint64  `json:"memTotal"`
	DiskUsed   uint64  `json:"diskUsed"`
	DiskTotal  uint64  `json:"diskTotal"`
	UptimeSec  uint64  `json:"uptimeSec"`
}

// Session describes one terminal session on a device.
type Session struct {
	Name         string `json:"name"`
	Kind         string `json:"kind"` // "shell", "claude", "codex", ... ("" for plain tmux sessions)
	Status       string `json:"status"` // "working" | "idle" | "exited"
	CreatedAt    int64  `json:"createdAt"`
	LastActivity int64  `json:"lastActivity"`
	Attached     bool   `json:"attached"`
	Ephemeral    bool   `json:"ephemeral"` // true when tmux is unavailable (plain PTY, won't survive)
}

// SessionsListResult is the reply to sessions.list.
type SessionsListResult struct {
	Sessions []Session `json:"sessions"`
}

// SessionCreate asks the agent to create a detached session.
type SessionCreate struct {
	Name    string `json:"name"`
	Cwd     string `json:"cwd,omitempty"`
	Command string `json:"command,omitempty"` // empty = default shell
	Kind    string `json:"kind,omitempty"`
}

// SessionKill asks the agent to terminate a session.
type SessionKill struct {
	Name string `json:"name"`
}

// Exec runs a command to completion on the device.
type Exec struct {
	Command    string `json:"command"` // run via the user's shell
	Cwd        string `json:"cwd,omitempty"`
	TimeoutSec int    `json:"timeoutSec,omitempty"` // default 60, max 600
}

// ExecResult is the reply to exec. Output is capped by the agent.
type ExecResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	Truncated bool  `json:"truncated,omitempty"`
}

// TermOpen asks the agent to attach a PTY to a session and stream it on Channel.
type TermOpen struct {
	Session string `json:"session"`
	Cols    int    `json:"cols"`
	Rows    int    `json:"rows"`
}

// TermResize resizes the PTY behind Channel.
type TermResize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// FsList lists a directory.
type FsList struct {
	Path string `json:"path"`
}

// FsEntry is one directory entry.
type FsEntry struct {
	Name    string `json:"name"`
	Dir     bool   `json:"dir"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"`
}

// FsListResult is the reply to fs.list.
type FsListResult struct {
	Path    string    `json:"path"`
	Entries []FsEntry `json:"entries"`
}

// FsRead / FsWrite start a file stream on Channel.
type FsTransfer struct {
	Path string `json:"path"`
}

// Binary frame helpers.

// EncodeFrame prefixes payload with the channel id.
func EncodeFrame(channel uint32, payload []byte) []byte {
	buf := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(buf, channel)
	copy(buf[4:], payload)
	return buf
}

// DecodeFrame splits a binary frame into channel id and payload.
func DecodeFrame(frame []byte) (uint32, []byte, error) {
	if len(frame) < 4 {
		return 0, nil, fmt.Errorf("binary frame too short: %d bytes", len(frame))
	}
	return binary.BigEndian.Uint32(frame), frame[4:], nil
}
