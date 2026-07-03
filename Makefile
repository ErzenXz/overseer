# Overseer build glue.
#
#   make          build everything into ./overseer (UI embedded)
#   make ui       build the web UI and stage it for embedding
#   make go       build the Go binary only (uses last staged UI)
#   make test     run Go tests
#   make cross    cross-compile for all supported platforms into dist/

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PLATFORMS := darwin/amd64 darwin/arm64 linux/amd64 linux/arm64

.PHONY: all ui go test cross clean

all: ui go

ui:
	cd ui && npm install --no-audit --no-fund && npm run build
	rm -rf cmd/overseer/uidist
	cp -r ui/dist cmd/overseer/uidist
	touch cmd/overseer/uidist/.gitkeep   # keep the go:embed target non-empty for `go test` without a UI build

go:
	go build -ldflags '$(LDFLAGS)' -o overseer ./cmd/overseer

test:
	go vet ./...
	go test ./...

cross: ui
	@mkdir -p dist
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; \
		echo "building dist/overseer_$${os}_$${arch}"; \
		GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build -ldflags '$(LDFLAGS)' \
			-o dist/overseer_$${os}_$${arch} ./cmd/overseer || exit 1; \
	done

clean:
	rm -rf overseer dist ui/dist cmd/overseer/uidist
	mkdir -p cmd/overseer/uidist && touch cmd/overseer/uidist/.gitkeep
