package top

import (
	"bytes"
	"unicode/utf8"
)

// KeyKind names a decoded key press.
type KeyKind int

const (
	KeyRune KeyKind = iota
	KeyEnter
	KeyEsc
	KeyUp
	KeyDown
	KeyLeft
	KeyRight
	KeyPgUp
	KeyPgDn
	KeyHome
	KeyEnd
	KeyBackspace
	KeyDelete
	KeyTab
	KeyShiftTab
	KeyCtrlC
	KeyCtrlU
	KeyCtrlW
	KeyPaste
)

// Key is one decoded key press. R is set for KeyRune, Text for KeyPaste.
type Key struct {
	Kind KeyKind
	R    rune
	Text string
}

var (
	pasteStart = []byte("\x1b[200~")
	pasteEnd   = []byte("\x1b[201~")
)

// ParseKeys decodes raw terminal input into keys. It returns the bytes it
// could not decode yet (a split escape sequence or UTF-8 character), to be
// prepended to the next read. A lone ESC at the end of the input is the
// Escape key, since terminals deliver whole sequences in one read.
func ParseKeys(b []byte) (keys []Key, rest []byte) {
	for len(b) > 0 {
		c := b[0]
		switch {
		case c == 0x1b:
			if len(b) == 1 {
				keys = append(keys, Key{Kind: KeyEsc})
				b = b[1:]
				continue
			}
			if bytes.HasPrefix(b, pasteStart) {
				end := bytes.Index(b, pasteEnd)
				if end < 0 {
					return keys, b // wait for the rest of the paste
				}
				keys = append(keys, Key{Kind: KeyPaste, Text: string(b[len(pasteStart):end])})
				b = b[end+len(pasteEnd):]
				continue
			}
			if b[1] != '[' && b[1] != 'O' {
				// Alt+key or a stray escape: treat as Escape, keep the rest.
				keys = append(keys, Key{Kind: KeyEsc})
				b = b[1:]
				continue
			}
			k, n, ok := parseCSI(b)
			if !ok {
				if len(b) < 16 {
					return keys, b // incomplete sequence: wait for more
				}
				b = b[2:]
				continue
			}
			if k.Kind != -1 {
				keys = append(keys, k)
			}
			b = b[n:]
		case c == '\r' || c == '\n':
			keys = append(keys, Key{Kind: KeyEnter})
			if c == '\r' && len(b) > 1 && b[1] == '\n' {
				b = b[1:]
			}
			b = b[1:]
		case c == 0x7f || c == 0x08:
			keys = append(keys, Key{Kind: KeyBackspace})
			b = b[1:]
		case c == 0x03:
			keys = append(keys, Key{Kind: KeyCtrlC})
			b = b[1:]
		case c == 0x04: // Ctrl-D quits like Ctrl-C
			keys = append(keys, Key{Kind: KeyCtrlC})
			b = b[1:]
		case c == 0x15:
			keys = append(keys, Key{Kind: KeyCtrlU})
			b = b[1:]
		case c == 0x17:
			keys = append(keys, Key{Kind: KeyCtrlW})
			b = b[1:]
		case c == '\t':
			keys = append(keys, Key{Kind: KeyTab})
			b = b[1:]
		case c < 0x20:
			b = b[1:] // other control characters are ignored
		default:
			if !utf8.FullRune(b) {
				return keys, b
			}
			r, n := utf8.DecodeRune(b)
			if r != utf8.RuneError {
				keys = append(keys, Key{Kind: KeyRune, R: r})
			}
			b = b[n:]
		}
	}
	return keys, nil
}

// parseCSI decodes ESC [ ... and ESC O ... sequences. Kind -1 with ok means
// a recognised but ignored sequence.
func parseCSI(b []byte) (Key, int, bool) {
	if len(b) < 3 {
		return Key{}, 0, false
	}
	if b[1] == 'O' {
		switch b[2] {
		case 'A':
			return Key{Kind: KeyUp}, 3, true
		case 'B':
			return Key{Kind: KeyDown}, 3, true
		case 'C':
			return Key{Kind: KeyRight}, 3, true
		case 'D':
			return Key{Kind: KeyLeft}, 3, true
		case 'H':
			return Key{Kind: KeyHome}, 3, true
		case 'F':
			return Key{Kind: KeyEnd}, 3, true
		}
		return Key{Kind: -1}, 3, true
	}
	// ESC [ params final
	i := 2
	for i < len(b) && ((b[i] >= '0' && b[i] <= '9') || b[i] == ';' || b[i] == '?' || b[i] == '<' || b[i] == '=' || b[i] == '>') {
		i++
	}
	if i >= len(b) {
		return Key{}, 0, false
	}
	params := string(b[2:i])
	final := b[i]
	n := i + 1
	switch final {
	case 'A':
		return Key{Kind: KeyUp}, n, true
	case 'B':
		return Key{Kind: KeyDown}, n, true
	case 'C':
		return Key{Kind: KeyRight}, n, true
	case 'D':
		return Key{Kind: KeyLeft}, n, true
	case 'H':
		return Key{Kind: KeyHome}, n, true
	case 'F':
		return Key{Kind: KeyEnd}, n, true
	case 'Z':
		return Key{Kind: KeyShiftTab}, n, true
	case '~':
		switch params {
		case "1", "7":
			return Key{Kind: KeyHome}, n, true
		case "4", "8":
			return Key{Kind: KeyEnd}, n, true
		case "3":
			return Key{Kind: KeyDelete}, n, true
		case "5":
			return Key{Kind: KeyPgUp}, n, true
		case "6":
			return Key{Kind: KeyPgDn}, n, true
		}
	}
	return Key{Kind: -1}, n, true
}
