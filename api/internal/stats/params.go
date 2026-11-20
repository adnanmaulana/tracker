package stats

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"time"
)

type Interval string

const (
	Hour  Interval = "hour"
	Day   Interval = "day"
	Week  Interval = "week" // weeks start on Monday, like Postgres date_trunc
	Month Interval = "month"
)

const maxBuckets = 1000

// Range is a half-open time window [From, To) plus the previous window of equal length
// [PrevFrom, From), used for "vs previous period" comparisons.
type Range struct {
	From, To, PrevFrom time.Time
	Loc                *time.Location
	Interval           Interval
}

// ParseRange reads range, from, to, tz and interval from the query string.
//
//	range=today|yesterday|24h|7d|30d|90d|12mo   (default 30d)
//	from=2026-11-01&to=2026-11-15                (inclusive dates, overrides range)
//	tz=Asia/Jakarta                              (default UTC; used for day boundaries)
//	interval=hour|day|week|month                 (default picked from range length)
func ParseRange(q url.Values, now time.Time) (Range, error) {
	loc := time.UTC
	if tz := q.Get("tz"); tz != "" && tz != "UTC" {
		l, err := time.LoadLocation(tz)
		if err != nil || tz == "Local" {
			return Range{}, fmt.Errorf("invalid tz %q", tz)
		}
		loc = l
	}
	now = now.In(loc)
	today := startOfDay(now)
	r := Range{Loc: loc}

	if f, t := q.Get("from"), q.Get("to"); f != "" || t != "" {
		if f == "" || t == "" {
			return Range{}, errors.New("from and to must be used together")
		}
		fd, err1 := time.ParseInLocation(time.DateOnly, f, loc)
		td, err2 := time.ParseInLocation(time.DateOnly, t, loc)
		if err1 != nil || err2 != nil {
			return Range{}, errors.New("from/to must be YYYY-MM-DD")
		}
		if td.Before(fd) {
			return Range{}, errors.New("to is before from")
		}
		days := int(math.Round(td.Sub(fd).Hours()/24)) + 1
		if days > 731 {
			return Range{}, errors.New("range too long: max 2 years")
		}
		r.From, r.To, r.PrevFrom = fd, td.AddDate(0, 0, 1), fd.AddDate(0, 0, -days)
	} else {
		switch rng := q.Get("range"); rng {
		case "today":
			r.From, r.To, r.PrevFrom = today, today.AddDate(0, 0, 1), today.AddDate(0, 0, -1)
		case "yesterday":
			r.From, r.To, r.PrevFrom = today.AddDate(0, 0, -1), today, today.AddDate(0, 0, -2)
		case "24h":
			hour := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, loc)
			r.To = hour.Add(time.Hour)
			r.From = r.To.Add(-24 * time.Hour)
			r.PrevFrom = r.From.Add(-24 * time.Hour)
		case "", "7d", "30d", "90d":
			n := map[string]int{"": 30, "7d": 7, "30d": 30, "90d": 90}[rng]
			r.From, r.To = today.AddDate(0, 0, -(n-1)), today.AddDate(0, 0, 1)
			r.PrevFrom = r.From.AddDate(0, 0, -n)
		case "12mo":
			month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
			r.From, r.To = month.AddDate(0, -11, 0), month.AddDate(0, 1, 0)
			r.PrevFrom = r.From.AddDate(0, -12, 0)
		default:
			return Range{}, fmt.Errorf("invalid range %q", rng)
		}
	}

	switch iv := Interval(q.Get("interval")); iv {
	case "":
		r.Interval = autoInterval(r.To.Sub(r.From))
	case Hour, Day, Week, Month:
		r.Interval = iv
	default:
		return Range{}, fmt.Errorf("invalid interval %q", iv)
	}
	if n := len(r.Buckets()); n > maxBuckets {
		return Range{}, fmt.Errorf("interval too fine for range (%d buckets, max %d)", n, maxBuckets)
	}
	return r, nil
}

func autoInterval(d time.Duration) Interval {
	switch {
	case d <= 48*time.Hour:
		return Hour
	case d <= 92*24*time.Hour:
		return Day
	default:
		return Month
	}
}

// Buckets returns the start of every interval bucket overlapping [From, To), in r.Loc.
// They line up with Postgres date_trunc(interval, ts, tz).
func (r Range) Buckets() []time.Time {
	var out []time.Time
	for t := truncate(r.From.In(r.Loc), r.Interval); t.Before(r.To) && len(out) <= maxBuckets; t = next(t, r.Interval) {
		out = append(out, t)
	}
	return out
}

func truncate(t time.Time, iv Interval) time.Time {
	switch iv {
	case Hour:
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location())
	case Week:
		d := startOfDay(t)
		return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
	case Month:
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
	default:
		return startOfDay(t)
	}
}

func next(t time.Time, iv Interval) time.Time {
	switch iv {
	case Hour:
		return t.Add(time.Hour)
	case Week:
		return t.AddDate(0, 0, 7)
	case Month:
		return t.AddDate(0, 1, 0)
	default:
		return t.AddDate(0, 0, 1)
	}
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
