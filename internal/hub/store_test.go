package hub

import (
	"path/filepath"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestDeviceLifecycle(t *testing.T) {
	s := testStore(t)
	id, token, err := s.CreateDevice("laptop", "laptop.local", "linux", "amd64", false)
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.DeviceByToken(token)
	if err != nil || d == nil {
		t.Fatalf("DeviceByToken: %v, %v", d, err)
	}
	if d.Id != id || d.Name != "laptop" {
		t.Errorf("got %+v", d)
	}
	if d2, _ := s.DeviceByToken("wrong-token"); d2 != nil {
		t.Error("wrong token should not authenticate")
	}
	if err := s.DeleteDevice(id); err != nil {
		t.Fatal(err)
	}
	if d3, _ := s.DeviceByToken(token); d3 != nil {
		t.Error("deleted device should not authenticate")
	}
}

func TestEnrollTokenSingleUse(t *testing.T) {
	s := testStore(t)
	token, err := s.CreateEnrollToken(time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.ConsumeEnrollToken(token); !ok {
		t.Fatal("first use should succeed")
	}
	if ok, _ := s.ConsumeEnrollToken(token); ok {
		t.Fatal("second use must fail")
	}
	if ok, _ := s.ConsumeEnrollToken("bogus"); ok {
		t.Fatal("bogus token must fail")
	}
}

func TestEnrollTokenExpiry(t *testing.T) {
	s := testStore(t)
	token, err := s.CreateEnrollToken(-time.Second) // already expired
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.ConsumeEnrollToken(token); ok {
		t.Fatal("expired token must fail")
	}
}

func TestPasswordHashing(t *testing.T) {
	h := hashPassword("hunter22-secure")
	if !verifyPassword(h, "hunter22-secure") {
		t.Error("correct password rejected")
	}
	if verifyPassword(h, "wrong") {
		t.Error("wrong password accepted")
	}
	if verifyPassword("garbage", "hunter22-secure") {
		t.Error("garbage hash accepted")
	}
}

func TestApiTokens(t *testing.T) {
	s := testStore(t)
	token, err := s.CreateApiToken("ci")
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.ValidApiToken(token); !ok {
		t.Error("fresh token should validate")
	}
	tokens, _ := s.ListApiTokens()
	if len(tokens) != 1 {
		t.Fatalf("got %d tokens", len(tokens))
	}
	s.DeleteApiToken(tokens[0].Id)
	if ok, _ := s.ValidApiToken(token); ok {
		t.Error("revoked token should fail")
	}
}

func TestPresetsSeeded(t *testing.T) {
	s := testStore(t)
	presets, err := s.ListPresets()
	if err != nil {
		t.Fatal(err)
	}
	if len(presets) < 3 {
		t.Errorf("expected seeded presets, got %d", len(presets))
	}
}

func TestProjectLifecycle(t *testing.T) {
	s := testStore(t)
	deviceId, _, err := s.CreateDevice("studio", "studio.local", "darwin", "arm64", false)
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject("Storefront", deviceId, "/Users/dev/storefront")
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Storefront" || p.DeviceId != deviceId {
		t.Fatalf("unexpected project: %+v", p)
	}
	projects, err := s.ListProjects()
	if err != nil || len(projects) != 1 {
		t.Fatalf("ListProjects: %+v, %v", projects, err)
	}
	updated, err := s.UpdateProject(p.Id, "Web store", deviceId, "/Users/dev/web-store")
	if err != nil || updated == nil || updated.Path != "/Users/dev/web-store" {
		t.Fatalf("UpdateProject: %+v, %v", updated, err)
	}
	if err := s.DeleteProject(p.Id); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.ProjectById(p.Id); got != nil {
		t.Fatal("deleted project still exists")
	}
}

func TestDeletingDeviceDeletesItsProjects(t *testing.T) {
	s := testStore(t)
	deviceId, _, _ := s.CreateDevice("runner", "runner", "linux", "amd64", false)
	if _, err := s.CreateProject("API", deviceId, "/srv/api"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDevice(deviceId); err != nil {
		t.Fatal(err)
	}
	projects, err := s.ListProjects()
	if err != nil || len(projects) != 0 {
		t.Fatalf("projects left after deleting device: %+v, %v", projects, err)
	}
}
