package protocol

// Live previews: listening-port discovery on a device. See the "Live
// previews" section of docs/agent-sessions-api.md.

const (
	// Hub -> agent request (carries Id); the reply data is []PortInfo.
	TypePortsList = "ports.list"
	// Agent -> hub notification (no Id): listeners appeared or disappeared.
	TypePortsChanged = "ports.changed"
)

// PortInfo is one TCP listener on a device that a preview can reach.
// PreviewUrl is filled in by the hub; the device always leaves it empty.
type PortInfo struct {
	Port       int    `json:"port"`
	Address    string `json:"address"`
	Pid        int    `json:"pid,omitempty"`
	Process    string `json:"process,omitempty"`
	Command    string `json:"command,omitempty"`
	Cwd        string `json:"cwd,omitempty"`
	Http       bool   `json:"http"`
	Title      string `json:"title,omitempty"`
	PreviewUrl string `json:"previewUrl"`
}
