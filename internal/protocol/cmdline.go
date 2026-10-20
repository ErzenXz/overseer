package protocol

import (
	"fmt"
	"strings"
)

// SplitCommandLine splits a command line into words, honouring single and
// double quotes and backslash escapes (no variable expansion). The hub and
// the device both use it, so a command the hub accepts is one the device
// can run.
func SplitCommandLine(s string) ([]string, error) {
	var words []string
	var cur strings.Builder
	inWord := false
	var quote rune
	escaped := false
	for _, r := range s {
		switch {
		case escaped:
			cur.WriteRune(r)
			escaped = false
		case r == '\\' && quote != '\'':
			escaped, inWord = true, true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote, inWord = r, true
		case r == ' ' || r == '\t' || r == '\n':
			if inWord {
				words = append(words, cur.String())
				cur.Reset()
				inWord = false
			}
		default:
			cur.WriteRune(r)
			inWord = true
		}
	}
	if quote != 0 || escaped {
		return nil, fmt.Errorf("unterminated quote in command")
	}
	if inWord {
		words = append(words, cur.String())
	}
	return words, nil
}

// JoinCommandLine is the inverse of SplitCommandLine: words that need it are
// single-quoted, so SplitCommandLine(JoinCommandLine(w)) == w.
func JoinCommandLine(words []string) string {
	out := make([]string, len(words))
	for i, w := range words {
		if w != "" && strings.IndexFunc(w, needsQuote) < 0 {
			out[i] = w
			continue
		}
		out[i] = "'" + strings.ReplaceAll(w, "'", `'\''`) + "'"
	}
	return strings.Join(out, " ")
}

func needsQuote(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return false
	}
	return !strings.ContainsRune("-_./=:,+@%", r)
}
