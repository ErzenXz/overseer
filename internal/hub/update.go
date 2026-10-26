package hub

import (
	"context"
	"errors"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/updater"
)

const autoUpdateSetting = "auto_updates"

type updateStatus struct {
	CurrentVersion  string      `json:"currentVersion"`
	LatestVersion   string      `json:"latestVersion,omitempty"`
	RollbackVersion string      `json:"rollbackVersion,omitempty"`
	UpdateAvailable bool        `json:"updateAvailable"`
	AutoUpdate      bool        `json:"autoUpdate"`
	Managed         bool        `json:"managed"`
	Checking        bool        `json:"checking"`
	Applying        bool        `json:"applying"`
	LastChecked     int64       `json:"lastChecked,omitempty"`
	Error           string      `json:"error,omitempty"`
	FleetTotal      int         `json:"fleetTotal"`
	FleetOutdated   int         `json:"fleetOutdated"`
	Service         serviceInfo `json:"service"`
}

type updateManager struct {
	mu      sync.Mutex
	store   *Store
	version string
	repo    string
	status  updateStatus
	latest  updater.Release
	applied func()

	// Release notes for the newest release, fetched once per tag and cached;
	// failures are retried after notesRetry. notesMu is held while fetching so
	// concurrent page loads share one request.
	notesMu    sync.Mutex
	notesTag   string
	notesList  []updater.Entry
	notesFail  time.Time // when the last fetch for failedTag failed
	failedTag  string
	fetchNotes func(ctx context.Context, repo, tag string) ([]updater.Entry, error)
}

const notesRetry = 5 * time.Minute

// updateNotes is the "what's new" payload: notes for every release newer than
// the running one, and the running release's own notes.
type updateNotes struct {
	CurrentVersion string          `json:"currentVersion"`
	LatestVersion  string          `json:"latestVersion,omitempty"`
	Newer          []updater.Entry `json:"newer"`
	Current        *updater.Entry  `json:"current"`
}

func newUpdateManager(store *Store, version, repo string) *updateManager {
	auto := true
	if value, _ := store.Setting(autoUpdateSetting); value == "false" {
		auto = false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	rollbackVersion := updater.PreviousVersion(ctx)
	cancel()
	managed := os.Getenv("OVERSEER_MANAGED") != ""
	return &updateManager{
		store: store, version: version, repo: repo,
		fetchNotes: updater.Changelog,
		status: updateStatus{
			CurrentVersion:  version,
			RollbackVersion: rollbackVersion,
			AutoUpdate:      auto,
			Managed:         managed,
			Service:         diagnoseService(managed),
		},
	}
}

func (m *updateManager) start(ctx context.Context, applied func()) {
	m.mu.Lock()
	m.applied = applied
	m.mu.Unlock()
	// Unmanaged hubs check too (they just never install on their own), so the
	// UI can tell people an update exists.
	go func() {
		// Give the listeners time to come up before the first network check.
		timer := time.NewTimer(15 * time.Second)
		defer timer.Stop()
		select {
		case <-timer.C:
			_ = m.check(ctx, true)
		case <-ctx.Done():
			return
		}
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = m.check(ctx, true)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (m *updateManager) snapshot() updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *updateManager) setAuto(enabled bool) error {
	value := "false"
	if enabled {
		value = "true"
	}
	if err := m.store.SetSetting(autoUpdateSetting, value); err != nil {
		return err
	}
	m.mu.Lock()
	m.status.AutoUpdate = enabled
	m.mu.Unlock()
	return nil
}

func (m *updateManager) check(ctx context.Context, applyAutomatically bool) error {
	m.mu.Lock()
	if m.status.Checking || m.status.Applying {
		m.mu.Unlock()
		return errors.New("an update operation is already running")
	}
	m.status.Checking = true
	m.status.Error = ""
	m.mu.Unlock()

	release, err := updater.Latest(ctx, m.repo, runtime.GOOS, runtime.GOARCH)
	m.mu.Lock()
	m.status.Checking = false
	m.status.LastChecked = time.Now().Unix()
	if err != nil {
		m.status.Error = err.Error()
		m.mu.Unlock()
		return err
	}
	m.latest = release
	m.status.LatestVersion = release.Version
	m.status.UpdateAvailable = updater.IsNewer(release.Version, m.version)
	shouldApply := applyAutomatically && m.status.Managed && m.status.AutoUpdate && m.status.UpdateAvailable
	m.mu.Unlock()

	// Warm the notes cache so opening "What's new" costs no request.
	go m.notes(context.WithoutCancel(ctx))

	if shouldApply {
		return m.install(ctx)
	}
	return nil
}

func (m *updateManager) install(ctx context.Context) error {
	m.mu.Lock()
	if m.status.Applying {
		m.mu.Unlock()
		return errors.New("an update is already being installed")
	}
	if !m.status.Managed {
		m.mu.Unlock()
		return errors.New("this hub isn't configured for managed updates; see Settings → General, or run `overseer update` and restart it")
	}
	release := m.latest
	m.status.Applying = true
	m.status.Error = ""
	m.mu.Unlock()

	if release.Version == "" {
		if err := m.checkLatestForInstall(ctx); err != nil {
			m.finishApply(err)
			return err
		}
		m.mu.Lock()
		release = m.latest
		m.mu.Unlock()
	}
	if !updater.IsNewer(release.Version, m.version) {
		err := errors.New("the hub is already on the latest stable release")
		m.finishApply(err)
		return err
	}
	err := updater.Install(ctx, release, os.Getenv("OVERSEER_WINDOWS_TASK"))
	if err != nil {
		m.finishApply(err)
		return err
	}
	m.mu.Lock()
	m.status.RollbackVersion = m.version
	callback := m.applied
	m.mu.Unlock()
	if callback != nil {
		callback()
	}
	return nil
}

func (m *updateManager) checkLatestForInstall(ctx context.Context) error {
	release, err := updater.Latest(ctx, m.repo, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.latest = release
	m.status.LatestVersion = release.Version
	m.status.LastChecked = time.Now().Unix()
	m.status.UpdateAvailable = updater.IsNewer(release.Version, m.version)
	m.mu.Unlock()
	return nil
}

func (m *updateManager) rollback() error {
	m.mu.Lock()
	if m.status.Applying {
		m.mu.Unlock()
		return errors.New("an update operation is already running")
	}
	if !m.status.Managed {
		m.mu.Unlock()
		return errors.New("this hub isn't configured for managed updates; run `overseer rollback` and restart it")
	}
	m.status.Applying = true
	m.status.Error = ""
	m.mu.Unlock()

	if err := updater.Rollback(os.Getenv("OVERSEER_WINDOWS_TASK")); err != nil {
		m.finishApply(err)
		return err
	}
	m.mu.Lock()
	m.status.RollbackVersion = m.version
	callback := m.applied
	m.mu.Unlock()
	if callback != nil {
		callback()
	}
	return nil
}

func (m *updateManager) finishApply(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status.Applying = false
	if err != nil {
		m.status.Error = err.Error()
	}
}

// notes returns the cached release notes, fetching them when the newest known
// release changed. Dev and source builds (no stable version) get none.
func (m *updateManager) notes(ctx context.Context) updateNotes {
	m.mu.Lock()
	tag := m.status.LatestVersion
	m.mu.Unlock()
	if tag == "" {
		tag = m.version // no check yet: at least the running release's notes
	}
	out := updateNotes{CurrentVersion: m.version, LatestVersion: tag, Newer: []updater.Entry{}}
	if !updater.IsStable(m.version) || !updater.IsStable(tag) {
		return out
	}

	m.notesMu.Lock()
	recentlyFailed := m.failedTag == tag && time.Since(m.notesFail) < notesRetry
	if m.notesTag != tag && !recentlyFailed {
		entries, err := m.fetchNotes(ctx, m.repo, tag)
		if err != nil {
			m.notesList, m.notesTag = nil, ""
			m.failedTag, m.notesFail = tag, time.Now()
		} else {
			m.notesList, m.notesTag, m.failedTag = entries, tag, ""
		}
	}
	entries := m.notesList
	m.notesMu.Unlock()

	for i := range entries {
		switch {
		case entries[i].Version == m.version:
			e := entries[i]
			out.Current = &e
		case updater.IsNewer(entries[i].Version, m.version):
			out.Newer = append(out.Newer, entries[i])
		}
	}
	return out
}
