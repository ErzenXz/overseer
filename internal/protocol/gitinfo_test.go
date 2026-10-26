package protocol

import "testing"

func TestNormalizeRemote(t *testing.T) {
	cases := []struct{ in, key, clean string }{
		{"git@github.com:acme/api.git", "github.com/acme/api", "github.com:acme/api.git"},
		{"https://github.com/acme/api.git", "github.com/acme/api", "https://github.com/acme/api.git"},
		{"https://github.com/acme/api", "github.com/acme/api", "https://github.com/acme/api"},
		{"ssh://git@GitHub.com/acme/api.git/", "github.com/acme/api", "ssh://GitHub.com/acme/api.git/"},
		// Credentials never leave the machine.
		{"https://user:s3cret@gitlab.com/acme/api.git", "gitlab.com/acme/api", "https://gitlab.com/acme/api.git"},
		{"https://x-access-token:abc@github.com/acme/api.git", "github.com/acme/api", "https://github.com/acme/api.git"},
		{"/srv/git/api.git", "/srv/git/api", "/srv/git/api.git"},
		{"", "", ""},
		{"   ", "", ""},
	}
	for _, c := range cases {
		key, clean := NormalizeRemote(c.in)
		if key != c.key || clean != c.clean {
			t.Errorf("NormalizeRemote(%q) = %q, %q; want %q, %q", c.in, key, clean, c.key, c.clean)
		}
	}
	// ssh and https forms of one repo compare equal.
	a, _ := NormalizeRemote("git@github.com:acme/api.git")
	b, _ := NormalizeRemote("https://github.com/acme/api")
	if a != b {
		t.Errorf("ssh %q != https %q", a, b)
	}
}
