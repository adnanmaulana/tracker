//go:build integration

// End-to-end tests against a real Postgres: ingest -> buffer -> stats API.
// Uses embedded-postgres (downloads Postgres binaries on first run, no Docker needed):
//
//	go test -tags integration ./internal/integration/
package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5/pgxpool"

	"monitoring-tools/api/internal/buffer"
	"monitoring-tools/api/internal/db"
	"monitoring-tools/api/internal/event"
	"monitoring-tools/api/internal/ingest"
	"monitoring-tools/api/internal/sites"
	"monitoring-tools/api/internal/stats"
)

const token = "integration-token-123456"

func freePort(t *testing.T) uint32 {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return uint32(l.Addr().(*net.TCPAddr).Port)
}

func startPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	port := freePort(t)
	pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V17).
		Port(port).
		RuntimePath(t.TempDir()).
		Logger(io.Discard))
	if err := pg.Start(); err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = pg.Stop() })

	ctx := context.Background()
	pool, err := db.Connect(ctx, fmt.Sprintf("postgres://postgres:postgres@localhost:%d/postgres?sslmode=disable", port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.EnsurePartitions(ctx, pool, time.Now(), 2); err != nil {
		t.Fatalf("partitions: %v", err)
	}
	return pool
}

type env struct {
	pool  *pgxpool.Pool
	sites *sites.Store
	mux   *http.ServeMux
}

func setup(t *testing.T) *env {
	pool := startPostgres(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx := context.Background()

	store := sites.NewStore(pool, log)
	for _, s := range []sites.Site{
		{ID: "portfolio", Domain: "me.dev", Name: "Portfolio", IsPublic: true},
		{ID: "cookbook", Domain: "cook.dev", Name: "Cookbook"},
	} {
		if _, err := store.Create(ctx, s); err != nil {
			t.Fatalf("create site: %v", err)
		}
	}

	mux := http.NewServeMux()
	(&stats.Handler{Store: stats.NewStore(pool), Sites: store, Token: token, Log: log}).Register(mux)
	return &env{pool: pool, sites: store, mux: mux}
}

// insert writes events through the real buffer (COPY path).
func (e *env) insert(t *testing.T, events []event.Event) {
	t.Helper()
	buf := buffer.New(e.pool, slog.New(slog.NewTextHandler(io.Discard, nil)), 100, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	go buf.Run(ctx)
	for _, ev := range events {
		if !buf.Add(ev) {
			t.Fatal("buffer full")
		}
	}
	cancel()
	buf.Wait()
}

func (e *env) get(t *testing.T, path string, out any) {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func ev(site, name, path, visitor string, ts time.Time, props string) event.Event {
	if props == "" {
		props = "{}"
	}
	return event.Event{
		SiteID: site, Name: name, Path: path, TS: ts,
		VisitorID: visitor, SessionID: "s-" + visitor, Device: "desktop", Browser: "Chrome",
		Referrer: "https://www.github.com/me", Props: []byte(props),
	}
}

func TestStatsEndToEnd(t *testing.T) {
	e := setup(t)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	at := func(daysAgo int) time.Time { return today.AddDate(0, 0, -daysAgo).Add(10 * time.Hour) }
	if at(0).After(time.Now()) { // keep "today" events in the past
		at = func(daysAgo int) time.Time { return today.AddDate(0, 0, -daysAgo).Add(time.Minute) }
	}

	e.insert(t, []event.Event{
		// current 7d period
		ev("portfolio", "pageview", "/", "v1", at(0), ""),
		ev("portfolio", "pageview", "/projects", "v1", at(0), ""),
		ev("portfolio", "pageview", "/", "v2", at(2), ""),
		ev("portfolio", "project_click", "/projects", "v1", at(0), `{"project":"cookbook"}`),
		ev("cookbook", "pageview", "/recipes/swipe", "v3", at(1), ""),
		ev("cookbook", "copy_snippet", "/recipes/swipe", "v3", at(1), `{"recipe":"gesture-swipe"}`),
		ev("cookbook", "copy_snippet", "/recipes/swipe", "v4", at(1), `{"recipe":"gesture-swipe"}`),
		ev("cookbook", "copy_snippet", "/recipes/drag", "v4", at(1), `{"recipe":"drag"}`),
		// previous 7d period
		ev("portfolio", "pageview", "/", "v9", at(10), ""),
		// outside both
		ev("portfolio", "pageview", "/", "v0", at(40), ""),
	})

	t.Run("overview", func(t *testing.T) {
		var out struct {
			Sites []struct {
				Site      sites.Site    `json:"site"`
				Current   stats.Totals  `json:"current"`
				Previous  stats.Totals  `json:"previous"`
				Sparkline []stats.Point `json:"sparkline"`
			} `json:"sites"`
		}
		e.get(t, "/api/stats/overview?range=7d", &out)
		got := map[string]stats.Totals{}
		for _, s := range out.Sites {
			got[s.Site.ID] = s.Current
			if len(s.Sparkline) != 7 {
				t.Errorf("%s sparkline len %d", s.Site.ID, len(s.Sparkline))
			}
			if s.Site.ID == "portfolio" {
				if s.Previous.Pageviews != 1 {
					t.Errorf("portfolio previous pageviews = %d, want 1", s.Previous.Pageviews)
				}
				if last := s.Sparkline[6]; last.Events != 2 {
					t.Errorf("portfolio today sparkline = %d, want 2", last.Events)
				}
			}
		}
		want := map[string]stats.Totals{
			"portfolio": {Pageviews: 3, Visitors: 2, Sessions: 2, Events: 4},
			"cookbook":  {Pageviews: 1, Visitors: 2, Sessions: 2, Events: 4},
		}
		for id, w := range want {
			if got[id] != w {
				t.Errorf("%s current = %+v, want %+v", id, got[id], w)
			}
		}
	})

	t.Run("timeseries", func(t *testing.T) {
		var out struct {
			Points []stats.Point `json:"points"`
		}
		e.get(t, "/api/sites/cookbook/stats/timeseries?range=7d&event=copy_snippet", &out)
		if len(out.Points) != 7 || out.Points[5].Events != 3 || out.Points[5].Visitors != 2 {
			t.Errorf("points = %+v", out.Points)
		}
	})

	t.Run("timeseries hourly in timezone", func(t *testing.T) {
		var out struct {
			Points []stats.Point `json:"points"`
		}
		e.get(t, "/api/sites/portfolio/stats/timeseries?range=7d&interval=hour&tz=Asia/Jakarta&event=*", &out)
		var total int64
		for _, p := range out.Points {
			total += p.Events
		}
		if len(out.Points) != 168 || total == 0 {
			t.Errorf("hourly: %d points, %d events", len(out.Points), total)
		}
	})

	t.Run("top pages, referrers, props, events", func(t *testing.T) {
		type top struct {
			Rows []stats.TopRow `json:"rows"`
		}
		var pages, refs, recipes, names top
		e.get(t, "/api/sites/portfolio/stats/top?range=7d", &pages)
		e.get(t, "/api/sites/portfolio/stats/top?range=7d&dim=referrer", &refs)
		e.get(t, "/api/sites/cookbook/stats/top?range=7d&dim=prop:recipe", &recipes)
		e.get(t, "/api/sites/cookbook/stats/top?range=7d&dim=event", &names)

		if len(pages.Rows) != 2 || pages.Rows[0] != (stats.TopRow{Value: "/", Events: 2, Visitors: 2}) {
			t.Errorf("pages = %+v", pages.Rows)
		}
		if len(refs.Rows) != 1 || refs.Rows[0].Value != "github.com" {
			t.Errorf("referrers = %+v", refs.Rows)
		}
		if len(recipes.Rows) != 2 || recipes.Rows[0] != (stats.TopRow{Value: "gesture-swipe", Events: 2, Visitors: 2}) {
			t.Errorf("recipes = %+v", recipes.Rows)
		}
		if len(names.Rows) != 2 || names.Rows[0].Value != "copy_snippet" || names.Rows[0].Events != 3 {
			t.Errorf("event names = %+v", names.Rows)
		}
	})

	t.Run("events feed paginates", func(t *testing.T) {
		type page struct {
			Events []stats.EventRow `json:"events"`
			Next   *string          `json:"next"`
		}
		var p1, p2 page
		e.get(t, "/api/sites/portfolio/events?limit=3", &p1)
		if len(p1.Events) != 3 || p1.Next == nil {
			t.Fatalf("page 1: %d events, next=%v", len(p1.Events), p1.Next)
		}
		e.get(t, "/api/sites/portfolio/events?limit=3&before="+*p1.Next, &p2)
		if len(p2.Events) != 3 { // portfolio has 6 events total
			t.Fatalf("page 2: %d events", len(p2.Events))
		}
		seen := map[int64]bool{}
		for _, ev := range append(p1.Events, p2.Events...) {
			if seen[ev.ID] {
				t.Errorf("duplicate event %d across pages", ev.ID)
			}
			seen[ev.ID] = true
		}
		if !p1.Events[0].TS.After(p2.Events[0].TS) && !p1.Events[0].TS.Equal(p2.Events[0].TS) {
			t.Error("feed is not newest-first")
		}
	})
}

func TestIngestToStats(t *testing.T) {
	e := setup(t)
	if err := e.sites.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}

	sink := &collect{}
	ing := &ingest.Handler{Sites: e.sites, Sink: sink, Enricher: ingest.NewEnricher("secret"),
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	body := `[{"site":"portfolio","name":"pageview","url":"https://me.dev/about?utm_source=twitter","referrer":"https://t.co/x"},
	          {"site":"portfolio","name":"resume_download","url":"https://me.dev/about","props":{"format":"pdf"}}]`
	req := httptest.NewRequest("POST", "/e", strings.NewReader(body))
	req.Header.Set("Origin", "https://me.dev")
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
	rec := httptest.NewRecorder()
	ing.Collect(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("ingest: %d %s", rec.Code, rec.Body)
	}
	e.insert(t, sink.events)

	var src, dev struct {
		Rows []stats.TopRow `json:"rows"`
	}
	e.get(t, "/api/sites/portfolio/stats/top?range=today&dim=utm_source", &src)
	e.get(t, "/api/sites/portfolio/stats/top?range=today&dim=device&event=*", &dev)
	if len(src.Rows) != 1 || src.Rows[0].Value != "twitter" {
		t.Errorf("utm_source = %+v", src.Rows)
	}
	if len(dev.Rows) != 1 || dev.Rows[0] != (stats.TopRow{Value: "mobile", Events: 2, Visitors: 1}) {
		t.Errorf("device = %+v", dev.Rows)
	}
}

type collect struct{ events []event.Event }

func (c *collect) Add(e event.Event) bool { c.events = append(c.events, e); return true }
