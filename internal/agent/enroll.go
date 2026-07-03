package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ConfigPath returns where the agent config lives (~/.overseer/agent.json).
func ConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".overseer", "agent.json"), nil
}

// LoadConfig reads the enrolled-agent config.
func LoadConfig() (Config, error) {
	var cfg Config
	p, err := ConfigPath()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return cfg, fmt.Errorf("reading %s (is this device enrolled? run `overseer agent enroll`): %w", p, err)
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("parsing %s: %w", p, err)
	}
	return cfg, nil
}

type enrollRequest struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

type enrollResponse struct {
	DeviceId    string `json:"deviceId"`
	DeviceToken string `json:"deviceToken"`
}

// Enroll exchanges a single-use enrollment token for a permanent device
// credential and writes the agent config.
func Enroll(hubURL, token string) (Config, error) {
	hubURL = strings.TrimRight(hubURL, "/")
	hostname, _ := os.Hostname()
	body, _ := json.Marshal(enrollRequest{
		Token: token, Hostname: hostname, OS: runtime.GOOS, Arch: runtime.GOARCH,
	})
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(hubURL+"/api/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		return Config{}, fmt.Errorf("reaching hub at %s: %w", hubURL, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return Config{}, fmt.Errorf("hub refused enrollment (%s): %s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	var er enrollResponse
	if err := json.Unmarshal(respBody, &er); err != nil {
		return Config{}, fmt.Errorf("parsing enrollment response: %w", err)
	}

	cfg := Config{HubURL: hubURL, DeviceId: er.DeviceId, Token: er.DeviceToken}
	p, err := ConfigPath()
	if err != nil {
		return Config{}, err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return Config{}, err
	}
	out, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(p, out, 0o600); err != nil {
		return Config{}, err
	}
	return cfg, nil
}
