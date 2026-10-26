//go:build windows

package top

import (
	"context"
	"os"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/term"
)

// watchResize polls the console size: Windows has no SIGWINCH.
func watchResize(ctx context.Context, out *os.File, ch chan<- struct{}) {
	w, h, _ := term.GetSize(int(out.Fd()))
	go func() {
		t := time.NewTicker(250 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				nw, nh, err := term.GetSize(int(out.Fd()))
				if err == nil && (nw != w || nh != h) {
					w, h = nw, nh
					select {
					case ch <- struct{}{}:
					default:
					}
				}
			}
		}
	}()
}

// prepareOutput turns on ANSI escape processing for the console and
// returns a function that restores the previous mode.
func prepareOutput(out *os.File) func() {
	h := windows.Handle(out.Fd())
	var mode uint32
	if windows.GetConsoleMode(h, &mode) != nil {
		return func() {}
	}
	windows.SetConsoleMode(h, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
	return func() { windows.SetConsoleMode(h, mode) }
}
