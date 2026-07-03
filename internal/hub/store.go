package hub

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Store wraps the hub's SQLite database.
type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	hostname   TEXT NOT NULL DEFAULT '',
	os         TEXT NOT NULL DEFAULT '',
	arch       TEXT NOT NULL DEFAULT '',
	token_hash TEXT NOT NULL,
	is_hub     INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	last_seen  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS enroll_tokens (
	token_hash TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	used       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS presets (
	id      INTEGER PRIMARY KEY AUTOINCREMENT,
	name    TEXT NOT NULL UNIQUE,
	command TEXT NOT NULL,
	kind    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS api_tokens (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);
`

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // modernc sqlite prefers a single writer
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("applying schema: %w", err)
	}
	s := &Store{db: db}
	if err := s.seedPresets(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) seedPresets() error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM presets`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	seeds := []struct{ name, command, kind string }{
		{"Shell", "", "shell"},
		{"Claude Code", "claude", "claude"},
		{"Codex", "codex", "codex"},
	}
	for _, p := range seeds {
		if _, err := s.db.Exec(`INSERT INTO presets (name, command, kind) VALUES (?, ?, ?)`, p.name, p.command, p.kind); err != nil {
			return err
		}
	}
	return nil
}

// --- settings ---

func (s *Store) Setting(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// --- devices ---

type Device struct {
	Id        string `json:"id"`
	Name      string `json:"name"`
	Hostname  string `json:"hostname"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	IsHub     bool   `json:"isHub"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateDevice registers a device and returns its id and plaintext token.
func (s *Store) CreateDevice(name, hostname, osName, arch string, isHub bool) (string, string, error) {
	id := randomToken()[:16]
	token := randomToken()
	_, err := s.db.Exec(`INSERT INTO devices (id, name, hostname, os, arch, token_hash, is_hub, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, hostname, osName, arch, hashToken(token), boolInt(isHub), time.Now().Unix())
	return id, token, err
}

// DeviceByToken authenticates an agent connection.
func (s *Store) DeviceByToken(token string) (*Device, error) {
	return s.scanDevice(s.db.QueryRow(
		`SELECT id, name, hostname, os, arch, is_hub, created_at, last_seen FROM devices WHERE token_hash = ?`,
		hashToken(token)))
}

func (s *Store) DeviceById(id string) (*Device, error) {
	return s.scanDevice(s.db.QueryRow(
		`SELECT id, name, hostname, os, arch, is_hub, created_at, last_seen FROM devices WHERE id = ?`, id))
}

func (s *Store) scanDevice(row *sql.Row) (*Device, error) {
	var d Device
	var isHub int
	err := row.Scan(&d.Id, &d.Name, &d.Hostname, &d.OS, &d.Arch, &isHub, &d.CreatedAt, &d.LastSeen)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.IsHub = isHub == 1
	return &d, nil
}

func (s *Store) ListDevices() ([]Device, error) {
	rows, err := s.db.Query(`SELECT id, name, hostname, os, arch, is_hub, created_at, last_seen
		FROM devices ORDER BY is_hub DESC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		var d Device
		var isHub int
		if err := rows.Scan(&d.Id, &d.Name, &d.Hostname, &d.OS, &d.Arch, &isHub, &d.CreatedAt, &d.LastSeen); err != nil {
			return nil, err
		}
		d.IsHub = isHub == 1
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) UpdateDeviceOnConnect(id, hostname, osName, arch string) error {
	_, err := s.db.Exec(`UPDATE devices SET hostname = ?, os = ?, arch = ?, last_seen = ? WHERE id = ?`,
		hostname, osName, arch, time.Now().Unix(), id)
	return err
}

func (s *Store) TouchDevice(id string) error {
	_, err := s.db.Exec(`UPDATE devices SET last_seen = ? WHERE id = ?`, time.Now().Unix(), id)
	return err
}

func (s *Store) RenameDevice(id, name string) error {
	_, err := s.db.Exec(`UPDATE devices SET name = ? WHERE id = ?`, name, id)
	return err
}

func (s *Store) DeleteDevice(id string) error {
	_, err := s.db.Exec(`DELETE FROM devices WHERE id = ?`, id)
	return err
}

// --- enrollment tokens ---

// CreateEnrollToken mints a single-use token valid for ttl.
func (s *Store) CreateEnrollToken(ttl time.Duration) (string, error) {
	token := randomToken()
	now := time.Now()
	_, err := s.db.Exec(`INSERT INTO enroll_tokens (token_hash, created_at, expires_at) VALUES (?, ?, ?)`,
		hashToken(token), now.Unix(), now.Add(ttl).Unix())
	return token, err
}

// ConsumeEnrollToken atomically validates and burns a token.
func (s *Store) ConsumeEnrollToken(token string) (bool, error) {
	res, err := s.db.Exec(`UPDATE enroll_tokens SET used = 1
		WHERE token_hash = ? AND used = 0 AND expires_at > ?`, hashToken(token), time.Now().Unix())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// --- presets ---

type Preset struct {
	Id      int64  `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	Kind    string `json:"kind"`
}

func (s *Store) ListPresets() ([]Preset, error) {
	rows, err := s.db.Query(`SELECT id, name, command, kind FROM presets ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Preset
	for rows.Next() {
		var p Preset
		if err := rows.Scan(&p.Id, &p.Name, &p.Command, &p.Kind); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreatePreset(name, command, kind string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO presets (name, command, kind) VALUES (?, ?, ?)`, name, command, kind)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) DeletePreset(id int64) error {
	_, err := s.db.Exec(`DELETE FROM presets WHERE id = ?`, id)
	return err
}

// --- API tokens ---

type ApiToken struct {
	Id        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Store) CreateApiToken(name string) (string, error) {
	token := "ovsr_" + randomToken()
	_, err := s.db.Exec(`INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)`,
		name, hashToken(token), time.Now().Unix())
	return token, err
}

func (s *Store) ValidApiToken(token string) (bool, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM api_tokens WHERE token_hash = ?`, hashToken(token)).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) ListApiTokens() ([]ApiToken, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at FROM api_tokens ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ApiToken
	for rows.Next() {
		var t ApiToken
		if err := rows.Scan(&t.Id, &t.Name, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) DeleteApiToken(id int64) error {
	_, err := s.db.Exec(`DELETE FROM api_tokens WHERE id = ?`, id)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
