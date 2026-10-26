package top

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"golang.org/x/term"
)

// Backend is the hub API `top` needs: reads plus the three actions.
type Backend interface {
	Source
	ThreadApproval(ctx context.Context, id, approvalId, optionId string) error
	ThreadPrompt(ctx context.Context, id, text string) error
	ThreadCancel(ctx context.Context, id string) error
}

// Options configure Run.
type Options struct {
	Backend  Backend
	HubURL   string
	Version  string
	Interval time.Duration
	Color    bool
	Open     func(url string) error // defaults to OpenBrowser
}

// ErrNotTerminal is returned by Run when stdin or stdout is not a terminal.
var ErrNotTerminal = errors.New("not a terminal")

type fetchResult struct {
	snap Snapshot
	err  error
}

type actionResult struct {
	msg string
	err error
}

const (
	termEnter = "\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h\x1b[2J"
	termLeave = "\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l"
)

// Run shows the live view until the user quits. The terminal is restored on
// every way out, including a panic.
func Run(opts Options) (err error) {
	in, out := os.Stdin, os.Stdout
	if !term.IsTerminal(int(in.Fd())) || !term.IsTerminal(int(out.Fd())) {
		return ErrNotTerminal
	}
	if opts.Interval <= 0 {
		opts.Interval = 1500 * time.Millisecond
	}
	if opts.Open == nil {
		opts.Open = OpenBrowser
	}
	w, h, serr := term.GetSize(int(out.Fd()))
	if serr != nil || w <= 0 || h <= 0 {
		w, h = 80, 24
	}

	restoreOut := prepareOutput(out)
	state, rerr := term.MakeRaw(int(in.Fd()))
	if rerr != nil {
		restoreOut()
		return fmt.Errorf("cannot switch the terminal to raw mode: %w", rerr)
	}
	fmt.Fprint(out, termEnter)
	restore := func() {
		fmt.Fprint(out, termLeave)
		term.Restore(int(in.Fd()), state)
		restoreOut()
	}
	defer func() {
		restore()
		if r := recover(); r != nil {
			err = fmt.Errorf("internal error: %v\n%s", r, debug.Stack())
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fetcher := NewFetcher(opts.Backend, opts.HubURL)
	model := NewModel(w, h, opts.Color)
	model.Snap = Snapshot{HubURL: opts.HubURL, Hub: hubHost(opts.HubURL)}

	keys := make(chan Key, 64)
	fatal := make(chan error, 1)
	go guard(fatal, func() { readKeys(in, keys, fatal) })

	resize := make(chan struct{}, 1)
	watchResize(ctx, out, resize)

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(sigs)

	results := make(chan fetchResult, 1)
	actions := make(chan actionResult, 4)
	inflight, again := false, false
	var lastFetch time.Time

	startFetch := func() {
		if inflight {
			again = true
			return
		}
		inflight, again = true, false
		lastFetch = time.Now()
		want := map[string]bool{}
		if model.Mode == ModeDetail || model.Overlay == OverlayApprove {
			want[model.SelID] = true
		}
		go guard(fatal, func() {
			fctx, fcancel := context.WithTimeout(ctx, 15*time.Second)
			defer fcancel()
			if fetcher.version == "" {
				fetcher.SetVersion(versionOf(fctx, opts.Backend))
			}
			s, ferr := fetcher.Fetch(fctx, want, time.Now())
			select {
			case results <- fetchResult{s, ferr}:
			case <-ctx.Done():
			}
		})
	}

	redraw := func() {
		model.Now = time.Now()
		fmt.Fprint(out, model.View())
	}

	do := func(a Action) bool {
		switch a.Kind {
		case ActQuit:
			return true
		case ActRefresh:
			startFetch()
		case ActOpen:
			if u, ok := OpenURL(opts.HubURL, a.ThreadID); !ok {
				model.Notice("cannot build a browser address from the hub URL", true)
			} else if oerr := opts.Open(u); oerr != nil {
				model.Notice(oerr.Error(), true)
			} else {
				model.Notice("opened “"+oneLine(a.Title)+"” in your browser", false)
			}
		case ActApprove, ActSteer, ActStop:
			go guard(fatal, func() {
				actx, acancel := context.WithTimeout(ctx, 30*time.Second)
				defer acancel()
				var aerr error
				var msg string
				switch a.Kind {
				case ActApprove:
					aerr = opts.Backend.ThreadApproval(actx, a.ThreadID, a.ApprovalID, a.OptionID)
					msg = "answered “" + oneLine(a.Title) + "”: " + oneLine(a.Label)
				case ActSteer:
					aerr = opts.Backend.ThreadPrompt(actx, a.ThreadID, a.Text)
					msg = "sent to “" + oneLine(a.Title) + "”"
				case ActStop:
					aerr = opts.Backend.ThreadCancel(actx, a.ThreadID)
					msg = "stopped “" + oneLine(a.Title) + "”"
				}
				select {
				case actions <- actionResult{msg, aerr}:
				case <-ctx.Done():
				}
			})
		}
		return false
	}

	startFetch()
	redraw()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()

	for {
		select {
		case k := <-keys:
			if do(model.HandleKey(k)) {
				return nil
			}
			// Drain a burst of keys (a paste) before repainting.
		drain:
			for {
				select {
				case k := <-keys:
					if do(model.HandleKey(k)) {
						return nil
					}
				default:
					break drain
				}
			}
			redraw()
		case r := <-results:
			inflight = false
			if r.err != nil {
				model.Snap.Err = r.err.Error()
			} else {
				model.SetSnapshot(r.snap)
			}
			if again {
				startFetch()
			}
			redraw()
		case a := <-actions:
			if a.err != nil {
				model.Notice(a.err.Error(), true)
			} else {
				model.Notice(a.msg, false)
			}
			startFetch()
			redraw()
		case <-resize:
			if nw, nh, e := term.GetSize(int(out.Fd())); e == nil && nw > 0 && nh > 0 {
				model.Resize(nw, nh)
			}
			fmt.Fprint(out, "\x1b[2J")
			redraw()
		case <-sigs:
			return nil
		case e := <-fatal:
			return e
		case <-tick.C:
			if !inflight && time.Since(lastFetch) >= opts.Interval {
				startFetch()
			}
			redraw()
		}
	}
}

func versionOf(ctx context.Context, b Backend) string {
	if v, ok := b.(interface {
		HubVersion(context.Context) string
	}); ok {
		return v.HubVersion(ctx)
	}
	return ""
}

// guard runs f and reports a panic on fatal so Run can restore the
// terminal before the process dies.
func guard(fatal chan<- error, f func()) {
	defer func() {
		if r := recover(); r != nil {
			select {
			case fatal <- fmt.Errorf("internal error: %v\n%s", r, debug.Stack()):
			default:
			}
		}
	}()
	f()
}

// readKeys decodes stdin into keys until it closes.
func readKeys(in *os.File, keys chan<- Key, fatal chan<- error) {
	buf := make([]byte, 256)
	var pending []byte
	for {
		n, err := in.Read(buf)
		if n > 0 {
			pending = append(pending, buf[:n]...)
			var ks []Key
			ks, pending = ParseKeys(pending)
			for _, k := range ks {
				keys <- k
			}
		}
		if err != nil {
			select {
			case fatal <- nil: // stdin closed: leave quietly
			default:
			}
			return
		}
	}
}
