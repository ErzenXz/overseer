package agent

import "testing"

func TestClassifyLinuxSession(t *testing.T) {
	cases := []struct {
		env, logind string
		x11         bool
		wayland     string
		want        string
	}{
		{"x11", "", false, "", "x11"},
		{"Wayland", "x11", true, "", "wayland"},
		{"tty", "wayland", false, "", "wayland"},
		{"", "", true, "", "x11"},
		{"", "", true, "wayland-0", "wayland"},
		{"", "", false, "", "headless"},
		{"tty", "tty", false, "", "headless"},
	}
	for _, c := range cases {
		if got := classifyLinuxSession(c.env, c.logind, c.x11, c.wayland); got != c.want {
			t.Errorf("classify(%q,%q,%v,%q) = %q, want %q", c.env, c.logind, c.x11, c.wayland, got, c.want)
		}
	}
}

func TestPickPackageManager(t *testing.T) {
	has := func(names ...string) func(string) bool {
		return func(n string) bool {
			for _, x := range names {
				if x == n {
					return true
				}
			}
			return false
		}
	}
	for _, c := range []struct {
		have []string
		want string
	}{
		{[]string{"apt-get", "dnf"}, "apt"},
		{[]string{"dnf", "yum"}, "dnf"},
		{[]string{"yum"}, "yum"},
		{[]string{"pacman"}, "pacman"},
		{[]string{"zypper"}, "zypper"},
		{nil, ""},
	} {
		if got := pickPackageManager(has(c.have...)); got != c.want {
			t.Errorf("pickPackageManager(%v) = %q, want %q", c.have, got, c.want)
		}
	}
}

func TestParseKeyValues(t *testing.T) {
	m := parseKeyValues("Type=wayland\nDesktop=gnome\nDisplay=\nbogus line\n")
	if m["Type"] != "wayland" || m["Desktop"] != "gnome" || m["Display"] != "" {
		t.Fatalf("unexpected: %v", m)
	}
}
