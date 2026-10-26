package top

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// runeWidth is the number of terminal cells a rune takes: 0 for combining
// marks and joiners, 2 for East Asian wide characters and emoji, else 1.
func runeWidth(r rune) int {
	switch {
	case r == 0 || r == 0x200d || (r >= 0xfe00 && r <= 0xfe0f):
		return 0
	case r < 0x20 || (r >= 0x7f && r < 0xa0):
		return 0
	case unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r):
		return 0
	case r >= 0x1100 && r <= 0x115f,
		r >= 0x2e80 && r <= 0xa4cf,
		r >= 0xac00 && r <= 0xd7a3,
		r >= 0xf900 && r <= 0xfaff,
		r >= 0xfe30 && r <= 0xfe6f,
		r >= 0xff00 && r <= 0xff60,
		r >= 0xffe0 && r <= 0xffe6,
		r >= 0x1f300 && r <= 0x1f64f,
		r >= 0x1f900 && r <= 0x1f9ff,
		r >= 0x20000 && r <= 0x3fffd:
		return 2
	}
	return 1
}

func strWidth(s string) int {
	n := 0
	for _, r := range s {
		n += runeWidth(r)
	}
	return n
}

// oneLine turns arbitrary text into a single printable line: control
// characters (including escape sequences' ESC) become spaces and runs of
// whitespace collapse. Anything from the hub or an agent goes through this
// before it reaches the terminal, so it can never inject escape codes.
func oneLine(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if r == utf8.RuneError || unicode.IsSpace(r) || unicode.IsControl(r) {
			if !space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = true
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return strings.TrimRight(b.String(), " ")
}

// truncate fits s into w cells, ending in an ellipsis when it was cut.
func truncate(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if strWidth(s) <= w {
		return s
	}
	if w == 1 {
		return "…"
	}
	var b strings.Builder
	n := 0
	for _, r := range s {
		rw := runeWidth(r)
		if n+rw > w-1 {
			break
		}
		b.WriteRune(r)
		n += rw
	}
	return b.String() + "…"
}

// truncateMiddle keeps both ends of a long path-like string.
func truncateMiddle(s string, w int) string {
	if strWidth(s) <= w || w < 5 {
		return truncate(s, w)
	}
	r := []rune(s)
	left := (w - 1) / 2
	right := w - 1 - left
	return string(r[:left]) + "…" + string(r[len(r)-right:])
}

func padRight(s string, w int) string {
	if d := w - strWidth(s); d > 0 {
		return s + strings.Repeat(" ", d)
	}
	return s
}

func padLeft(s string, w int) string {
	if d := w - strWidth(s); d > 0 {
		return strings.Repeat(" ", d) + s
	}
	return s
}

// wrap word-wraps text to w cells, keeping paragraph breaks and splitting
// words longer than a line. Control characters other than newline are
// replaced.
func wrap(s string, w int) []string {
	if w < 4 {
		w = 4
	}
	var out []string
	for _, para := range strings.Split(strings.ReplaceAll(s, "\r", ""), "\n") {
		para = strings.Map(func(r rune) rune {
			if r == '\t' {
				return ' '
			}
			if unicode.IsControl(r) || r == utf8.RuneError {
				return -1
			}
			return r
		}, para)
		if strings.TrimSpace(para) == "" {
			out = append(out, "")
			continue
		}
		indent := ""
		trimmed := strings.TrimLeft(para, " ")
		if n := len(para) - len(trimmed); n > 0 && n < w/2 {
			indent = para[:n]
		}
		cur := indent
		for _, word := range strings.Fields(trimmed) {
			for strWidth(word) > w-strWidth(indent) {
				if strWidth(cur) > strWidth(indent) {
					out = append(out, cur)
					cur = indent
				}
				cut, rest := splitWidth(word, w-strWidth(indent))
				out = append(out, indent+cut)
				word = rest
			}
			switch {
			case strWidth(cur) == strWidth(indent):
				cur += word
			case strWidth(cur)+1+strWidth(word) <= w:
				cur += " " + word
			default:
				out = append(out, cur)
				cur = indent + word
			}
		}
		out = append(out, cur)
	}
	// trim trailing blank lines
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

func splitWidth(s string, w int) (head, rest string) {
	n := 0
	for i, r := range s {
		rw := runeWidth(r)
		if n+rw > w {
			if i == 0 {
				return s[:utf8.RuneLen(r)], s[utf8.RuneLen(r):]
			}
			return s[:i], s[i:]
		}
		n += rw
	}
	return s, ""
}

// --- styled lines ---

// Seg is a run of text with one SGR style ("" for none).
type Seg struct {
	T string
	S string
}

// Line is one screen row made of styled segments.
type Line []Seg

func (l Line) Width() int {
	n := 0
	for _, s := range l {
		n += strWidth(s.T)
	}
	return n
}

// Plain is the line without styling.
func (l Line) Plain() string {
	var b strings.Builder
	for _, s := range l {
		b.WriteString(s.T)
	}
	return b.String()
}

// Fit cuts the line to w cells (no ellipsis; callers truncate fields first).
func (l Line) Fit(w int) Line {
	var out Line
	left := w
	for _, s := range l {
		if left <= 0 {
			break
		}
		if sw := strWidth(s.T); sw <= left {
			out = append(out, s)
			left -= sw
			continue
		}
		head, _ := splitWidth(s.T, left)
		out = append(out, Seg{head, s.S})
		break
	}
	return out
}

// PadTo extends the line with spaces (in style st) to w cells.
func (l Line) PadTo(w int, st string) Line {
	if d := w - l.Width(); d > 0 {
		return append(l, Seg{strings.Repeat(" ", d), st})
	}
	return l
}

// With adds a style to every segment (used for the selected row).
func (l Line) With(st string) Line {
	out := make(Line, len(l))
	for i, s := range l {
		switch {
		case s.S == "":
			s.S = st
		default:
			s.S = st + ";" + s.S
		}
		out[i] = s
	}
	return out
}

// Render writes the line, with colour codes when color is set. Style
// attributes that are not colours (bold, dim, reverse) are kept without it.
func (l Line) Render(color bool) string {
	var b strings.Builder
	for _, s := range l {
		st := s.S
		if !color {
			st = stripColor(st)
		}
		if st == "" {
			b.WriteString(s.T)
			continue
		}
		b.WriteString("\x1b[" + st + "m" + s.T + "\x1b[0m")
	}
	return b.String()
}

// stripColor keeps only bold(1), dim(2) and reverse(7) from an SGR list.
func stripColor(st string) string {
	var keep []string
	parts := strings.Split(st, ";")
	for i := 0; i < len(parts); i++ {
		switch p := parts[i]; p {
		case "1", "2", "7":
			keep = append(keep, p)
		case "38", "48":
			if i+1 < len(parts) && parts[i+1] == "5" {
				i += 2
			}
		}
	}
	return strings.Join(keep, ";")
}
