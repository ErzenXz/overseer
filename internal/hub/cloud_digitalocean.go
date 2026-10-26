package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// doBase is a variable so tests can point it at a fake.
var doBase = "https://api.digitalocean.com/v2"

// digitalOceanProvider talks to the DigitalOcean API over plain net/http.
type digitalOceanProvider struct{}

func (digitalOceanProvider) ID() string       { return "digitalocean" }
func (digitalOceanProvider) Name() string     { return "DigitalOcean" }
func (digitalOceanProvider) Currency() string { return "USD" }
func (digitalOceanProvider) TokenURL() string {
	return "https://docs.digitalocean.com/reference/api/create-personal-access-token/"
}
func (digitalOceanProvider) ConsoleURL(serverID string) string {
	if serverID != "" {
		return "https://cloud.digitalocean.com/droplets/" + url.PathEscape(serverID)
	}
	return "https://cloud.digitalocean.com/droplets"
}

func doCall(ctx context.Context, token, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, doBase+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := cloudHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach DigitalOcean: %w", cloudURLError(err))
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			ID      string `json:"id"`
			Message string `json:"message"`
		}
		msg := strings.TrimSpace(string(data))
		if json.Unmarshal(data, &e) == nil && e.Message != "" {
			msg = e.Message
		}
		if msg == "" {
			msg = resp.Status
		}
		return &cloudAPIError{Status: resp.StatusCode, Message: cloudCleanMessage(msg, 300)}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (digitalOceanProvider) Check(ctx context.Context, token string) error {
	return doCall(ctx, token, "GET", "/account", nil, nil)
}

type doRegion struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Available bool   `json:"available"`
}

type doSize struct {
	Slug         string   `json:"slug"`
	Memory       int      `json:"memory"` // MB
	VCPUs        int      `json:"vcpus"`
	Disk         int      `json:"disk"`
	PriceMonthly float64  `json:"price_monthly"`
	Regions      []string `json:"regions"`
	Available    bool     `json:"available"`
}

// Plain "Basic" droplets only (s-2vcpu-4gb, not the -intel/-amd variants).
var doBasicSlug = regexp.MustCompile(`^s-\d+vcpu-\d+gb$`)

var doFallbackRegions = []cloudRegion{
	{Id: "nyc3", Name: "New York"}, {Id: "sfo3", Name: "San Francisco"}, {Id: "ams3", Name: "Amsterdam"},
	{Id: "fra1", Name: "Frankfurt"}, {Id: "lon1", Name: "London"}, {Id: "sgp1", Name: "Singapore"},
}

func (p digitalOceanProvider) Options(ctx context.Context, token string) (cloudOptions, error) {
	var regs struct {
		Regions []doRegion `json:"regions"`
	}
	var sizes struct {
		Sizes []doSize `json:"sizes"`
	}
	opts := cloudOptions{Currency: "USD", Live: true}
	rerr := doCall(ctx, token, "GET", "/regions?per_page=200", nil, &regs)
	serr := doCall(ctx, token, "GET", "/sizes?per_page=200", nil, &sizes)
	if rerr != nil || serr != nil || len(sizes.Sizes) == 0 {
		if ae, ok := firstAPIError(rerr, serr); ok && (ae.Status == http.StatusUnauthorized || ae.Status == http.StatusForbidden) {
			return cloudOptions{}, ae
		}
		// Can't ask: offer the usual Basic droplets with estimated prices.
		opts.Live = false
		opts.Regions = doFallbackRegions
		for _, f := range []struct {
			id      string
			cpus    int
			mem     float64
			disk    int
			monthly float64
		}{{"s-1vcpu-2gb", 1, 2, 50, 12}, {"s-2vcpu-2gb", 2, 2, 60, 18}, {"s-2vcpu-4gb", 2, 4, 80, 24}, {"s-4vcpu-8gb", 4, 8, 160, 48}} {
			prices := map[string]float64{}
			for _, r := range opts.Regions {
				prices[r.Id] = f.monthly
			}
			opts.Sizes = append(opts.Sizes, cloudSize{Id: f.id, Name: f.id, CPUs: f.cpus, MemoryGB: f.mem, DiskGB: f.disk, Prices: prices})
		}
	} else {
		okRegion := map[string]bool{}
		for _, r := range regs.Regions {
			if r.Available {
				okRegion[r.Slug] = true
				opts.Regions = append(opts.Regions, cloudRegion{Id: r.Slug, Name: r.Name})
			}
		}
		for _, s := range sizes.Sizes {
			if !s.Available || !doBasicSlug.MatchString(s.Slug) || s.Memory < 2048 || s.Memory > 16384 {
				continue
			}
			sz := cloudSize{Id: s.Slug, Name: s.Slug, CPUs: s.VCPUs, MemoryGB: float64(s.Memory) / 1024, DiskGB: s.Disk, Prices: map[string]float64{}}
			for _, r := range s.Regions {
				if okRegion[r] {
					sz.Prices[r] = s.PriceMonthly
				}
			}
			if len(sz.Prices) > 0 {
				opts.Sizes = append(opts.Sizes, sz)
			}
		}
		opts.Sizes = curateSizes(opts.Sizes, "s-2vcpu-4gb", 4)
		opts.Regions = onlyRegionsWithSizes(opts.Regions, opts.Sizes)
	}
	sort.SliceStable(opts.Regions, func(i, j int) bool { return opts.Regions[i].Name < opts.Regions[j].Name })
	opts.DefaultRegion = pickDefault(opts.Regions, "nyc3")
	opts.DefaultSize = cheapestOrPreferred(opts.Sizes, "s-2vcpu-4gb", opts.DefaultRegion)
	return opts, nil
}

func firstAPIError(errs ...error) (*cloudAPIError, bool) {
	for _, err := range errs {
		if ae, ok := err.(*cloudAPIError); ok {
			return ae, true
		}
	}
	return nil, false
}

type doDroplet struct {
	ID       int64  `json:"id"`
	Status   string `json:"status"`
	Networks struct {
		V4 []struct {
			IP   string `json:"ip_address"`
			Type string `json:"type"`
		} `json:"v4"`
	} `json:"networks"`
}

func (d doDroplet) toServer() cloudServer {
	status := "other"
	switch d.Status {
	case "new":
		status = "building"
	case "active":
		status = "running"
	}
	srv := cloudServer{ID: fmt.Sprint(d.ID), Status: status}
	for _, n := range d.Networks.V4 {
		if n.Type == "public" {
			srv.IPv4 = n.IP
		}
	}
	return srv
}

func (p digitalOceanProvider) Create(ctx context.Context, token string, spec cloudCreateSpec) (cloudServer, error) {
	tag := "overseer-" + spec.MachineId
	any4 := map[string]any{"addresses": []string{"0.0.0.0/0", "::/0"}}
	inbound := []map[string]any{}
	if !spec.CloseSSH {
		inbound = append(inbound, map[string]any{"protocol": "tcp", "ports": "22", "sources": any4})
	}
	// DigitalOcean firewalls drop anything not listed, outbound included.
	var fw struct {
		Firewall struct {
			ID string `json:"id"`
		} `json:"firewall"`
	}
	if err := doCall(ctx, token, "POST", "/firewalls", map[string]any{
		"name":          tag,
		"inbound_rules": inbound,
		"outbound_rules": []map[string]any{
			{"protocol": "tcp", "ports": "all", "destinations": any4},
			{"protocol": "udp", "ports": "all", "destinations": any4},
			{"protocol": "icmp", "destinations": any4},
		},
		"tags": []string{tag},
	}, &fw); err != nil {
		return cloudServer{}, err
	}
	var created struct {
		Droplet doDroplet `json:"droplet"`
	}
	err := doCall(ctx, token, "POST", "/droplets", map[string]any{
		"name":       spec.Hostname,
		"region":     spec.Region,
		"size":       spec.Size,
		"image":      "ubuntu-24-04-x64",
		"user_data":  spec.UserData,
		"ipv6":       true,
		"monitoring": false,
		"tags":       []string{"overseer", tag},
	}, &created)
	if err != nil {
		doCall(context.WithoutCancel(ctx), token, "DELETE", "/firewalls/"+url.PathEscape(fw.Firewall.ID), nil, nil)
		return cloudServer{}, err
	}
	srv := created.Droplet.toServer()
	srv.FirewallID = fw.Firewall.ID
	return srv, nil
}

func (p digitalOceanProvider) Get(ctx context.Context, token, serverID string) (cloudServer, error) {
	var out struct {
		Droplet doDroplet `json:"droplet"`
	}
	if err := doCall(ctx, token, "GET", "/droplets/"+url.PathEscape(serverID), nil, &out); err != nil {
		if ae, ok := err.(*cloudAPIError); ok && ae.Status == http.StatusNotFound {
			return cloudServer{}, errCloudGone
		}
		return cloudServer{}, err
	}
	return out.Droplet.toServer(), nil
}

func (p digitalOceanProvider) Delete(ctx context.Context, token, serverID, firewallID string) error {
	err := doCall(ctx, token, "DELETE", "/droplets/"+url.PathEscape(serverID), nil, nil)
	if ae, ok := err.(*cloudAPIError); ok && ae.Status == http.StatusNotFound {
		err = nil
	}
	if err != nil {
		return err
	}
	if firewallID != "" {
		// The firewall matches droplets by tag, so it can go right away.
		doCall(ctx, token, "DELETE", "/firewalls/"+url.PathEscape(firewallID), nil, nil)
	}
	return nil
}
