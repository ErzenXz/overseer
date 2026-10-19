package hub

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// cronSchedule is a parsed 5-field cron expression (minute hour day-of-month
// month day-of-week), evaluated in the time zone of the times passed to next.
type cronSchedule struct {
	minute, hour, dom, month, dow uint64 // bit n set = value n allowed
	domStar, dowStar              bool   // field began with '*' (Vixie OR rule)
}

var cronMacros = map[string]string{
	"@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
}

var (
	monthNames = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
		"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
	dowNames = map[string]int{"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
)

func parseCron(spec string) (*cronSchedule, error) {
	spec = strings.TrimSpace(spec)
	if m, ok := cronMacros[strings.ToLower(spec)]; ok {
		spec = m
	}
	fields := strings.Fields(spec)
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron schedule needs 5 fields (minute hour day month weekday), got %d", len(fields))
	}
	var c cronSchedule
	var err error
	if c.minute, err = parseCronField(fields[0], 0, 59, nil); err != nil {
		return nil, fmt.Errorf("minute: %w", err)
	}
	if c.hour, err = parseCronField(fields[1], 0, 23, nil); err != nil {
		return nil, fmt.Errorf("hour: %w", err)
	}
	if c.dom, err = parseCronField(fields[2], 1, 31, nil); err != nil {
		return nil, fmt.Errorf("day of month: %w", err)
	}
	if c.month, err = parseCronField(fields[3], 1, 12, monthNames); err != nil {
		return nil, fmt.Errorf("month: %w", err)
	}
	// Weekday accepts 0-7, both 0 and 7 meaning Sunday.
	if c.dow, err = parseCronField(fields[4], 0, 7, dowNames); err != nil {
		return nil, fmt.Errorf("weekday: %w", err)
	}
	if c.dow&(1<<7) != 0 {
		c.dow |= 1
	}
	c.domStar = strings.HasPrefix(fields[2], "*")
	c.dowStar = strings.HasPrefix(fields[4], "*")
	return &c, nil
}

// parseCronField handles "*", "a", "a-b", lists "a,b" and steps "*/n",
// "a-b/n", "a/n".
func parseCronField(field string, lo, hi int, names map[string]int) (uint64, error) {
	var bits uint64
	value := func(s string) (int, error) {
		if n, ok := names[strings.ToLower(s)]; ok {
			return n, nil
		}
		n, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("bad value %q", s)
		}
		if n < lo || n > hi {
			return 0, fmt.Errorf("%d out of range %d-%d", n, lo, hi)
		}
		return n, nil
	}
	for _, part := range strings.Split(field, ",") {
		if part == "" {
			return 0, fmt.Errorf("empty list item in %q", field)
		}
		rangePart, step := part, 1
		if i := strings.IndexByte(part, '/'); i >= 0 {
			n, err := strconv.Atoi(part[i+1:])
			if err != nil || n < 1 {
				return 0, fmt.Errorf("bad step in %q", part)
			}
			rangePart, step = part[:i], n
		}
		start, end := lo, hi
		switch {
		case rangePart == "*":
		case strings.Contains(rangePart, "-"):
			ends := strings.SplitN(rangePart, "-", 2)
			var err error
			if start, err = value(ends[0]); err != nil {
				return 0, err
			}
			if end, err = value(ends[1]); err != nil {
				return 0, err
			}
			if start > end {
				return 0, fmt.Errorf("range %q runs backwards", rangePart)
			}
		default:
			v, err := value(rangePart)
			if err != nil {
				return 0, err
			}
			start = v
			if step == 1 {
				end = v // a plain value; "a/n" keeps end = hi
			}
		}
		for v := start; v <= end; v += step {
			bits |= 1 << uint(v)
		}
	}
	return bits, nil
}

func (c *cronSchedule) dayMatches(t time.Time) bool {
	domOk := c.dom&(1<<uint(t.Day())) != 0
	dowOk := c.dow&(1<<uint(t.Weekday())) != 0
	switch {
	case c.domStar && c.dowStar:
		return true
	case c.domStar:
		return dowOk
	case c.dowStar:
		return domOk
	}
	return domOk || dowOk // both restricted: either matches (Vixie cron)
}

// next returns the first matching minute strictly after `after`, or the zero
// time if none exists within five years (e.g. "0 0 31 2 *").
func (c *cronSchedule) next(after time.Time) time.Time {
	loc := after.Location()
	t := after.Truncate(time.Minute).Add(time.Minute)
	limit := t.AddDate(5, 0, 0)
	for t.Before(limit) {
		prev := t
		switch {
		case c.month&(1<<uint(t.Month())) == 0:
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc)
		case !c.dayMatches(t):
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc)
		case c.hour&(1<<uint(t.Hour())) == 0:
			t = t.Add(time.Duration(60-t.Minute()) * time.Minute)
		case c.minute&(1<<uint(t.Minute())) == 0:
			t = t.Add(time.Minute)
		default:
			return t
		}
		// DST transitions can make time.Date land at or before where we
		// were; always make progress.
		if !t.After(prev) {
			t = prev.Add(time.Minute)
		}
	}
	return time.Time{}
}
