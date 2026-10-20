package agent

import (
	"fmt"
	"net"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// tcpStream bridges one hub channel to a local TCP connection (used for the
// VNC desktop tunnel). Only loopback targets are allowed, so the tunnel can't
// be used to reach other hosts on the device's network.
type tcpStream struct {
	channel uint32
	queue   chan []byte // hub -> TCP, drained by one writer goroutine
	once    sync.Once
	done    chan struct{}

	mu   sync.Mutex
	conn net.Conn
}

func (t *tcpStream) write(p []byte) {
	buf := make([]byte, len(p))
	copy(buf, p)
	select {
	case t.queue <- buf:
	case <-t.done:
	}
}

func (t *tcpStream) close() {
	t.once.Do(func() {
		close(t.done)
		t.mu.Lock()
		if t.conn != nil {
			t.conn.Close()
		}
		t.mu.Unlock()
	})
}

func (a *Agent) tcpOpen(channel uint32, req protocol.TcpOpen) {
	fail := func(err error) {
		a.send(protocol.Msg{Type: protocol.TypeTcpClose, Channel: channel, Error: err.Error()})
	}
	if req.Host != "127.0.0.1" && req.Host != "localhost" && req.Host != "::1" {
		fail(fmt.Errorf("only loopback addresses can be tunnelled"))
		return
	}
	if req.Port < 1 || req.Port > 65535 {
		fail(fmt.Errorf("invalid port %d", req.Port))
		return
	}
	a.mu.Lock()
	if _, busy := a.tcps[channel]; busy {
		a.mu.Unlock()
		fail(fmt.Errorf("channel %d already open", channel))
		return
	}
	t := &tcpStream{channel: channel, queue: make(chan []byte, 256), done: make(chan struct{})}
	a.tcps[channel] = t
	a.mu.Unlock()

	// Register before dialing so frames that race the dial are queued.
	go func() {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(req.Host, strconv.Itoa(req.Port)), 5*time.Second)
		if err != nil {
			a.tcpDrop(channel)
			t.close()
			fail(err)
			return
		}
		t.mu.Lock()
		select {
		case <-t.done: // closed while dialing
			t.mu.Unlock()
			conn.Close()
			return
		default:
		}
		t.conn = conn
		t.mu.Unlock()
		a.send(protocol.Msg{Type: protocol.TypeTcpOpened, Channel: channel})

		go func() { // hub -> TCP
			for {
				select {
				case p := <-t.queue:
					if _, err := conn.Write(p); err != nil {
						t.close()
						return
					}
				case <-t.done:
					return
				}
			}
		}()
		buf := make([]byte, 32*1024) // TCP -> hub
		for {
			n, err := conn.Read(buf)
			if n > 0 {
				if werr := a.sendBinary(channel, buf[:n]); werr != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		closedByHub := false
		select {
		case <-t.done:
			closedByHub = true
		default:
		}
		t.close()
		a.tcpDrop(channel)
		if !closedByHub {
			a.send(protocol.Msg{Type: protocol.TypeTcpClose, Channel: channel})
		}
	}()
}

func (a *Agent) tcpDrop(channel uint32) {
	a.mu.Lock()
	delete(a.tcps, channel)
	a.mu.Unlock()
}

func (a *Agent) tcpClose(channel uint32) {
	a.mu.Lock()
	t := a.tcps[channel]
	delete(a.tcps, channel)
	a.mu.Unlock()
	if t != nil {
		t.close()
	}
}

// vncPorts are the conventional VNC displays :0 to :3.
var vncPorts = []int{5900, 5901, 5902, 5903}

func probeDesktop() protocol.DesktopProbeResult {
	for _, port := range vncPorts {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return protocol.DesktopProbeResult{Available: true, Port: port}
		}
	}
	reason := "Install a VNC server such as TightVNC"
	switch runtime.GOOS {
	case "darwin":
		reason = "Turn on Screen Sharing in System Settings → General → Sharing"
	case "linux", "freebsd", "openbsd", "netbsd":
		reason = "Install and start a VNC server, e.g. x11vnc -localhost -forever or wayvnc"
	}
	return protocol.DesktopProbeResult{Available: false, Port: vncPorts[0], Reason: reason}
}
