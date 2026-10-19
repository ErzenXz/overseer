package agent

import (
	"fmt"
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// maxDiffCells bounds the LCS table; past it the changed region is shown as a
// plain remove-all/add-all block.
const maxDiffCells = 4_000_000

// fileDiff builds a unified-style diff of oldText -> newText for display,
// with addition/deletion counts.
func fileDiff(path, oldText, newText string) protocol.ThreadToolFile {
	a := diffLines(oldText)
	b := diffLines(newText)

	// Trim the common prefix/suffix so the quadratic part only sees the
	// changed region.
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf] == b[len(b)-1-suf] {
		suf++
	}
	am, bm := a[pre:len(a)-suf], b[pre:len(b)-suf]

	var ops []diffOp
	if len(am)*len(bm) <= maxDiffCells {
		ops = lcsDiff(am, bm)
	} else {
		for _, l := range am {
			ops = append(ops, diffOp{'-', l})
		}
		for _, l := range bm {
			ops = append(ops, diffOp{'+', l})
		}
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "--- a/%s\n+++ b/%s\n", path, path)
	ctxStart := max(0, pre-3)
	fmt.Fprintf(&sb, "@@ -%d,%d +%d,%d @@\n", ctxStart+1, len(a)-ctxStart, ctxStart+1, len(b)-ctxStart)
	for _, l := range a[ctxStart:pre] {
		sb.WriteString(" " + l + "\n")
	}
	adds, dels := 0, 0
	for _, op := range ops {
		switch op.kind {
		case '+':
			adds++
		case '-':
			dels++
		}
		sb.WriteByte(op.kind)
		sb.WriteString(op.line + "\n")
	}
	tail := a[len(a)-suf:]
	if len(tail) > 3 {
		tail = tail[:3]
	}
	for _, l := range tail {
		sb.WriteString(" " + l + "\n")
	}
	diff := sb.String()
	if len(diff) > toolOutputCap {
		diff = truncateUTF8(diff, toolOutputCap) + "\n… (diff truncated)\n"
	}
	return protocol.ThreadToolFile{Path: path, Additions: adds, Deletions: dels, Diff: diff}
}

type diffOp struct {
	kind byte // ' ', '+', '-'
	line string
}

func lcsDiff(a, b []string) []diffOp {
	n, m := len(a), len(b)
	// dp[i][j] = LCS length of a[i:], b[j:]
	dp := make([][]int32, n+1)
	for i := range dp {
		dp[i] = make([]int32, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else {
				dp[i][j] = max(dp[i+1][j], dp[i][j+1])
			}
		}
	}
	var ops []diffOp
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case a[i] == b[j]:
			ops = append(ops, diffOp{' ', a[i]})
			i++
			j++
		case dp[i+1][j] >= dp[i][j+1]:
			ops = append(ops, diffOp{'-', a[i]})
			i++
		default:
			ops = append(ops, diffOp{'+', b[j]})
			j++
		}
	}
	for ; i < n; i++ {
		ops = append(ops, diffOp{'-', a[i]})
	}
	for ; j < m; j++ {
		ops = append(ops, diffOp{'+', b[j]})
	}
	return ops
}

func diffLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

// unifiedDiffFile wraps an already-rendered unified diff with its counts.
func unifiedDiffFile(path, diff string) protocol.ThreadToolFile {
	adds, dels := 0, 0
	for _, l := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(l, "+++") || strings.HasPrefix(l, "---"):
		case strings.HasPrefix(l, "+"):
			adds++
		case strings.HasPrefix(l, "-"):
			dels++
		}
	}
	if len(diff) > toolOutputCap {
		diff = truncateUTF8(diff, toolOutputCap) + "\n… (diff truncated)\n"
	}
	return protocol.ThreadToolFile{Path: path, Additions: adds, Deletions: dels, Diff: diff}
}
