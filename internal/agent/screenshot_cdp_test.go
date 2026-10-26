package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A fake page that speaks just enough DevTools to check the phone flow: the
// device is emulated before the page loads, and the capture comes last.
func TestPhoneShotDrivesThePageInOrder(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	var navigated string
	var metrics map[string]any
	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		for {
			var m struct {
				Id     int64
				Method string
				Params map[string]any
			}
			if ws.ReadJSON(&m) != nil {
				return
			}
			mu.Lock()
			calls = append(calls, m.Method)
			mu.Unlock()
			result := map[string]any{}
			switch m.Method {
			case "Emulation.setDeviceMetricsOverride":
				metrics = m.Params
			case "Page.navigate":
				navigated, _ = m.Params["url"].(string)
			case "Page.captureScreenshot":
				result["data"] = base64.StdEncoding.EncodeToString([]byte("PNGDATA"))
			}
			b, _ := json.Marshal(map[string]any{"id": m.Id, "result": result})
			ws.WriteMessage(websocket.TextMessage, b)
			if m.Method == "Page.navigate" {
				ws.WriteMessage(websocket.TextMessage, []byte(`{"method":"Page.loadEventFired","params":{}}`))
			}
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	page, err := dialCDP(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"))
	if err != nil {
		t.Fatal(err)
	}
	defer page.close()
	data, err := phoneShot(ctx, page, "http://localhost:5173/", 390, 844, 10)
	if err != nil || string(data) != "PNGDATA" {
		t.Fatalf("data = %q err = %v", data, err)
	}
	mu.Lock()
	defer mu.Unlock()
	order := strings.Join(calls, " ")
	if !strings.HasPrefix(order, "Page.enable Emulation.setDeviceMetricsOverride") || !strings.HasSuffix(order, "Page.navigate Page.captureScreenshot") {
		t.Errorf("calls: %s", order)
	}
	if navigated != "http://localhost:5173/" || metrics["mobile"] != true || metrics["width"] != float64(390) || metrics["height"] != float64(844) {
		t.Errorf("navigated %q with %v", navigated, metrics)
	}
}
