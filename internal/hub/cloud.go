package hub

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// One-click cloud machines: the hub creates a VM at Hetzner Cloud or
// DigitalOcean with a cloud-init script that installs the Overseer agent and
// enrolls it here. The provider API token lives only in this hub's database;
// it never reaches the browser, the VM or the logs.

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS cloud_providers (
	provider   TEXT PRIMARY KEY,
	token      TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_machines (
	id            TEXT PRIMARY KEY,
	provider      TEXT NOT NULL,
	server_id     TEXT NOT NULL DEFAULT '',
	firewall_id   TEXT NOT NULL DEFAULT '',
	name          TEXT NOT NULL,
	hostname      TEXT NOT NULL,
	region        TEXT NOT NULL,
	size          TEXT NOT NULL,
	currency      TEXT NOT NULL DEFAULT '',
	price_monthly REAL NOT NULL DEFAULT 0,
	ipv4          TEXT NOT NULL DEFAULT '',
	device_id     TEXT NOT NULL DEFAULT '',
	stage         TEXT NOT NULL,
	error         TEXT NOT NULL DEFAULT '',
	close_ssh     INTEGER NOT NULL DEFAULT 0,
	tailnet       INTEGER NOT NULL DEFAULT 0,
	ping_hash     TEXT NOT NULL DEFAULT '',
	pinged_at     INTEGER NOT NULL DEFAULT 0,
	created_at    INTEGER NOT NULL,
	joined_at     INTEGER NOT NULL DEFAULT 0,
	deleted_at    INTEGER NOT NULL DEFAULT 0
);`)
}

// Stages a cloud machine moves through.
const (
	cloudCreating   = "creating"   // the provider is still building the server
	cloudBooting    = "booting"    // the server runs; the install script has not called in yet
	cloudInstalling = "installing" // the script is installing tools and the agent
	cloudJoined     = "joined"     // the device appeared in Machines
	cloudFailed     = "failed"
)

// cloudJoinTimeout is how long a new server gets to join before it is
// reported as failed (it stays tracked, so it can still be deleted).
const cloudJoinTimeout = 25 * time.Minute

// Tunables the tests shorten.
var (
	cloudPollInterval  = 6 * time.Second
	cloudDeleteRetries = 12
	cloudDeleteWait    = 2 * time.Second
)

// cloudProvider is one cloud's REST API. Tokens are passed per call so a
// provider value holds no secrets.
type cloudProvider interface {
	ID() string
	Name() string
	Currency() string
	TokenURL() string // where the user creates an API token
	ConsoleURL(serverID string) string
	Check(ctx context.Context, token string) error
	Options(ctx context.Context, token string) (cloudOptions, error)
	Create(ctx context.Context, token string, spec cloudCreateSpec) (cloudServer, error)
	Get(ctx context.Context, token, serverID string) (cloudServer, error)
	// Delete removes the server, then its firewall. A server that is already
	// gone is not an error.
	Delete(ctx context.Context, token, serverID, firewallID string) error
}

var errCloudGone = errors.New("the server no longer exists")

type cloudRegion struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

type cloudSize struct {
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	CPUs     int     `json:"cpus"`
	MemoryGB float64 `json:"memoryGb"`
	DiskGB   int     `json:"diskGb"`
	// Prices is the monthly price per region id; a size is only offered in
	// the regions that appear here.
	Prices map[string]float64 `json:"prices"`
}

type cloudOptions struct {
	Currency      string        `json:"currency"`
	Regions       []cloudRegion `json:"regions"`
	Sizes         []cloudSize   `json:"sizes"`
	DefaultRegion string        `json:"defaultRegion"`
	DefaultSize   string        `json:"defaultSize"`
	// Live is false when the sizes are the built-in list because the
	// provider's API could not be asked; prices are then estimates.
	Live bool `json:"live"`
}

type cloudCreateSpec struct {
	MachineId string
	Hostname  string
	Region    string
	Size      string
	UserData  string
	CloseSSH  bool
}

type cloudServer struct {
	ID         string
	Status     string // normalized: building, running, other
	IPv4       string
	FirewallID string
}

func cloudProviders() map[string]cloudProvider {
	return map[string]cloudProvider{"hetzner": hetznerProvider{}, "digitalocean": digitalOceanProvider{}}
}

func cloudProviderByID(id string) cloudProvider { return cloudProviders()[id] }

var cloudHTTP = &http.Client{Timeout: 25 * time.Second}

// cloudAPIError is a provider's own error message, shown to the user as is.
type cloudAPIError struct {
	Status  int
	Message string
}

func (e *cloudAPIError) Error() string { return e.Message }

// cloudRedact removes the token from text that might echo it.
func cloudRedact(text, token string) string {
	if token != "" {
		text = strings.ReplaceAll(text, token, "•••")
	}
	return text
}

// --- store ---

type cloudMachine struct {
	Id, Provider, ServerId, FirewallId string
	Name, Hostname, Region, Size       string
	Currency                           string
	PriceMonthly                       float64
	IPv4, DeviceId, Stage, Error       string
	CloseSSH, Tailnet                  bool
	PingHash                           string
	PingedAt, CreatedAt, JoinedAt      int64
	DeletedAt                          int64
}

const cloudMachineCols = `id, provider, server_id, firewall_id, name, hostname, region, size, currency, price_monthly,
	ipv4, device_id, stage, error, close_ssh, tailnet, ping_hash, pinged_at, created_at, joined_at, deleted_at`

func scanCloudMachine(row interface{ Scan(...any) error }) (*cloudMachine, error) {
	var m cloudMachine
	var closeSSH, tailnet int
	err := row.Scan(&m.Id, &m.Provider, &m.ServerId, &m.FirewallId, &m.Name, &m.Hostname, &m.Region, &m.Size, &m.Currency,
		&m.PriceMonthly, &m.IPv4, &m.DeviceId, &m.Stage, &m.Error, &closeSSH, &tailnet, &m.PingHash, &m.PingedAt,
		&m.CreatedAt, &m.JoinedAt, &m.DeletedAt)
	if err != nil {
		return nil, err
	}
	m.CloseSSH, m.Tailnet = closeSSH == 1, tailnet == 1
	return &m, nil
}

func (s *Store) CloudToken(provider string) (string, error) {
	var token string
	err := s.db.QueryRow(`SELECT token FROM cloud_providers WHERE provider = ?`, provider).Scan(&token)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return token, err
}

func (s *Store) SetCloudToken(provider, token string) error {
	_, err := s.db.Exec(`INSERT INTO cloud_providers (provider, token, created_at) VALUES (?, ?, ?)
		ON CONFLICT(provider) DO UPDATE SET token = excluded.token, created_at = excluded.created_at`,
		provider, token, time.Now().Unix())
	return err
}

func (s *Store) DeleteCloudToken(provider string) error {
	_, err := s.db.Exec(`DELETE FROM cloud_providers WHERE provider = ?`, provider)
	return err
}

func (s *Store) InsertCloudMachine(m *cloudMachine) error {
	_, err := s.db.Exec(`INSERT INTO cloud_machines (`+cloudMachineCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		m.Id, m.Provider, m.ServerId, m.FirewallId, m.Name, m.Hostname, m.Region, m.Size, m.Currency, m.PriceMonthly,
		m.IPv4, m.DeviceId, m.Stage, m.Error, boolInt(m.CloseSSH), boolInt(m.Tailnet), m.PingHash, m.PingedAt,
		m.CreatedAt, m.JoinedAt, m.DeletedAt)
	return err
}

// SaveCloudMachine writes every mutable column.
func (s *Store) SaveCloudMachine(m *cloudMachine) error {
	_, err := s.db.Exec(`UPDATE cloud_machines SET server_id=?, firewall_id=?, name=?, ipv4=?, device_id=?, stage=?, error=?,
		pinged_at=?, joined_at=?, deleted_at=?, price_monthly=?, currency=? WHERE id=?`,
		m.ServerId, m.FirewallId, m.Name, m.IPv4, m.DeviceId, m.Stage, m.Error, m.PingedAt, m.JoinedAt, m.DeletedAt,
		m.PriceMonthly, m.Currency, m.Id)
	return err
}

func (s *Store) CloudMachine(id string) (*cloudMachine, error) {
	m, err := scanCloudMachine(s.db.QueryRow(`SELECT `+cloudMachineCols+` FROM cloud_machines WHERE id = ? AND deleted_at = 0`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

func (s *Store) CloudMachineByPing(token string) (*cloudMachine, error) {
	m, err := scanCloudMachine(s.db.QueryRow(`SELECT `+cloudMachineCols+` FROM cloud_machines WHERE ping_hash = ? AND deleted_at = 0`, hashToken(token)))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

func (s *Store) ListCloudMachines() ([]*cloudMachine, error) {
	rows, err := s.db.Query(`SELECT ` + cloudMachineCols + ` FROM cloud_machines WHERE deleted_at = 0 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*cloudMachine
	for rows.Next() {
		m, err := scanCloudMachine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// --- hub reachability ---

// hubReach says whether a server in the cloud can reach the hub at a URL.
type hubReach struct {
	URL     string `json:"url"`
	Kind    string `json:"kind"` // public, private, local, tailnet
	Message string `json:"message,omitempty"`
}

var cloudHostRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)

// classifyHubURL normalizes raw to scheme://host[:port] and says how a cloud
// server would see it. The result goes into a shell script, so only plain
// host names and IP literals are accepted.
func classifyHubURL(raw string) (hubReach, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return hubReach{}, errors.New("the hub address must look like https://hub.example.com")
	}
	if p := strings.Trim(u.Path, "/"); p != "" || u.RawQuery != "" || u.Fragment != "" {
		return hubReach{}, errors.New("the hub address must not have a path")
	}
	host, port := u.Hostname(), u.Port()
	ip := net.ParseIP(host)
	if ip == nil && !cloudHostRe.MatchString(host) {
		return hubReach{}, errors.New("the hub address has an invalid host name")
	}
	if port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			return hubReach{}, errors.New("the hub address has an invalid port")
		}
	}
	norm := u.Scheme + "://" + u.Host
	r := hubReach{URL: norm}
	lower := strings.ToLower(host)
	switch {
	case ip != nil && ip.IsLoopback(), lower == "localhost", strings.HasSuffix(lower, ".localhost"):
		r.Kind = "local"
	case ip != nil && isTailnetIP(ip), strings.HasSuffix(lower, ".ts.net"):
		r.Kind = "tailnet"
	case ip != nil && (ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()),
		ip == nil && (strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".lan") ||
			strings.HasSuffix(lower, ".internal") || strings.HasSuffix(lower, ".home.arpa") ||
			strings.HasSuffix(lower, ".home") || strings.HasSuffix(lower, ".corp") || !strings.Contains(lower, ".")):
		r.Kind = "private"
	default:
		r.Kind = "public"
	}
	return r, nil
}

func isTailnetIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		return ip4[0] == 100 && ip4[1]&0xC0 == 64 // 100.64.0.0/10
	}
	return strings.HasPrefix(strings.ToLower(ip.String()), "fd7a:115c:a1e0:")
}

// cloudHubPlan decides how a new server will reach this hub, or why it can't.
// hubURL is the address of the page the user is on; override is an address
// typed in for the Tailscale case.
func cloudHubPlan(hubURL, override string, haveTailscaleKey bool) (hubReach, error) {
	chosen := hubURL
	if strings.TrimSpace(override) != "" {
		chosen = override
	}
	r, err := classifyHubURL(chosen)
	if err != nil {
		return r, err
	}
	switch r.Kind {
	case "public":
		return r, nil
	case "tailnet":
		if !haveTailscaleKey {
			return r, errors.New("This hub address only works inside your Tailscale network. Add a Tailscale auth key so the server can join it.")
		}
		return r, nil
	default:
		if !haveTailscaleKey {
			return r, fmt.Errorf("This hub is at %s, which a cloud server can't reach. Open Overseer from its public HTTPS address, or add a Tailscale auth key and the hub's Tailscale address.", r.URL)
		}
		return r, errors.New("The hub address must be one the server can reach through Tailscale (a 100.x.y.z address or a .ts.net name). Enter it below.")
	}
}

// tailnetCandidates lists addresses this machine has on a Tailscale network,
// as hub URLs the user can pick from.
func tailnetCandidates(port string) []string {
	if port == "" {
		return nil
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var out []string
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && isTailnetIP(ipn.IP) {
			out = append(out, "http://"+net.JoinHostPort(ipn.IP.String(), port))
		}
	}
	sort.Strings(out)
	return out
}

// --- validation helpers ---

var (
	cloudNameRe  = regexp.MustCompile(`^[^\x00-\x1f\x7f]{1,60}$`)
	sshKeyRe     = regexp.MustCompile(`^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]{20,1000}( [^\x00-\x1f\x7f]{0,100})?$`)
	tailscaleRe  = regexp.MustCompile(`^tskey-[A-Za-z0-9_-]{10,200}$`)
	hostSlugRe   = regexp.MustCompile(`[^a-z0-9]+`)
	cloudToolIDs = []string{"claude", "codex", "gemini"}
)

// cloudHostname turns a display name into a unique DNS-safe host name.
func cloudHostname(name string) string {
	slug := strings.Trim(hostSlugRe.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = "cloud"
	}
	if len(slug) > 40 {
		slug = strings.Trim(slug[:40], "-")
	}
	return slug + "-" + randomToken()[:4]
}

// --- handlers ---

func (s *Server) routesCloud(m *http.ServeMux) {
	// Spending money and holding provider tokens is the owner's job. The list
	// of machines is read-only and carries no secrets, so any signed-in user
	// can see which machines are cloud servers.
	m.HandleFunc("GET /api/cloud", s.requireOwner(s.handleCloudOverview))
	m.HandleFunc("PUT /api/cloud/providers/{id}", s.ownerAudited("cloud.connect", s.handleCloudConnect))
	m.HandleFunc("DELETE /api/cloud/providers/{id}", s.ownerAudited("cloud.disconnect", s.handleCloudDisconnect))
	m.HandleFunc("GET /api/cloud/providers/{id}/options", s.requireOwner(s.handleCloudOptions))
	m.HandleFunc("GET /api/cloud/machines", s.requireAuth(s.handleCloudList))
	m.HandleFunc("POST /api/cloud/machines", s.ownerAudited("cloud.create", s.handleCloudCreate))
	m.HandleFunc("POST /api/cloud/machines/{id}/delete", s.ownerAudited("cloud.delete", s.handleCloudDelete))
	// Called by the install script on the new server; authenticated by a
	// per-machine token that can only report progress.
	m.HandleFunc("POST /api/cloud/progress", s.handleCloudProgress)
}

type cloudProviderView struct {
	Id         string `json:"id"`
	Name       string `json:"name"`
	Connected  bool   `json:"connected"`
	TokenHint  string `json:"tokenHint,omitempty"`
	TokenURL   string `json:"tokenUrl"`
	ConsoleURL string `json:"consoleUrl"`
	Currency   string `json:"currency"`
}

func (s *Server) cloudProviderViews() []cloudProviderView {
	var out []cloudProviderView
	for _, id := range []string{"hetzner", "digitalocean"} {
		p := cloudProviderByID(id)
		v := cloudProviderView{Id: id, Name: p.Name(), TokenURL: p.TokenURL(), ConsoleURL: p.ConsoleURL(""), Currency: p.Currency()}
		if tok, _ := s.store.CloudToken(id); tok != "" {
			v.Connected = true
			if len(tok) > 8 {
				v.TokenHint = "…" + tok[len(tok)-4:]
			}
		}
		out = append(out, v)
	}
	return out
}

func (s *Server) handleCloudOverview(w http.ResponseWriter, r *http.Request) {
	base := requestBaseURL(r)
	hub := map[string]any{"url": base}
	if reach, err := classifyHubURL(base); err == nil {
		hub["kind"] = reach.Kind
	} else {
		hub["kind"] = "private"
	}
	_, port, _ := net.SplitHostPort(r.Host)
	cands := tailnetCandidates(port)
	if cands == nil {
		cands = []string{}
	}
	hub["tailnetCandidates"] = cands
	linuxOK := true
	linuxMsg := ""
	if _, err := s.resolveAgentBinary("linux", "amd64"); err != nil {
		linuxOK, linuxMsg = false, err.Error()
	}
	hub["agentBinary"] = linuxOK
	if linuxMsg != "" {
		hub["agentBinaryMessage"] = linuxMsg
	}
	writeJSON(w, map[string]any{"providers": s.cloudProviderViews(), "hub": hub})
}

func (s *Server) handleCloudConnect(w http.ResponseWriter, r *http.Request) {
	p := cloudProviderByID(r.PathValue("id"))
	if p == nil {
		httpError(w, http.StatusNotFound, "unknown provider")
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	token := strings.TrimSpace(req.Token)
	if len(token) < 20 || len(token) > 400 || strings.ContainsAny(token, " \t\r\n\"'\\") {
		httpError(w, http.StatusBadRequest, "That doesn't look like an API token. Copy the whole token from "+p.Name()+".")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := p.Check(ctx, token); err != nil {
		httpError(w, http.StatusBadRequest, p.Name()+" rejected this token: "+cloudRedact(err.Error(), token))
		return
	}
	if err := s.store.SetCloudToken(p.ID(), token); err != nil {
		httpError(w, http.StatusInternalServerError, "could not save the token")
		return
	}
	writeJSON(w, map[string]any{"providers": s.cloudProviderViews()})
}

func (s *Server) handleCloudDisconnect(w http.ResponseWriter, r *http.Request) {
	p := cloudProviderByID(r.PathValue("id"))
	if p == nil {
		httpError(w, http.StatusNotFound, "unknown provider")
		return
	}
	list, _ := s.store.ListCloudMachines()
	for _, m := range list {
		if m.Provider == p.ID() {
			httpError(w, http.StatusConflict, "Delete this hub's "+p.Name()+" servers first; the token is needed to delete them.")
			return
		}
	}
	if err := s.store.DeleteCloudToken(p.ID()); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]any{"providers": s.cloudProviderViews()})
}

func (s *Server) handleCloudOptions(w http.ResponseWriter, r *http.Request) {
	p := cloudProviderByID(r.PathValue("id"))
	if p == nil {
		httpError(w, http.StatusNotFound, "unknown provider")
		return
	}
	token, _ := s.store.CloudToken(p.ID())
	if token == "" {
		httpError(w, http.StatusConflict, "Connect "+p.Name()+" first.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	opts, err := p.Options(ctx, token)
	if err != nil {
		httpError(w, http.StatusBadGateway, p.Name()+": "+cloudRedact(err.Error(), token))
		return
	}
	writeJSON(w, opts)
}

type cloudMachineView struct {
	Id           string  `json:"id"`
	Provider     string  `json:"provider"`
	ProviderName string  `json:"providerName"`
	Name         string  `json:"name"`
	Region       string  `json:"region"`
	Size         string  `json:"size"`
	Currency     string  `json:"currency"`
	PriceMonthly float64 `json:"priceMonthly"`
	IPv4         string  `json:"ipv4,omitempty"`
	DeviceId     string  `json:"deviceId,omitempty"`
	// DeviceGone is true when the machine joined but was later removed from
	// Machines; the server keeps billing until it is deleted.
	DeviceGone bool   `json:"deviceGone,omitempty"`
	Stage      string `json:"stage"`
	Error      string `json:"error,omitempty"`
	CloseSSH   bool   `json:"closeSsh"`
	Tailnet    bool   `json:"tailnet"`
	CreatedAt  int64  `json:"createdAt"`
	JoinedAt   int64  `json:"joinedAt,omitempty"`
	ConsoleURL string `json:"consoleUrl"`
}

func (s *Server) cloudView(m *cloudMachine) cloudMachineView {
	v := cloudMachineView{
		Id: m.Id, Provider: m.Provider, Name: m.Name, Region: m.Region, Size: m.Size, Currency: m.Currency,
		PriceMonthly: m.PriceMonthly, IPv4: m.IPv4, DeviceId: m.DeviceId, Stage: m.Stage, Error: m.Error,
		CloseSSH: m.CloseSSH, Tailnet: m.Tailnet, CreatedAt: m.CreatedAt, JoinedAt: m.JoinedAt,
	}
	if p := cloudProviderByID(m.Provider); p != nil {
		v.ProviderName, v.ConsoleURL = p.Name(), p.ConsoleURL(m.ServerId)
	}
	if m.DeviceId != "" {
		if d, _ := s.store.DeviceById(m.DeviceId); d == nil {
			v.DeviceGone = true
		}
	}
	return v
}

func (s *Server) handleCloudList(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListCloudMachines()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]cloudMachineView, 0, len(list))
	for _, m := range list {
		s.reconcileCloudMachine(r.Context(), m)
		out = append(out, s.cloudView(m))
	}
	writeJSON(w, out)
}

type cloudCreateRequest struct {
	Provider     string          `json:"provider"`
	Name         string          `json:"name"`
	Region       string          `json:"region"`
	Size         string          `json:"size"`
	SSHKey       string          `json:"sshKey"`
	CloseSSH     bool            `json:"closeSsh"`
	Tools        map[string]bool `json:"tools"`
	TailscaleKey string          `json:"tailscaleKey"`
	HubURL       string          `json:"hubUrl"`
}

func (s *Server) handleCloudCreate(w http.ResponseWriter, r *http.Request) {
	var req cloudCreateRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	p := cloudProviderByID(req.Provider)
	if p == nil {
		httpError(w, http.StatusBadRequest, "unknown provider")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.SSHKey = strings.TrimSpace(req.SSHKey)
	req.TailscaleKey = strings.TrimSpace(req.TailscaleKey)
	switch {
	case !cloudNameRe.MatchString(req.Name):
		httpError(w, http.StatusBadRequest, "Give the machine a name (up to 60 characters).")
		return
	case req.SSHKey != "" && !sshKeyRe.MatchString(req.SSHKey):
		httpError(w, http.StatusBadRequest, "That SSH key doesn't look right. Paste one public key on one line, like ssh-ed25519 AAAA… you@laptop.")
		return
	case req.TailscaleKey != "" && !tailscaleRe.MatchString(req.TailscaleKey):
		httpError(w, http.StatusBadRequest, "That doesn't look like a Tailscale auth key (it starts with tskey-).")
		return
	}
	token, _ := s.store.CloudToken(p.ID())
	if token == "" {
		httpError(w, http.StatusConflict, "Connect "+p.Name()+" first.")
		return
	}
	reach, err := cloudHubPlan(requestBaseURL(r), req.HubURL, req.TailscaleKey != "")
	if err != nil {
		httpError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if _, err := s.resolveAgentBinary("linux", "amd64"); err != nil {
		httpError(w, http.StatusUnprocessableEntity, "This hub has no Linux agent to give the new server: "+err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	opts, err := p.Options(ctx, token)
	if err != nil {
		httpError(w, http.StatusBadGateway, p.Name()+": "+cloudRedact(err.Error(), token))
		return
	}
	price, ok := cloudPrice(opts, req.Region, req.Size)
	if !ok {
		httpError(w, http.StatusBadRequest, "That size isn't available in that region. Pick another.")
		return
	}

	var tools []string
	for _, id := range cloudToolIDs {
		if req.Tools[id] {
			tools = append(tools, id)
		}
	}
	enroll, err := s.store.CreateEnrollToken(60 * time.Minute)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ping := randomToken()
	m := &cloudMachine{
		Id: randomToken()[:16], Provider: p.ID(), Name: req.Name, Hostname: cloudHostname(req.Name),
		Region: req.Region, Size: req.Size, Currency: opts.Currency, PriceMonthly: price,
		Stage: cloudCreating, CloseSSH: req.CloseSSH, Tailnet: req.TailscaleKey != "",
		PingHash: hashToken(ping), CreatedAt: time.Now().Unix(),
	}
	userData, err := renderCloudInit(cloudInitSpec{
		Hostname: m.Hostname, HubURL: reach.URL, EnrollToken: enroll, ProgressToken: ping,
		SSHKey: req.SSHKey, TailscaleKey: req.TailscaleKey, Tools: tools,
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.store.InsertCloudMachine(m); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	srv, err := p.Create(ctx, token, cloudCreateSpec{
		MachineId: m.Id, Hostname: m.Hostname, Region: req.Region, Size: req.Size, UserData: userData, CloseSSH: req.CloseSSH,
	})
	if err != nil {
		// Nothing was created at the provider, so there is nothing to track.
		s.store.db.Exec(`DELETE FROM cloud_machines WHERE id = ?`, m.Id)
		httpError(w, http.StatusBadGateway, p.Name()+": "+cloudRedact(err.Error(), token))
		return
	}
	m.ServerId, m.FirewallId, m.IPv4 = srv.ID, srv.FirewallID, srv.IPv4
	if srv.Status == "running" {
		m.Stage = cloudBooting
	}
	if err := s.store.SaveCloudMachine(m); err != nil {
		log.Printf("cloud: saving machine %s: %v", m.Id, err)
	}
	go s.watchCloudMachine(m.Id)
	writeJSON(w, s.cloudView(m))
}

func cloudPrice(opts cloudOptions, region, size string) (float64, bool) {
	for _, sz := range opts.Sizes {
		if sz.Id == size {
			price, ok := sz.Prices[region]
			return price, ok
		}
	}
	return 0, false
}

// handleCloudProgress records a stage reported by the install script.
func (s *Server) handleCloudProgress(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token   string `json:"token"`
		Stage   string `json:"stage"`
		Message string `json:"message"`
	}
	if err := readJSON(r, &req); err != nil || req.Token == "" {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	cloudMu.Lock()
	defer cloudMu.Unlock()
	m, err := s.store.CloudMachineByPing(req.Token)
	if err != nil || m == nil {
		httpError(w, http.StatusForbidden, "unknown token")
		return
	}
	switch req.Stage {
	case "installing":
		if m.Stage == cloudCreating || m.Stage == cloudBooting || m.Stage == cloudFailed {
			m.Stage, m.Error = cloudInstalling, ""
		}
	case "failed":
		if m.Stage != cloudJoined {
			m.Stage, m.Error = cloudFailed, cloudCleanMessage(req.Message, 300)
		}
	default:
		httpError(w, http.StatusBadRequest, "unknown stage")
		return
	}
	m.PingedAt = time.Now().Unix()
	if err := s.store.SaveCloudMachine(m); err != nil {
		httpError(w, http.StatusInternalServerError, "could not save")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// cloudCleanMessage keeps text from a server (or a provider) to one short,
// printable line.
func cloudCleanMessage(text string, max int) string {
	var b strings.Builder
	for _, r := range text {
		if r < ' ' || r == 0x7f {
			r = ' '
		}
		b.WriteRune(r)
		if b.Len() >= max {
			break
		}
	}
	return strings.TrimSpace(b.String())
}

// --- reconciling with the provider and the hub's devices ---

var cloudMu sync.Mutex

// reconcileCloudMachine links the machine to the device it enrolled as and
// refreshes its state from the provider. It is cheap enough to run on every
// list request and from the watcher.
func (s *Server) reconcileCloudMachine(ctx context.Context, m *cloudMachine) {
	cloudMu.Lock()
	defer cloudMu.Unlock()
	fresh, err := s.store.CloudMachine(m.Id)
	if err != nil || fresh == nil {
		return
	}
	*m = *fresh
	changed := false

	if m.DeviceId == "" {
		if d := s.findCloudDevice(m); d != nil {
			m.DeviceId, m.Stage, m.Error, m.JoinedAt = d.Id, cloudJoined, "", time.Now().Unix()
			if d.Name == m.Hostname || d.Name == "" {
				s.store.RenameDevice(d.Id, m.Name)
			}
			changed = true
		}
	}
	if m.Stage != cloudJoined && m.ServerId != "" && m.Stage != cloudFailed {
		if p := cloudProviderByID(m.Provider); p != nil {
			if token, _ := s.store.CloudToken(m.Provider); token != "" {
				cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
				srv, err := p.Get(cctx, token, m.ServerId)
				cancel()
				switch {
				case errors.Is(err, errCloudGone):
					m.Stage, m.Error, changed = cloudFailed, "The server was deleted at "+p.Name()+".", true
				case err == nil:
					if srv.IPv4 != "" && srv.IPv4 != m.IPv4 {
						m.IPv4, changed = srv.IPv4, true
					}
					if srv.Status == "running" && m.Stage == cloudCreating {
						m.Stage, changed = cloudBooting, true
					}
				}
			}
		}
	}
	if m.Stage != cloudJoined && m.Stage != cloudFailed && time.Since(time.Unix(m.CreatedAt, 0)) > cloudJoinTimeout {
		m.Stage, changed = cloudFailed, true
		if m.PingedAt == 0 {
			m.Error = "The server is running but never contacted the hub. Check that the hub's address is reachable from the internet (or from your Tailscale network)."
		} else {
			m.Error = "The server started installing but did not join within 25 minutes. Its log is /var/log/overseer-bootstrap.log."
		}
	}
	if changed {
		if err := s.store.SaveCloudMachine(m); err != nil {
			log.Printf("cloud: saving machine %s: %v", m.Id, err)
		}
	}
}

// findCloudDevice finds the device a machine enrolled as: the same unique
// host name, registered after the machine was created, not taken by another.
func (s *Server) findCloudDevice(m *cloudMachine) *Device {
	devices, err := s.store.ListDevices()
	if err != nil {
		return nil
	}
	taken := map[string]bool{}
	if list, err := s.store.ListCloudMachines(); err == nil {
		for _, other := range list {
			if other.DeviceId != "" {
				taken[other.DeviceId] = true
			}
		}
	}
	for i := range devices {
		d := &devices[i]
		if !d.IsHub && d.Hostname == m.Hostname && d.CreatedAt >= m.CreatedAt-5 && !taken[d.Id] {
			return d
		}
	}
	return nil
}

// watchCloudMachine polls until the machine joined, failed, or was deleted.
func (s *Server) watchCloudMachine(id string) {
	ticker := time.NewTicker(cloudPollInterval)
	defer ticker.Stop()
	for range ticker.C {
		m, err := s.store.CloudMachine(id)
		if err != nil || m == nil {
			return
		}
		s.reconcileCloudMachine(context.Background(), m)
		if m.Stage == cloudJoined || m.Stage == cloudFailed {
			return
		}
	}
}

// --- delete ---

func (s *Server) handleCloudDelete(w http.ResponseWriter, r *http.Request) {
	m, err := s.store.CloudMachine(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		httpError(w, http.StatusNotFound, "no such cloud machine")
		return
	}
	var req struct {
		ConfirmName string `json:"confirmName"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	confirm := strings.TrimSpace(req.ConfirmName)
	ok := confirm != "" && confirm == m.Name
	if !ok && m.DeviceId != "" {
		if d, _ := s.store.DeviceById(m.DeviceId); d != nil && confirm == d.Name {
			ok = true
		}
	}
	if !ok {
		httpError(w, http.StatusBadRequest, "Type the machine's name exactly to confirm.")
		return
	}
	p := cloudProviderByID(m.Provider)
	token, _ := s.store.CloudToken(m.Provider)
	if p == nil || token == "" {
		httpError(w, http.StatusConflict, "The API token for this server's provider is no longer saved. Reconnect it, or delete the server in the provider's console.")
		return
	}
	if m.ServerId != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		if err := p.Delete(ctx, token, m.ServerId, m.FirewallId); err != nil {
			httpError(w, http.StatusBadGateway, p.Name()+": "+cloudRedact(err.Error(), token))
			return
		}
	}
	cloudMu.Lock()
	m.DeletedAt = time.Now().Unix()
	err = s.store.SaveCloudMachine(m)
	cloudMu.Unlock()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m.DeviceId != "" {
		if d, _ := s.store.DeviceById(m.DeviceId); d != nil && !d.IsHub {
			s.store.DeleteDevice(d.Id)
			if c := s.registry.get(d.Id); c != nil {
				c.ws.Close()
			}
		}
	}
	writeJSON(w, map[string]bool{"ok": true})
}
