package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"golang.org/x/term"

	"github.com/ErzenXz/overseer/internal/fleet"
	"github.com/ErzenXz/overseer/internal/top"
)

// colorWanted follows https://no-color.org and treats a dumb terminal as
// colourless.
func colorWanted(noColorFlag bool) bool {
	return !noColorFlag && os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb"
}

// termWidth is the width to lay a one-shot table out at: the terminal's
// when stdout is one, else $COLUMNS, else 120.
func termWidth(f *os.File) int {
	if w, _, err := term.GetSize(int(f.Fd())); err == nil && w > 0 {
		return w
	}
	if n, err := strconv.Atoi(os.Getenv("COLUMNS")); err == nil && n >= 40 {
		return n
	}
	return 120
}

// fetchSnapshot loads everything once.
func fetchSnapshot(c *fleet.Client) (top.Snapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := top.NewFetcher(c, c.HubURL)
	f.SetVersion(c.HubVersion(ctx))
	return f.Fetch(ctx, nil, time.Now())
}

// cmdTop is `overseer top`: a live full-screen view of every agent session
// and machine. Without a terminal it prints a plain table once.
func cmdTop(args []string) error {
	fs := flag.NewFlagSet("top", flag.ExitOnError)
	interval := fs.Duration("interval", 1500*time.Millisecond, "refresh interval")
	noColor := fs.Bool("no-color", false, "disable colours (also honours NO_COLOR)")
	plain := fs.Bool("plain", false, "print a plain table once and exit")
	fs.Parse(args)
	c, err := fleet.NewFromEnv()
	if err != nil {
		return err
	}
	interactive := term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd())) &&
		os.Getenv("TERM") != "dumb"
	if *plain || !interactive {
		snap, err := fetchSnapshot(c)
		if err != nil {
			return err
		}
		fmt.Print(top.PlainText(snap, termWidth(os.Stdout), time.Now()))
		return nil
	}
	if *interval < 500*time.Millisecond {
		*interval = 500 * time.Millisecond
	}
	err = top.Run(top.Options{
		Backend: c, HubURL: c.HubURL, Interval: *interval, Color: colorWanted(*noColor),
	})
	if errors.Is(err, top.ErrNotTerminal) {
		return nil
	}
	return err
}

// cmdStatus is `overseer status`: a one-shot summary of machines and the
// sessions that need you. Exit code 0 whenever the hub answered.
func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "machine-readable output")
	short := fs.Bool("short", false, "one line of counts, for shell prompts")
	noColor := fs.Bool("no-color", false, "disable colours (also honours NO_COLOR)")
	fs.Parse(args)
	c, err := fleet.NewFromEnv()
	if err != nil {
		return err
	}
	snap, err := fetchSnapshot(c)
	if err != nil {
		return err
	}
	now := time.Now()
	switch {
	case *asJSON:
		b, err := json.MarshalIndent(top.BuildStatus(snap, now), "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(b))
	case *short:
		fmt.Println(top.StatusShort(snap, now, colorWanted(*noColor) && term.IsTerminal(int(os.Stdout.Fd()))))
	default:
		color := colorWanted(*noColor) && term.IsTerminal(int(os.Stdout.Fd()))
		fmt.Print(top.StatusText(snap, now, termWidth(os.Stdout), color))
	}
	return nil
}
