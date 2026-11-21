// demo-data fills the database with realistic sample traffic for the dev sites,
// so the dashboard has something to show. Safe to re-run: it replaces the demo sites' events.
//
//	DATABASE_URL=... go run ./cmd/demo-data -days 120
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"math"
	mrand "math/rand/v2"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"monitoring-tools/api/internal/db"
)

type weighted[T any] struct {
	v T
	w float64
}

func pick[T any](r *mrand.Rand, items []weighted[T]) T {
	var total float64
	for _, it := range items {
		total += it.w
	}
	x := r.Float64() * total
	for _, it := range items {
		if x -= it.w; x <= 0 {
			return it.v
		}
	}
	return items[len(items)-1].v
}

type siteSpec struct {
	id, domain, name string
	public           bool
	baseDaily        float64 // visitors per day at the start
	growth           float64 // total growth over the period, e.g. 0.6 = +60%
	paths            []weighted[string]
	custom           func(r *mrand.Rand, path string) (name, props string, ok bool)
}

var (
	referrers = []weighted[string]{
		{"", 45}, {"https://www.google.com/", 25}, {"https://github.com/", 12},
		{"https://www.linkedin.com/", 8}, {"https://t.co/", 5}, {"https://news.ycombinator.com/", 3}, {"https://www.reddit.com/", 2},
	}
	utms = []weighted[string]{{"", 88}, {"twitter", 5}, {"newsletter", 4}, {"linkedin", 3}}
	// country, region, city
	places = []weighted[[3]string]{
		{[3]string{"ID", "Jakarta", "South Jakarta"}, 16}, {[3]string{"ID", "West Java", "Bandung"}, 8},
		{[3]string{"ID", "East Java", "Surabaya"}, 5}, {[3]string{"ID", "Yogyakarta", "Yogyakarta"}, 5},
		{[3]string{"US", "California", "San Francisco"}, 8}, {[3]string{"US", "New York", "New York"}, 7},
		{[3]string{"US", "Washington", "Seattle"}, 5}, {[3]string{"SG", "Singapore", "Singapore"}, 8},
		{[3]string{"IN", "Karnataka", "Bengaluru"}, 7}, {[3]string{"DE", "Berlin", "Berlin"}, 6},
		{[3]string{"GB", "England", "London"}, 5}, {[3]string{"JP", "Tokyo", "Tokyo"}, 4},
		{[3]string{"AU", "New South Wales", "Sydney"}, 3}, {[3]string{"NL", "North Holland", "Amsterdam"}, 3},
		{[3]string{"BR", "São Paulo", "São Paulo"}, 2},
	}
	devices = []weighted[[3]string]{
		{[3]string{"desktop", "Chrome", "macOS"}, 30}, {[3]string{"desktop", "Chrome", "Windows"}, 18},
		{[3]string{"mobile", "Safari", "iOS"}, 22}, {[3]string{"mobile", "Chrome", "Android"}, 14},
		{[3]string{"desktop", "Safari", "macOS"}, 8}, {[3]string{"desktop", "Firefox", "Linux"}, 4},
		{[3]string{"tablet", "Safari", "iOS"}, 2}, {[3]string{"desktop", "Edge", "Windows"}, 2},
	}
)

var sitesToSeed = []siteSpec{
	{
		id: "portfolio", domain: "adnanradjam.com", name: "Portfolio", public: true, baseDaily: 38, growth: 0.7,
		paths: []weighted[string]{{"/", 55}, {"/work/retail-financing-app", 14}, {"/work/reanimated-cookbook", 12}, {"/#about", 8}, {"/#contact", 6}, {"/work/design-system", 5}},
		custom: func(r *mrand.Rand, path string) (string, string, bool) {
			switch x := r.Float64(); {
			case x < 0.06:
				return "resume_download", `{"format":"pdf"}`, true
			case x < 0.14 && path == "/":
				return "project_click", fmt.Sprintf(`{"project":%q}`, pick(r, []weighted[string]{{"reanimated-cookbook", 5}, {"retail-financing-app", 4}, {"design-system", 2}})), true
			case x < 0.18:
				return "contact_click", `{"channel":"email"}`, true
			case x < 0.22:
				return "outbound", `{"url":"https://github.com/"}`, true
			}
			return "", "", false
		},
	},
	{
		id: "reanimated-cookbook", domain: "reanimated.adnanradjam.com", name: "Reanimated Cookbook", baseDaily: 60, growth: 1.1,
		paths: []weighted[string]{{"/", 20}, {"/recipes/gesture-swipe", 16}, {"/recipes/shared-transition", 13}, {"/recipes/drag-to-reorder", 11}, {"/recipes/bottom-sheet", 10}, {"/recipes/parallax-header", 7}, {"/recipes/skeleton-shimmer", 6}, {"/search", 5}},
		custom: func(r *mrand.Rand, path string) (string, string, bool) {
			if len(path) > 9 && path[:9] == "/recipes/" {
				recipe := path[9:]
				switch x := r.Float64(); {
				case x < 0.35:
					return "copy_snippet", fmt.Sprintf(`{"recipe":%q}`, recipe), true
				case x < 0.5:
					return "demo_play", fmt.Sprintf(`{"recipe":%q}`, recipe), true
				}
			}
			if path == "/search" {
				return "search", `{"query":"gesture"}`, true
			}
			return "", "", false
		},
	},
}

func randID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
	days := flag.Int("days", 120, "days of history to generate")
	flag.Parse()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://tracker:tracker@localhost:5432/tracker?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatal(err)
	}
	now := time.Now().UTC()
	months := *days/30 + 2
	if err := db.EnsurePartitions(ctx, pool, now.AddDate(0, -months, 0), months+2); err != nil {
		log.Fatal(err)
	}

	r := mrand.New(mrand.NewPCG(42, uint64(now.Unix()/86400)))
	cols := []string{"site_id", "name", "ts", "session_id", "visitor_id", "path", "referrer", "utm_source", "country", "region", "city", "device", "browser", "os", "props"}

	for _, s := range sitesToSeed {
		if _, err := pool.Exec(ctx, `INSERT INTO sites (id, domain, name, is_public) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET domain = EXCLUDED.domain, name = EXCLUDED.name`,
			s.id, s.domain, s.name, s.public); err != nil {
			log.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM events WHERE site_id = $1`, s.id); err != nil {
			log.Fatal(err)
		}

		var rows [][]any
		start := now.AddDate(0, 0, -*days)
		for d := 0; d <= *days; d++ {
			day := time.Date(start.Year(), start.Month(), start.Day()+d, 0, 0, 0, 0, time.UTC)
			progress := float64(d) / float64(*days)
			weekday := map[time.Weekday]float64{time.Saturday: 0.7, time.Sunday: 0.65}[day.Weekday()]
			if weekday == 0 {
				weekday = 1
			}
			expected := s.baseDaily * (1 + s.growth*progress) * weekday * (0.8 + 0.4*r.Float64())
			if d%37 == 11 { // occasional spike, e.g. a post that got shared
				expected *= 2.6
			}
			visitors := int(math.Round(expected))

			for v := 0; v < visitors; v++ {
				ts := day.Add(time.Duration(r.Float64() * 24 * float64(time.Hour)))
				// Busier during Jakarta daytime (UTC+7).
				if h := (ts.Hour() + 7) % 24; h < 7 && r.Float64() < 0.6 {
					ts = ts.Add(time.Duration(8+r.IntN(6)) * time.Hour)
				}
				if ts.After(now) {
					continue
				}
				visitor := randID()
				ref, utm, place, dev := pick(r, referrers), pick(r, utms), pick(r, places), pick(r, devices)
				visits := 1
				if r.Float64() < 0.2 { // some people come back later the same day
					visits = 2
				}
				for vi := 0; vi < visits; vi++ {
					if vi > 0 {
						ts = ts.Add(time.Duration(1+r.IntN(4)) * time.Hour)
						ref = ""
					}
					if ts.After(now) || ts.Day() != day.Day() {
						break
					}
					session := randID()
					for p, pages := 0, 1+r.IntN(4); p < pages; p++ {
						path := pick(r, s.paths)
						refHere := ""
						if p == 0 {
							refHere = ref
						}
						rows = append(rows, []any{s.id, "pageview", ts, session, visitor, path, nullable(refHere), nullable(utm), place[0], place[1], place[2], dev[0], dev[1], dev[2], "{}"})
						if name, props, ok := s.custom(r, path); ok {
							rows = append(rows, []any{s.id, name, ts.Add(20 * time.Second), session, visitor, path, nil, nil, place[0], place[1], place[2], dev[0], dev[1], dev[2], props})
						}
						ts = ts.Add(time.Duration(30+r.IntN(200)) * time.Second)
					}
				}
			}
		}

		n, err := pool.CopyFrom(ctx, pgx.Identifier{"events"}, cols, pgx.CopyFromRows(rows))
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("%-22s %7d events over %d days\n", s.id, n, *days)
	}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
