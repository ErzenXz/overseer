package top

import (
	"fmt"
	"os/exec"
	"runtime"
)

// OpenBrowser opens an http(s) URL in the default browser. The URL is
// passed as a single argument, never through a shell.
func OpenBrowser(rawURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", rawURL)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL)
	default:
		cmd = exec.Command("xdg-open", rawURL)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not open a browser: %w", err)
	}
	go cmd.Wait()
	return nil
}
