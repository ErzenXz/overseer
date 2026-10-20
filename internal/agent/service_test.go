package agent

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestServicePathDropsRelativeAndDuplicateEntries(t *testing.T) {
	sep := string(os.PathListSeparator)
	abs := filepath.Join(t.TempDir(), "bin")
	t.Setenv("PATH", strings.Join([]string{"", ".", "relative/bin", abs, abs}, sep))
	got := filepath.SplitList(servicePath())
	count := 0
	for _, entry := range got {
		if !filepath.IsAbs(entry) {
			t.Fatalf("relative PATH entry %q kept in %v", entry, got)
		}
		if entry == abs {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected %s exactly once, got %d in %v", abs, count, got)
	}
}

func TestSystemdUnitQuotesPathsWithSpaces(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix service definition")
	}
	t.Setenv("PATH", "/opt/my tools/bin:/usr/bin")
	unit := systemdUnitFor(`/home/a b/.overseer/bin/over"seer`, "")
	if !strings.Contains(unit, `ExecStart="/home/a b/.overseer/bin/over\"seer" agent run`) {
		t.Fatalf("ExecStart not quoted/escaped:\n%s", unit)
	}
	if !strings.Contains(unit, `Environment="PATH=`) || !strings.Contains(unit, "/opt/my tools/bin") {
		t.Fatalf("PATH not recorded:\n%s", unit)
	}
	if strings.Contains(unit, "User=") {
		t.Fatalf("user units must not set User=:\n%s", unit)
	}
}

func TestLaunchdPlistIsValidXMLWithHostilePaths(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix service definition")
	}
	t.Setenv("PATH", "/a&b/bin:/usr/bin")
	plist := fmt.Sprintf(launchdPlist, xmlEscape("/Users/x/<odd>&dir/overseer"), xmlEscape(servicePath()), xmlEscape("/tmp/a.log"), xmlEscape("/tmp/a.log"))
	decoder := xml.NewDecoder(strings.NewReader(plist))
	decoder.Strict = true
	decoder.Entity = xml.HTMLEntity
	for {
		if _, err := decoder.Token(); err != nil {
			if err.Error() == "EOF" {
				break
			}
			t.Fatalf("plist is not valid XML: %v\n%s", err, plist)
		}
	}
	if !strings.Contains(plist, "&lt;odd&gt;&amp;dir") {
		t.Fatalf("path not escaped:\n%s", plist)
	}
}

func TestWindowsRunnerQuotesAndHidesTask(t *testing.T) {
	runner := windowsRunner(`C:\Users\O'Brien\AppData\Local\Overseer\bin\overseer.exe`)
	if !strings.Contains(runner, `& 'C:\Users\O''Brien\AppData\Local\Overseer\bin\overseer.exe' agent run`) {
		t.Fatalf("exe not quoted for PowerShell:\n%s", runner)
	}
	if !strings.Contains(runner, "$env:OVERSEER_WINDOWS_TASK = 'OverseerAgent'") {
		t.Fatalf("updater task name missing:\n%s", runner)
	}
}
