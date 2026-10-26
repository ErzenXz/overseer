package top

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/fleet"
)

// Source is the slice of the hub API the view needs (*fleet.Client).
type Source interface {
	DevicesContext(ctx context.Context) ([]fleet.Device, error)
	Threads(ctx context.Context) ([]fleet.Thread, error)
	Thread(ctx context.Context, id string) (*fleet.Thread, []fleet.ThreadMessage, error)
	GitBranches(ctx context.Context, deviceId string, paths []string) (map[string]string, error)
}

// Fetcher builds snapshots from a Source. It remembers transcripts of
// finished sessions and git branches between refreshes, so a steady-state
// refresh is two list requests plus one transcript per active session.
type Fetcher struct {
	Src    Source
	HubURL string

	version  string
	mu       sync.Mutex
	cache    map[string]cachedMsgs
	branches map[string]branchEntry // key: device\x00cwd
	gitSkip  map[string]time.Time   // device -> don't ask again before
}

type cachedMsgs struct {
	updatedAt int64
	status    string
	msgs      []fleet.ThreadMessage
}

type branchEntry struct {
	branch string
	at     time.Time
}

const (
	maxActiveFetch   = 40 // transcripts fetched per refresh
	maxRecentFetch   = 12 // finished sessions that also get a transcript (for their last reply)
	recentWindowSecs = 6 * 3600
	maxKeepMessages  = 400
	branchTTL        = time.Minute
)

// NewFetcher returns a Fetcher for a hub.
func NewFetcher(src Source, hubURL string) *Fetcher {
	return &Fetcher{
		Src: src, HubURL: hubURL,
		cache: map[string]cachedMsgs{}, branches: map[string]branchEntry{}, gitSkip: map[string]time.Time{},
	}
}

// SetVersion records the hub version shown in the header.
func (f *Fetcher) SetVersion(v string) { f.version = v }

// toMillis normalises the hub's second-resolution thread stamps.
func toMillis(v int64) int64 {
	if v > 0 && v < 1e11 {
		return v * 1000
	}
	return v
}

// Fetch builds a snapshot. want names sessions whose transcript must be
// fresh (the one in the detail pane). On error the snapshot is zero and
// the caller keeps showing the last good one.
func (f *Fetcher) Fetch(ctx context.Context, want map[string]bool, now time.Time) (Snapshot, error) {
	var (
		devices    []fleet.Device
		threads    []fleet.Thread
		derr, terr error
		wg         sync.WaitGroup
	)
	wg.Add(2)
	go func() { defer wg.Done(); devices, derr = f.Src.DevicesContext(ctx) }()
	go func() { defer wg.Done(); threads, terr = f.Src.Threads(ctx) }()
	wg.Wait()
	if terr != nil {
		return Snapshot{}, terr
	}
	if derr != nil {
		return Snapshot{}, derr
	}

	rows := make([]Row, 0, len(threads))
	for _, t := range threads {
		if t.Archived {
			continue
		}
		t.CreatedAt, t.UpdatedAt = toMillis(t.CreatedAt), toMillis(t.UpdatedAt)
		rows = append(rows, Row{Thread: t, Kind: kindOf(t.Status)})
	}

	// Decide which transcripts to load.
	type job struct{ idx int }
	var jobs []job
	recent := 0
	nowMs := now.UnixMilli()
	for i := range rows {
		r := &rows[i]
		id := r.Thread.Id
		switch {
		case r.Active():
			if len(jobs) < maxActiveFetch || want[id] {
				jobs = append(jobs, job{i})
			}
		case want[id]:
			jobs = append(jobs, job{i})
		default:
			f.mu.Lock()
			c, ok := f.cache[id]
			f.mu.Unlock()
			if ok && c.updatedAt == r.Thread.UpdatedAt && c.status == r.Thread.Status {
				r.Msgs = c.msgs
				r.Act = deriveActivity(r.Thread, c.msgs)
				continue
			}
			if nowMs-r.Thread.UpdatedAt < recentWindowSecs*1000 && recent < maxRecentFetch {
				recent++
				jobs = append(jobs, job{i})
			}
		}
	}

	sem := make(chan struct{}, 6)
	var jwg sync.WaitGroup
	for _, j := range jobs {
		jwg.Add(1)
		go func(i int) {
			defer jwg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			r := &rows[i]
			_, msgs, err := f.Src.Thread(ctx, r.Thread.Id)
			if err != nil {
				return // keep the row without a transcript
			}
			if len(msgs) > maxKeepMessages {
				msgs = msgs[len(msgs)-maxKeepMessages:]
			}
			r.Msgs = msgs
			r.Act = deriveActivity(r.Thread, msgs)
			if !r.Active() {
				f.mu.Lock()
				f.cache[r.Thread.Id] = cachedMsgs{r.Thread.UpdatedAt, r.Thread.Status, msgs}
				f.mu.Unlock()
			}
		}(j.idx)
	}

	// Git branches for the folders on screen, in parallel with transcripts.
	branches := f.branchesFor(ctx, rows, devices, now)
	jwg.Wait()
	for i := range rows {
		rows[i].Branch = branches[rows[i].Thread.DeviceId+"\x00"+rows[i].Thread.Cwd]
	}
	sortRows(rows)

	machines := make([]Machine, 0, len(devices))
	byDevice := map[string]*Machine{}
	for _, d := range devices {
		machines = append(machines, Machine{Device: d})
	}
	for i := range machines {
		byDevice[machines[i].Device.Id] = &machines[i]
	}
	for _, r := range rows {
		if mc := byDevice[r.Thread.DeviceId]; mc != nil {
			mc.Total++
			switch r.Kind {
			case KindWaiting:
				mc.Waiting++
			case KindWorking:
				mc.Working++
			}
		}
	}
	f.prune(rows)
	return Snapshot{
		At: now, HubURL: f.HubURL, Hub: hubHost(f.HubURL), Version: f.version,
		Machines: machines, Rows: rows, Loaded: true,
	}, nil
}

// prune drops cache entries of sessions that no longer exist.
func (f *Fetcher) prune(rows []Row) {
	live := make(map[string]bool, len(rows))
	for _, r := range rows {
		live[r.Thread.Id] = true
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for id := range f.cache {
		if !live[id] {
			delete(f.cache, id)
		}
	}
}

// branchesFor returns device\x00cwd -> branch for the folders of the
// sessions, asking each online device at most once a minute.
func (f *Fetcher) branchesFor(ctx context.Context, rows []Row, devices []fleet.Device, now time.Time) map[string]string {
	online := map[string]bool{}
	for _, d := range devices {
		online[d.Id] = d.Online
	}
	stale := map[string][]string{} // device -> paths
	seen := map[string]bool{}
	f.mu.Lock()
	for i := range rows { // by index: transcripts are being written into the rows concurrently
		dev, cwd := rows[i].Thread.DeviceId, rows[i].Thread.Cwd
		key := dev + "\x00" + cwd
		if cwd == "" || seen[key] || !online[dev] {
			continue
		}
		seen[key] = true
		if until, skip := f.gitSkip[dev]; skip && now.Before(until) {
			continue
		}
		if e, ok := f.branches[key]; ok && now.Sub(e.at) < branchTTL {
			continue
		}
		if len(stale[dev]) < 32 {
			stale[dev] = append(stale[dev], cwd)
		}
	}
	f.mu.Unlock()

	var wg sync.WaitGroup
	for dev, paths := range stale {
		wg.Add(1)
		go func(dev string, paths []string) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			got, err := f.Src.GitBranches(cctx, dev, paths)
			f.mu.Lock()
			defer f.mu.Unlock()
			if err != nil {
				f.gitSkip[dev] = now.Add(5 * time.Minute) // old agent or busy machine: stop asking for a while
				return
			}
			for _, p := range paths {
				f.branches[dev+"\x00"+p] = branchEntry{got[p], now}
			}
		}(dev, paths)
	}
	wg.Wait()

	out := map[string]string{}
	f.mu.Lock()
	for key := range seen {
		if e, ok := f.branches[key]; ok {
			out[key] = e.branch
		}
	}
	f.mu.Unlock()
	return out
}

// OpenURL is the browser address of a session in the web UI.
func OpenURL(hubURL, threadID string) (string, bool) {
	u, err := url.Parse(hubURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	u.User = nil // never put credentials in a launched URL
	u.RawQuery, u.Fragment = "", ""
	u.Path = strings.TrimRight(u.Path, "/") + "/sessions/" + threadID
	return u.String(), true
}
