package hub

import (
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestTerminalBridge drives the full browser path: WS into the hub, PTY on
// the device, keystrokes in, output back.
func TestTerminalBridge(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)

	apiToken, err := srv.store.CreateApiToken("term-test")
	if err != nil {
		t.Fatal(err)
	}
	session := fmt.Sprintf("ovsr-term-%d", time.Now().UnixNano())
	defer exec.Command("tmux", "kill-session", "-t", session).Run()

	url := strings.Replace(base, "http://", "ws://", 1) +
		fmt.Sprintf("/api/ws/term?device=%s&session=%s&cols=100&rows=30", deviceId, session)
	hdr := http.Header{"Authorization": {"Bearer " + apiToken}}
	ws, _, err := websocket.DefaultDialer.Dial(url, hdr)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()

	// Type a command whose output can't appear by keystroke echo alone. The
	// shell may still be starting, so retype it until the result shows up.
	typeCmd := func() {
		ws.WriteMessage(websocket.BinaryMessage, []byte("echo over$((100+23))seer\r"))
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(700 * time.Millisecond):
				typeCmd()
			}
		}
	}()

	var collected strings.Builder
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		ws.SetReadDeadline(time.Now().Add(3 * time.Second))
		msgType, data, err := ws.ReadMessage()
		if err != nil {
			break
		}
		if msgType == websocket.BinaryMessage {
			collected.Write(data)
			if strings.Contains(collected.String(), "over123seer") {
				return // success
			}
		}
	}
	t.Fatalf("terminal output never contained result; got: %q", collected.String())
}
