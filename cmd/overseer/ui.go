package main

import (
	"embed"
	"io/fs"
)

// The UI build (ui/dist) is copied into cmd/overseer/uidist by `make ui`.
// An empty placeholder keeps `go build` working before the first UI build.
//
//go:embed all:uidist
var uiEmbed embed.FS

// uiFS returns the embedded web UI, or nil when only the placeholder exists.
func uiFS() fs.FS {
	sub, err := fs.Sub(uiEmbed, "uidist")
	if err != nil {
		return nil
	}
	if _, err := sub.Open("index.html"); err != nil {
		return nil
	}
	return sub
}
