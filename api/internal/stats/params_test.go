package stats

import (
	"net/url"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 20, 15, 30, 0, 0, time.UTC)

func parse(t *testing.T, qs string) Range {
	t.Helper()
	q, _ := url.ParseQuery(qs)
	r, err := ParseRange(q, now)
	if err != nil {
		t.Fatalf("ParseRange(%q): %v", qs, err)
	}
	return r
}

func day(s string, loc *time.Location) time.Time {
	t, _ := time.ParseInLocation(time.DateOnly, s, loc)
	return t
}

func TestParseRangePresets(t *testing.T) {
	tests := []struct {
		qs                 string
		from, to, prevFrom time.Time
		interval           Interval
		buckets            int
	}{
		{"", day("2026-10-22", time.UTC), day("2026-11-21", time.UTC), day("2026-09-22", time.UTC), Day, 30},
		{"range=7d", day("2026-11-14", time.UTC), day("2026-11-21", time.UTC), day("2026-11-07", time.UTC), Day, 7},
		{"range=today", day("2026-11-20", time.UTC), day("2026-11-21", time.UTC), day("2026-11-19", time.UTC), Hour, 24},
		{"range=yesterday", day("2026-11-19", time.UTC), day("2026-11-20", time.UTC), day("2026-11-18", time.UTC), Hour, 24},
		{"range=24h",
			time.Date(2026, 11, 19, 16, 0, 0, 0, time.UTC), time.Date(2026, 11, 20, 16, 0, 0, 0, time.UTC),
			time.Date(2026, 11, 18, 16, 0, 0, 0, time.UTC), Hour, 24},
		{"range=12mo", day("2025-12-01", time.UTC), day("2026-12-01", time.UTC), day("2024-12-01", time.UTC), Month, 12},
		{"from=2026-11-01&to=2026-11-10", day("2026-11-01", time.UTC), day("2026-11-11", time.UTC), day("2026-10-22", time.UTC), Day, 10},
		{"range=7d&interval=hour", day("2026-11-14", time.UTC), day("2026-11-21", time.UTC), day("2026-11-07", time.UTC), Hour, 168},
	}
	for _, tt := range tests {
		t.Run(tt.qs, func(t *testing.T) {
			r := parse(t, tt.qs)
			if !r.From.Equal(tt.from) || !r.To.Equal(tt.to) || !r.PrevFrom.Equal(tt.prevFrom) {
				t.Errorf("got [%v, %v) prev %v", r.From, r.To, r.PrevFrom)
			}
			if r.Interval != tt.interval {
				t.Errorf("interval = %s, want %s", r.Interval, tt.interval)
			}
			if n := len(r.Buckets()); n != tt.buckets {
				t.Errorf("buckets = %d, want %d", n, tt.buckets)
			}
		})
	}
}

func TestParseRangeTimezone(t *testing.T) {
	jkt, _ := time.LoadLocation("Asia/Jakarta") // UTC+7: 15:30 UTC is 22:30 local, same day
	r := parse(t, "range=today&tz=Asia/Jakarta")
	if !r.From.Equal(day("2026-11-20", jkt)) {
		t.Errorf("from = %v", r.From)
	}
	if got := r.From.UTC(); got != time.Date(2026, 11, 19, 17, 0, 0, 0, time.UTC) {
		t.Errorf("from in UTC = %v", got)
	}

	tokyo := parse(t, "range=today&tz=Asia/Tokyo") // UTC+9: already 00:30 on the 21st
	if !tokyo.From.Equal(day("2026-11-21", tokyo.Loc)) {
		t.Errorf("tokyo from = %v", tokyo.From)
	}
}

func TestParseRangeErrors(t *testing.T) {
	for _, qs := range []string{
		"range=5d",
		"tz=Mars/Base",
		"tz=Local",
		"from=2026-11-01",
		"from=2026-11-10&to=2026-11-01",
		"from=11/01/2026&to=11/02/2026",
		"from=2020-01-01&to=2026-01-01",
		"interval=minute",
		"range=90d&interval=hour", // 2160 buckets
	} {
		q, _ := url.ParseQuery(qs)
		if _, err := ParseRange(q, now); err == nil {
			t.Errorf("ParseRange(%q) should fail", qs)
		}
	}
}

func TestBucketsDST(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	// DST ends 2026-11-01 in New York: that day has 25 hours.
	r := Range{From: day("2026-10-31", ny), To: day("2026-11-03", ny), Loc: ny, Interval: Day}
	b := r.Buckets()
	if len(b) != 3 {
		t.Fatalf("got %d day buckets", len(b))
	}
	for _, x := range b {
		if x.Hour() != 0 {
			t.Errorf("bucket %v is not local midnight", x)
		}
	}
	r.Interval = Hour
	if n := len(r.Buckets()); n != 24+25+24 {
		t.Errorf("hour buckets = %d, want 73", n)
	}
}

func TestBucketsWeekStartsMonday(t *testing.T) {
	r := Range{From: day("2026-11-20", time.UTC), To: day("2026-11-30", time.UTC), Loc: time.UTC, Interval: Week}
	b := r.Buckets()
	if b[0] != day("2026-11-16", time.UTC) || b[0].Weekday() != time.Monday {
		t.Errorf("first week bucket = %v", b[0])
	}
}

func TestFill(t *testing.T) {
	r := parse(t, "range=7d")
	b := r.Buckets()
	pts := Fill(b, map[int64]Point{b[2].Unix(): {Events: 5, Visitors: 2}})
	if len(pts) != 7 || pts[2].Events != 5 || pts[0].Events != 0 || !pts[6].T.Equal(b[6]) {
		t.Errorf("unexpected fill: %+v", pts)
	}
}

func TestCursorRoundTrip(t *testing.T) {
	c := Cursor{TS: time.Date(2026, 11, 20, 1, 2, 3, 456789000, time.UTC), ID: 42}
	got, err := ParseCursor(c.String())
	if err != nil || !got.TS.Equal(c.TS) || got.ID != 42 {
		t.Errorf("round trip: %+v %v", got, err)
	}
	if _, err := ParseCursor("nope"); err == nil {
		t.Error("bad cursor should fail")
	}
}

func TestValidDimension(t *testing.T) {
	for dim, want := range map[string]bool{
		"path": true, "referrer": true, "event": true, "prop:recipe": true,
		"name": false, "prop:": false, "prop:a b": false, "path; DROP TABLE events": false,
	} {
		if ValidDimension(dim) != want {
			t.Errorf("ValidDimension(%q) != %v", dim, want)
		}
	}
}
