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
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	RollbackVersion string `json:"rollbackVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	AutoUpdate      bool   `json:"autoUpdate"`
	Managed         bool   `json:"managed"`
	Checking        bool   `json:"checking"`
	Applying        bool   `json:"applying"`
	LastChecked     int64  `json:"lastChecked,omitempty"`
	Error           string `json:"error,omitempty"`
	FleetTotal      int    `json:"fleetTotal"`
	FleetOutdated   int    `json:"fleetOutdated"`
}

type updateManager struct {
	mu      sync.Mutex
	store   *Store
	version string
	repo    string
	status  updateStatus
	latest  updater.Release
	applied func()
}

func newUpdateManager(store *Store, version, repo string) *updateManager {
	auto := true
	if value, _ := store.Setting(autoUpdateSetting); value == "false" {
		auto = false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	rollbackVersion := updater.PreviousVersion(ctx)
	cancel()
	return &updateManager{
		store: store, version: version, repo: repo,
		status: updateStatus{
			CurrentVersion:  version,
			RollbackVersion: rollbackVersion,
			AutoUpdate:      auto,
			Managed:         os.Getenv("OVERSEER_MANAGED") != "",
		},
	}
}

func (m *updateManager) start(ctx context.Context, applied func()) {
	m.mu.Lock()
	m.applied = applied
	managed := m.status.Managed
	m.mu.Unlock()
	if !managed {
		return
	}
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
		return errors.New("automatic replacement requires an installed background service; use `overseer update` for this standalone binary")
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
		return errors.New("rollback requires an installed background service; use `overseer rollback` for this standalone binary")
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
