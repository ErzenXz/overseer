//go:build !windows

package top

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

// watchResize signals ch whenever the terminal changes size (SIGWINCH).
func watchResize(ctx context.Context, _ *os.File, ch chan<- struct{}) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGWINCH)
	go func() {
		defer signal.Stop(sig)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sig:
				select {
				case ch <- struct{}{}:
				default:
				}
			}
		}
	}()
}

// prepareOutput is a no-op where terminals speak ANSI natively.
func prepareOutput(*os.File) func() { return func() {} }
