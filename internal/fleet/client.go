// Package fleet is a small REST client for the hub API, used by the
// `overseer fleet` CLI and the MCP server.
package fleet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Client talks to a hub with an API token.
type Client struct {
	HubURL string
	Token  string
	http   *http.Client
}

// ClientConfig is stored at ~/.overseer/fleet.json by `overseer fleet login`.
type ClientConfig struct {
	HubURL string `json:"hubUrl"`
	Token  string `json:"token"`
}

func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".overseer", "fleet.json"), nil
}

// SaveConfig persists hub URL + API token for later fleet/mcp commands.
func SaveConfig(cfg ClientConfig) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(p, b, 0o600)
}

// NewFromEnv builds a client from OVERSEER_HUB/OVERSEER_TOKEN env vars or
// ~/.overseer/fleet.json.
func NewFromEnv() (*Client, error) {
	hub := os.Getenv("OVERSEER_HUB")
	token := os.Getenv("OVERSEER_TOKEN")
	if hub == "" || token == "" {
		p, err := configPath()
		if err == nil {
			if b, err := os.ReadFile(p); err == nil {
				var cfg ClientConfig
				if json.Unmarshal(b, &cfg) == nil {
					if hub == "" {
						hub = cfg.HubURL
					}
					if token == "" {
						token = cfg.Token
					}
				}
			}
		}
	}
	if hub == "" || token == "" {
		return nil, fmt.Errorf("no hub configured — run `overseer fleet login --hub URL --token TOKEN` (create a token in the UI under Settings), or set OVERSEER_HUB and OVERSEER_TOKEN")
	}
	return New(hub, token), nil
}

func New(hubURL, token string) *Client {
	return &Client{
		HubURL: strings.TrimRight(hubURL, "/"),
		Token:  token,
		http:   &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *Client) do(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.HubURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return fmt.Errorf("%s", e.Error)
		}
		return fmt.Errorf("%s %s: %s", method, path, resp.Status)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// --- typed API surface ---

type Device struct {
	Id       string `json:"id"`
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	IsHub    bool   `json:"isHub"`
	Online   bool   `json:"online"`
	Tmux     bool   `json:"tmux"`
	LastSeen int64  `json:"lastSeen"`
}

type Session struct {
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	Status       string `json:"status"`
	CreatedAt    int64  `json:"createdAt"`
	LastActivity int64  `json:"lastActivity"`
	Attached     bool   `json:"attached"`
	Ephemeral    bool   `json:"ephemeral"`
	DeviceId     string `json:"deviceId,omitempty"`
	DeviceName   string `json:"deviceName,omitempty"`
}

type ExecResult struct {
	ExitCode  int    `json:"exitCode"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	Truncated bool   `json:"truncated"`
}

func (c *Client) Devices() ([]Device, error) {
	var out []Device
	err := c.do("GET", "/api/devices", nil, &out)
	return out, err
}

// ResolveDevice accepts a device id or (case-insensitive) name.
func (c *Client) ResolveDevice(ref string) (*Device, error) {
	devices, err := c.Devices()
	if err != nil {
		return nil, err
	}
	for i := range devices {
		if devices[i].Id == ref || strings.EqualFold(devices[i].Name, ref) {
			return &devices[i], nil
		}
	}
	return nil, fmt.Errorf("no device named %q — run `overseer fleet devices` to list", ref)
}

func (c *Client) FleetSessions() ([]Session, error) {
	var out []Session
	err := c.do("GET", "/api/agents", nil, &out)
	return out, err
}

func (c *Client) Sessions(deviceId string) ([]Session, error) {
	var out []Session
	err := c.do("GET", "/api/devices/"+deviceId+"/sessions", nil, &out)
	return out, err
}

func (c *Client) CreateSession(deviceId, name, cwd, command, kind string) error {
	body := map[string]string{"name": name, "cwd": cwd, "command": command, "kind": kind}
	return c.do("POST", "/api/devices/"+deviceId+"/sessions", body, nil)
}

func (c *Client) KillSession(deviceId, name string) error {
	return c.do("DELETE", "/api/devices/"+deviceId+"/sessions/"+name, nil, nil)
}

func (c *Client) SendInput(deviceId, session, text string, enter bool) error {
	body := map[string]any{"text": text, "enter": enter}
	return c.do("POST", "/api/devices/"+deviceId+"/sessions/"+session+"/input", body, nil)
}

func (c *Client) ReadOutput(deviceId, session string, lines int) (string, error) {
	var out struct {
		Output string `json:"output"`
	}
	path := fmt.Sprintf("/api/devices/%s/sessions/%s/output?lines=%d", deviceId, session, lines)
	err := c.do("GET", path, nil, &out)
	return out.Output, err
}

func (c *Client) Run(deviceId, command, cwd string, timeoutSec int) (ExecResult, error) {
	var out ExecResult
	body := map[string]any{"command": command, "cwd": cwd, "timeoutSec": timeoutSec}
	err := c.do("POST", "/api/devices/"+deviceId+"/exec", body, &out)
	return out, err
}
