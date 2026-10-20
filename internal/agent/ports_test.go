package agent

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const procNetTCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41234 1 0000000000000000 100 0 0 10 0
   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41235 1 0000000000000000 100 0 0 10 0
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 900 1 0000000000000000 100 0 0 10 0
   3: 0A01A8C0:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41236 1 0000000000000000 100 0 0 10 0
   4: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 41237 1 0000000000000000 20 4 30 10 -1
`

const procNetTCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:1F41 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 51234 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 51235 1 0000000000000000 100 0 0 10 0
`

func TestParseProcNetTCP(t *testing.T) {
	v4 := parseProcNetTCP(strings.NewReader(procNetTCP), false)
	want4 := []listener{
		{addr: "127.0.0.1", port: 5173, inode: 41234},
		{addr: "0.0.0.0", port: 3000, inode: 41235},
		{addr: "0.0.0.0", port: 22, inode: 900},
		{addr: "192.168.1.10", port: 8080, inode: 41236},
	}
	if fmt.Sprint(v4) != fmt.Sprint(want4) {
		t.Errorf("tcp:\n got %v\nwant %v", v4, want4)
	}
	v6 := parseProcNetTCP(strings.NewReader(procNetTCP6), true)
	want6 := []listener{
		{addr: "::1", port: 8001, inode: 51234},
		{addr: "::", port: 3000, inode: 51235},
	}
	if fmt.Sprint(v6) != fmt.Sprint(want6) {
		t.Errorf("tcp6:\n got %v\nwant %v", v6, want6)
	}
}

const lsofListen = `p642
crapportd
f11
tIPv4
n*:49152
TST=LISTEN
TQR=0
TQS=0
f13
tIPv6
n*:49152
TST=LISTEN
p34553
cnode
f17
tIPv6
n[::1]:5173
TST=LISTEN
p73720
cnode
f18
tIPv4
n127.0.0.1:3001
TST=LISTEN
f19
tIPv6
n*:3001
TST=LISTEN
p866
cLM Studio
f32
tIPv4
n127.0.0.1:49158
`

func TestParseLsof(t *testing.T) {
	got := parseLsof(lsofListen)
	want := []listener{
		{addr: "0.0.0.0", port: 49152, pid: 642, process: "rapportd"},
		{addr: "::", port: 49152, pid: 642, process: "rapportd"},
		{addr: "::1", port: 5173, pid: 34553, process: "node"},
		{addr: "127.0.0.1", port: 3001, pid: 73720, process: "node"},
		{addr: "::", port: 3001, pid: 73720, process: "node"},
		{addr: "127.0.0.1", port: 49158, pid: 866, process: "LM Studio"},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("\n got %v\nwant %v", got, want)
	}

	cwd := parseLsofCwd("p34553\nfcwd\nn/Users/me/site\np73720\nfcwd\nn/Users/me/my app\n")
	if cwd[34553] != "/Users/me/site" || cwd[73720] != "/Users/me/my app" {
		t.Errorf("cwd = %v", cwd)
	}
	cmds := parsePsCommands("34553 node /x/vite --port 5173\n  866 /Applications/LM Studio.app/LM Studio\n")
	if cmds[34553] != "node /x/vite --port 5173" || cmds[866] != "/Applications/LM Studio.app/LM Studio" {
		t.Errorf("commands = %v", cmds)
	}
}

func TestGroupListeners(t *testing.T) {
	raw := []listener{
		{addr: "::", port: 3001, pid: 10, process: "node"},
		{addr: "127.0.0.1", port: 3001, pid: 10, process: "node"},
		{addr: "::1", port: 5173, pid: 11, process: "node"},
		{addr: "0.0.0.0", port: 49152, pid: 642, process: "rapportd"}, // system service
		{addr: "0.0.0.0", port: 7000, pid: 645, process: "ControlCenter"},
		{addr: "0.0.0.0", port: 22, process: "sshd"},           // privileged
		{addr: "0.0.0.0", port: 443},                           // privileged
		{addr: "0.0.0.0", port: 80, pid: 12, process: "nginx"}, // 80 is allowed
		{addr: "192.168.1.10", port: 8080, pid: 13},            // not reachable via loopback
		{addr: "127.0.0.1", port: 9999, pid: 99, process: "overseer"},
		{addr: "127.0.0.1", port: 5900, pid: 14, process: "screensharingd"}, // VNC
		{addr: "127.0.0.1", port: 8000, pid: 15, process: "systemd-resolved"},
	}
	got, v4 := groupListeners(raw, 99)
	var ports []string
	for _, l := range got {
		ports = append(ports, fmt.Sprintf("%d@%s", l.port, l.addr))
	}
	if want := "80@0.0.0.0 3001@127.0.0.1 5173@::1"; strings.Join(ports, " ") != want {
		t.Errorf("ports = %v, want %s", ports, want)
	}
	if !v4[3001] || v4[5173] {
		t.Errorf("v4 = %v", v4)
	}
}

func TestExtractTitle(t *testing.T) {
	cases := map[string]string{
		`<html><head><TITLE>  School
		  website </TITLE></head>`: "School website",
		`<title data-x="1">Tom &amp; Jerry</title>`: "Tom & Jerry",
		`<p>no title</p>`: "",
		`<title>` + strings.Repeat("é", 200) + `</title>`: strings.Repeat("é", 120),
	}
	for in, want := range cases {
		if got := extractTitle([]byte(in)); got != want {
			t.Errorf("extractTitle(%.30q) = %q, want %q", in, got, want)
		}
	}
}

func TestProbeHTTP(t *testing.T) {
	var host string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host = r.Host
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<title>Hello preview</title>")
	}))
	defer srv.Close()
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	ok, title := probeHTTP(context.Background(), "127.0.0.1", port)
	if !ok || title != "Hello preview" {
		t.Errorf("probe = %v %q", ok, title)
	}
	if host != fmt.Sprintf("localhost:%d", port) {
		t.Errorf("probe Host = %q", host)
	}

	// A TCP server that isn't HTTP.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Write([]byte("SSH-2.0-OpenSSH\r\n"))
			c.Close()
		}
	}()
	if ok, _ := probeHTTP(context.Background(), "127.0.0.1", ln.Addr().(*net.TCPAddr).Port); ok {
		t.Error("non-HTTP server reported as http")
	}
}
