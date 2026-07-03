// Command overseer is the single binary behind Overseer: hub server, device
// agent, fleet CLI, and MCP server.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/overseer-sh/overseer/internal/agent"
	"github.com/overseer-sh/overseer/internal/fleet"
	"github.com/overseer-sh/overseer/internal/hub"
	"github.com/overseer-sh/overseer/internal/mcp"
)

var version = "0.1.0-dev" // overridden at release time via -ldflags

const usage = `Overseer — control all your machines from one place.

Usage:
  overseer serve [--addr :4200] [--data-dir ~/.overseer]   Run the hub (web UI + API)
  overseer agent enroll --hub URL --token TOKEN            Enroll this device with a hub
  overseer agent run                                       Run the device agent (foreground)
  overseer agent install-service                           Install + start the agent as a service
  overseer fleet login --hub URL --token API_TOKEN         Save fleet CLI credentials
  overseer fleet devices                                   List devices
  overseer fleet sessions [device]                         List sessions (fleet-wide or one device)
  overseer fleet new DEVICE NAME [--cwd DIR] [--cmd CMD]   Create a session
  overseer fleet run DEVICE -- CMD...                      Run a command and print output
  overseer fleet send DEVICE SESSION TEXT                  Type into a session (presses Enter)
  overseer fleet read DEVICE SESSION [--lines N]           Read a session's recent output
  overseer fleet kill DEVICE SESSION                       Kill a session
  overseer mcp                                             Run the MCP server (stdio) for coding agents
  overseer version                                         Print version
`

func main() {
	log.SetFlags(log.Ltime)
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = cmdServe(os.Args[2:])
	case "agent":
		err = cmdAgent(os.Args[2:])
	case "fleet":
		err = cmdFleet(os.Args[2:])
	case "mcp":
		err = cmdMCP()
	case "version", "--version", "-v":
		fmt.Println("overseer", version)
	case "help", "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "overseer: unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "overseer:", err)
		os.Exit(1)
	}
}

func signalContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		cancel()
	}()
	return ctx
}

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", ":4200", "listen address")
	dataDir := fs.String("data-dir", "", "data directory (default ~/.overseer)")
	fs.Parse(args)

	srv, err := hub.NewServer(hub.Options{
		Addr:    *addr,
		DataDir: *dataDir,
		Version: version,
		UI:      uiFS(),
	})
	if err != nil {
		return err
	}
	return srv.Run(signalContext())
}

func cmdAgent(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: overseer agent <enroll|run|install-service>")
	}
	switch args[0] {
	case "enroll":
		fs := flag.NewFlagSet("enroll", flag.ExitOnError)
		hubURL := fs.String("hub", "", "hub URL, e.g. http://192.168.1.10:4200")
		token := fs.String("token", "", "enrollment token from the hub UI")
		fs.Parse(args[1:])
		if *hubURL == "" || *token == "" {
			return fmt.Errorf("both --hub and --token are required")
		}
		cfg, err := agent.Enroll(*hubURL, *token)
		if err != nil {
			return err
		}
		fmt.Printf("enrolled as device %s with hub %s\n", cfg.DeviceId, cfg.HubURL)
		return nil
	case "run":
		cfg, err := agent.LoadConfig()
		if err != nil {
			return err
		}
		return agent.New(cfg, version).Run(signalContext())
	case "install-service":
		if _, err := agent.LoadConfig(); err != nil {
			return err
		}
		if err := agent.InstallService(); err != nil {
			return err
		}
		fmt.Println("agent service installed and started")
		return nil
	default:
		return fmt.Errorf("unknown agent subcommand %q", args[0])
	}
}

func cmdMCP() error {
	client, err := fleet.NewFromEnv()
	if err != nil {
		return err
	}
	return mcp.Serve(client, version)
}

func cmdFleet(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: overseer fleet <login|devices|sessions|new|run|send|read|kill>")
	}
	sub, rest := args[0], args[1:]

	if sub == "login" {
		fs := flag.NewFlagSet("login", flag.ExitOnError)
		hubURL := fs.String("hub", "", "hub URL")
		token := fs.String("token", "", "API token (create one in the UI under Settings)")
		fs.Parse(rest)
		if *hubURL == "" || *token == "" {
			return fmt.Errorf("both --hub and --token are required")
		}
		client := fleet.New(*hubURL, *token)
		if _, err := client.Devices(); err != nil {
			return fmt.Errorf("could not talk to hub: %w", err)
		}
		if err := fleet.SaveConfig(fleet.ClientConfig{HubURL: *hubURL, Token: *token}); err != nil {
			return err
		}
		fmt.Println("fleet credentials saved")
		return nil
	}

	client, err := fleet.NewFromEnv()
	if err != nil {
		return err
	}

	switch sub {
	case "devices":
		devices, err := client.Devices()
		if err != nil {
			return err
		}
		tw := tabwriter.NewWriter(os.Stdout, 2, 4, 2, ' ', 0)
		fmt.Fprintln(tw, "NAME\tID\tOS/ARCH\tSTATUS\tLAST SEEN")
		for _, d := range devices {
			status := "offline"
			if d.Online {
				status = "online"
			}
			if d.IsHub {
				status += " (hub)"
			}
			lastSeen := "-"
			if d.LastSeen > 0 {
				lastSeen = time.Unix(d.LastSeen, 0).Format("Jan 2 15:04")
			}
			fmt.Fprintf(tw, "%s\t%s\t%s/%s\t%s\t%s\n", d.Name, d.Id, d.OS, d.Arch, status, lastSeen)
		}
		return tw.Flush()

	case "sessions":
		var sessions []fleet.Session
		if len(rest) > 0 {
			d, err := client.ResolveDevice(rest[0])
			if err != nil {
				return err
			}
			sessions, err = client.Sessions(d.Id)
			if err != nil {
				return err
			}
			for i := range sessions {
				sessions[i].DeviceName = d.Name
			}
		} else {
			sessions, err = client.FleetSessions()
			if err != nil {
				return err
			}
		}
		tw := tabwriter.NewWriter(os.Stdout, 2, 4, 2, ' ', 0)
		fmt.Fprintln(tw, "SESSION\tDEVICE\tKIND\tSTATUS")
		for _, s := range sessions {
			kind := s.Kind
			if kind == "" {
				kind = "terminal"
			}
			fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", s.Name, s.DeviceName, kind, s.Status)
		}
		return tw.Flush()

	case "new":
		fs := flag.NewFlagSet("new", flag.ExitOnError)
		cwd := fs.String("cwd", "", "working directory")
		cmd := fs.String("cmd", "", "command to run in the session")
		kind := fs.String("kind", "", "label, e.g. claude")
		if len(rest) < 2 {
			return fmt.Errorf("usage: overseer fleet new DEVICE NAME [--cwd DIR] [--cmd CMD]")
		}
		fs.Parse(rest[2:])
		d, err := client.ResolveDevice(rest[0])
		if err != nil {
			return err
		}
		if err := client.CreateSession(d.Id, rest[1], *cwd, *cmd, *kind); err != nil {
			return err
		}
		fmt.Printf("session %q created on %s\n", rest[1], d.Name)
		return nil

	case "run":
		if len(rest) < 2 {
			return fmt.Errorf("usage: overseer fleet run DEVICE -- CMD...")
		}
		d, err := client.ResolveDevice(rest[0])
		if err != nil {
			return err
		}
		cmdArgs := rest[1:]
		if cmdArgs[0] == "--" {
			cmdArgs = cmdArgs[1:]
		}
		command := ""
		for i, a := range cmdArgs {
			if i > 0 {
				command += " "
			}
			command += a
		}
		res, err := client.Run(d.Id, command, "", 0)
		if err != nil {
			return err
		}
		fmt.Print(res.Stdout)
		fmt.Fprint(os.Stderr, res.Stderr)
		if res.ExitCode != 0 {
			os.Exit(res.ExitCode)
		}
		return nil

	case "send":
		if len(rest) < 3 {
			return fmt.Errorf("usage: overseer fleet send DEVICE SESSION TEXT")
		}
		d, err := client.ResolveDevice(rest[0])
		if err != nil {
			return err
		}
		return client.SendInput(d.Id, rest[1], rest[2], true)

	case "read":
		fs := flag.NewFlagSet("read", flag.ExitOnError)
		lines := fs.Int("lines", 200, "lines of scrollback")
		if len(rest) < 2 {
			return fmt.Errorf("usage: overseer fleet read DEVICE SESSION [--lines N]")
		}
		fs.Parse(rest[2:])
		d, err := client.ResolveDevice(rest[0])
		if err != nil {
			return err
		}
		out, err := client.ReadOutput(d.Id, rest[1], *lines)
		if err != nil {
			return err
		}
		fmt.Print(out)
		return nil

	case "kill":
		if len(rest) < 2 {
			return fmt.Errorf("usage: overseer fleet kill DEVICE SESSION")
		}
		d, err := client.ResolveDevice(rest[0])
		if err != nil {
			return err
		}
		return client.KillSession(d.Id, rest[1])

	default:
		return fmt.Errorf("unknown fleet subcommand %q", sub)
	}
}
