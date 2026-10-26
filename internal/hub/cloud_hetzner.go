package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// hetznerBase is a variable so tests can point it at a fake.
var hetznerBase = "https://api.hetzner.cloud/v1"

// hetznerProvider talks to the Hetzner Cloud API over plain net/http.
type hetznerProvider struct{}

func (hetznerProvider) ID() string       { return "hetzner" }
func (hetznerProvider) Name() string     { return "Hetzner Cloud" }
func (hetznerProvider) Currency() string { return "EUR" }
func (hetznerProvider) TokenURL() string {
	return "https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/"
}
func (hetznerProvider) ConsoleURL(string) string { return "https://console.hetzner.cloud/" }

// hetznerCall runs one API request and decodes the JSON answer into out.
func hetznerCall(ctx context.Context, token, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, hetznerBase+path, rd)
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
		return fmt.Errorf("could not reach Hetzner Cloud: %w", cloudURLError(err))
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		msg := strings.TrimSpace(string(data))
		if json.Unmarshal(data, &e) == nil && e.Error.Message != "" {
			msg = e.Error.Message
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

// cloudURLError drops the request URL from a transport error.
func cloudURLError(err error) error {
	if ue, ok := err.(*url.Error); ok {
		return ue.Err
	}
	return err
}

func (hetznerProvider) Check(ctx context.Context, token string) error {
	// Listing locations needs only read access, which every token has.
	return hetznerCall(ctx, token, "GET", "/locations", nil, nil)
}

type hetznerLocation struct {
	Name        string `json:"name"`
	City        string `json:"city"`
	Country     string `json:"country"`
	Description string `json:"description"`
}

type hetznerPrice struct {
	Location     string `json:"location"`
	PriceMonthly struct {
		Gross string `json:"gross"`
	} `json:"price_monthly"`
}

type hetznerServerType struct {
	Name         string         `json:"name"`
	Cores        int            `json:"cores"`
	Memory       float64        `json:"memory"`
	Disk         int            `json:"disk"`
	CPUType      string         `json:"cpu_type"`
	Architecture string         `json:"architecture"`
	Deprecated   bool           `json:"deprecated"`
	Prices       []hetznerPrice `json:"prices"`
}

// Used only when Hetzner's API can't be asked; prices are estimates.
var hetznerFallbackSizes = []cloudSize{
	{Id: "cx22", Name: "CX22", CPUs: 2, MemoryGB: 4, DiskGB: 40, Prices: map[string]float64{"fsn1": 4.5, "nbg1": 4.5, "hel1": 4.5}},
	{Id: "cx32", Name: "CX32", CPUs: 4, MemoryGB: 8, DiskGB: 80, Prices: map[string]float64{"fsn1": 7.5, "nbg1": 7.5, "hel1": 7.5}},
	{Id: "cx42", Name: "CX42", CPUs: 8, MemoryGB: 16, DiskGB: 160, Prices: map[string]float64{"fsn1": 14, "nbg1": 14, "hel1": 14}},
}

func (p hetznerProvider) Options(ctx context.Context, token string) (cloudOptions, error) {
	var locs struct {
		Locations []hetznerLocation `json:"locations"`
	}
	if err := hetznerCall(ctx, token, "GET", "/locations", nil, &locs); err != nil {
		return cloudOptions{}, err
	}
	var types struct {
		ServerTypes []hetznerServerType `json:"server_types"`
	}
	opts := cloudOptions{Currency: "EUR", Live: true}
	for _, l := range locs.Locations {
		name := l.City
		if l.Country != "" {
			name += ", " + l.Country
		}
		if strings.TrimSpace(name) == "" || name == ", " {
			name = l.Description
		}
		opts.Regions = append(opts.Regions, cloudRegion{Id: l.Name, Name: name})
	}
	sort.SliceStable(opts.Regions, func(i, j int) bool { return opts.Regions[i].Id < opts.Regions[j].Id })

	if err := hetznerCall(ctx, token, "GET", "/server_types?per_page=50", nil, &types); err != nil || len(types.ServerTypes) == 0 {
		opts.Live = false
		opts.Sizes = hetznerFallbackSizes
	} else {
		for _, t := range types.ServerTypes {
			// Shared-CPU x86 plans with room for a coding agent.
			if t.Deprecated || t.Architecture != "x86" || t.CPUType != "shared" || t.Memory < 4 {
				continue
			}
			sz := cloudSize{Id: t.Name, Name: strings.ToUpper(t.Name), CPUs: t.Cores, MemoryGB: t.Memory, DiskGB: t.Disk, Prices: map[string]float64{}}
			for _, pr := range t.Prices {
				if v, err := strconv.ParseFloat(pr.PriceMonthly.Gross, 64); err == nil && v > 0 {
					sz.Prices[pr.Location] = v
				}
			}
			if len(sz.Prices) > 0 {
				opts.Sizes = append(opts.Sizes, sz)
			}
		}
		opts.Sizes = curateSizes(opts.Sizes, "cx22", 4)
	}
	opts.Regions = onlyRegionsWithSizes(opts.Regions, opts.Sizes)
	opts.DefaultRegion = pickDefault(opts.Regions, "fsn1")
	opts.DefaultSize = cheapestOrPreferred(opts.Sizes, "cx22", opts.DefaultRegion)
	return opts, nil
}

// minPrice is the lowest monthly price of a size across its regions.
func minPrice(s cloudSize) float64 {
	best := 0.0
	for _, v := range s.Prices {
		if best == 0 || v < best {
			best = v
		}
	}
	return best
}

// curateSizes keeps the few cheapest sizes (and always the preferred one if
// it exists), cheapest first.
func curateSizes(sizes []cloudSize, preferred string, max int) []cloudSize {
	sort.SliceStable(sizes, func(i, j int) bool {
		if a, b := minPrice(sizes[i]), minPrice(sizes[j]); a != b {
			return a < b
		}
		return sizes[i].Id < sizes[j].Id
	})
	var out []cloudSize
	for _, sz := range sizes {
		if len(out) < max {
			out = append(out, sz)
		} else if sz.Id == preferred {
			out[len(out)-1] = sz
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return minPrice(out[i]) < minPrice(out[j]) })
	return out
}

func onlyRegionsWithSizes(regions []cloudRegion, sizes []cloudSize) []cloudRegion {
	var out []cloudRegion
	for _, r := range regions {
		for _, sz := range sizes {
			if _, ok := sz.Prices[r.Id]; ok {
				out = append(out, r)
				break
			}
		}
	}
	return out
}

func pickDefault(regions []cloudRegion, preferred string) string {
	for _, r := range regions {
		if r.Id == preferred {
			return preferred
		}
	}
	if len(regions) > 0 {
		return regions[0].Id
	}
	return ""
}

func cheapestOrPreferred(sizes []cloudSize, preferred, region string) string {
	best, bestPrice := "", 0.0
	for _, sz := range sizes {
		price, ok := sz.Prices[region]
		if !ok {
			continue
		}
		if sz.Id == preferred {
			return preferred
		}
		if best == "" || price < bestPrice {
			best, bestPrice = sz.Id, price
		}
	}
	return best
}

type hetznerServer struct {
	ID        int64  `json:"id"`
	Status    string `json:"status"`
	PublicNet struct {
		IPv4 struct {
			IP string `json:"ip"`
		} `json:"ipv4"`
	} `json:"public_net"`
}

func (s hetznerServer) toServer() cloudServer {
	status := "other"
	switch s.Status {
	case "initializing", "starting":
		status = "building"
	case "running":
		status = "running"
	}
	return cloudServer{ID: strconv.FormatInt(s.ID, 10), Status: status, IPv4: s.PublicNet.IPv4.IP}
}

func (p hetznerProvider) Create(ctx context.Context, token string, spec cloudCreateSpec) (cloudServer, error) {
	labels := map[string]string{"managed-by": "overseer", "overseer-machine": spec.MachineId}
	rules := []map[string]any{}
	if !spec.CloseSSH {
		rules = append(rules, map[string]any{
			"direction": "in", "protocol": "tcp", "port": "22",
			"source_ips":  []string{"0.0.0.0/0", "::/0"},
			"description": "SSH",
		})
	}
	var fw struct {
		Firewall struct {
			ID int64 `json:"id"`
		} `json:"firewall"`
	}
	if err := hetznerCall(ctx, token, "POST", "/firewalls", map[string]any{
		"name": "overseer-" + spec.MachineId, "labels": labels, "rules": rules,
	}, &fw); err != nil {
		return cloudServer{}, err
	}
	fwID := strconv.FormatInt(fw.Firewall.ID, 10)

	var created struct {
		Server hetznerServer `json:"server"`
	}
	err := hetznerCall(ctx, token, "POST", "/servers", map[string]any{
		"name":               spec.Hostname,
		"server_type":        spec.Size,
		"image":              "ubuntu-24.04",
		"location":           spec.Region,
		"user_data":          spec.UserData,
		"start_after_create": true,
		"labels":             labels,
		"firewalls":          []map[string]any{{"firewall": fw.Firewall.ID}},
		"public_net":         map[string]any{"enable_ipv4": true, "enable_ipv6": true},
	}, &created)
	if err != nil {
		// Don't leave the firewall behind when the server wasn't created.
		hetznerCall(context.WithoutCancel(ctx), token, "DELETE", "/firewalls/"+fwID, nil, nil)
		return cloudServer{}, err
	}
	srv := created.Server.toServer()
	srv.FirewallID = fwID
	return srv, nil
}

func (p hetznerProvider) Get(ctx context.Context, token, serverID string) (cloudServer, error) {
	var out struct {
		Server hetznerServer `json:"server"`
	}
	if err := hetznerCall(ctx, token, "GET", "/servers/"+url.PathEscape(serverID), nil, &out); err != nil {
		if ae, ok := err.(*cloudAPIError); ok && ae.Status == http.StatusNotFound {
			return cloudServer{}, errCloudGone
		}
		return cloudServer{}, err
	}
	return out.Server.toServer(), nil
}

func (p hetznerProvider) Delete(ctx context.Context, token, serverID, firewallID string) error {
	err := hetznerCall(ctx, token, "DELETE", "/servers/"+url.PathEscape(serverID), nil, nil)
	if ae, ok := err.(*cloudAPIError); ok && ae.Status == http.StatusNotFound {
		err = nil
	}
	if err != nil {
		return err
	}
	if firewallID == "" {
		return nil
	}
	// The firewall can't be deleted while the server still uses it; the
	// server goes away within a few seconds.
	var last error
	for i := 0; i < cloudDeleteRetries; i++ {
		last = hetznerCall(ctx, token, "DELETE", "/firewalls/"+url.PathEscape(firewallID), nil, nil)
		if last == nil {
			return nil
		}
		if ae, ok := last.(*cloudAPIError); ok && ae.Status == http.StatusNotFound {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(cloudDeleteWait):
		}
	}
	// The server is gone; a leftover empty firewall costs nothing.
	_ = last
	return nil
}
