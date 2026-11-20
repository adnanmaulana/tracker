package stats

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"monitoring-tools/api/internal/sites"
)

const token = "test-token-0123456789"

type fakeStore struct{ lastTop struct{ dim, event string } }

func (f *fakeStore) Totals(context.Context, string, Range) (map[string]Period, error) {
	return map[string]Period{"portfolio": {Current: Totals{Pageviews: 10}}}, nil
}
func (f *fakeStore) Series(context.Context, string, string, Range) (map[string][]Point, error) {
	return map[string][]Point{}, nil
}
func (f *fakeStore) Top(_ context.Context, _, dim, event string, _ Range, _ int) ([]TopRow, error) {
	f.lastTop.dim, f.lastTop.event = dim, event
	return []TopRow{}, nil
}
func (f *fakeStore) Events(context.Context, string, string, *Cursor, int) ([]EventRow, error) {
	return []EventRow{}, nil
}

type fakeRegistry map[string]sites.Site

func (f fakeRegistry) Get(id string) (sites.Site, bool) { s, ok := f[id]; return s, ok }
func (f fakeRegistry) List() []sites.Site {
	var out []sites.Site
	for _, s := range f {
		out = append(out, s)
	}
	return out
}
func (f fakeRegistry) Create(_ context.Context, s sites.Site) (sites.Site, error) {
	if err := s.Normalize(); err != nil {
		return sites.Site{}, err
	}
	if _, ok := f[s.ID]; ok {
		return sites.Site{}, sites.ErrExists
	}
	f[s.ID] = s
	return s, nil
}

func newServer() (*http.ServeMux, *fakeStore) {
	store := &fakeStore{}
	h := &Handler{
		Store: store,
		Sites: fakeRegistry{
			"portfolio": {ID: "portfolio", Domain: "me.dev", Name: "Portfolio", IsPublic: true},
			"cookbook":  {ID: "cookbook", Domain: "cook.dev", Name: "Cookbook"},
		},
		Token: token,
		Now:   func() time.Time { return now },
	}
	mux := http.NewServeMux()
	h.Register(mux)
	return mux, store
}

func do(mux http.Handler, method, path, body string, auth bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if auth {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestAuth(t *testing.T) {
	mux, _ := newServer()
	tests := []struct {
		path string
		auth bool
		want int
	}{
		{"/api/sites", false, 401},
		{"/api/sites", true, 200},
		{"/api/stats/overview", false, 401},
		{"/api/stats/overview", true, 200},
		{"/api/sites/portfolio/stats/summary", false, 200}, // public site
		{"/api/sites/portfolio/stats/top", false, 200},
		{"/api/sites/portfolio/events", false, 401}, // raw events are never public
		{"/api/sites/cookbook/stats/summary", false, 401},
		{"/api/sites/cookbook/stats/summary", true, 200},
		{"/api/sites/missing/stats/summary", false, 401}, // don't leak existence
		{"/api/sites/missing/stats/summary", true, 404},
	}
	for _, tt := range tests {
		if rec := do(mux, "GET", tt.path, "", tt.auth); rec.Code != tt.want {
			t.Errorf("GET %s auth=%v: %d, want %d (%s)", tt.path, tt.auth, rec.Code, tt.want, rec.Body)
		}
	}
}

func TestWrongTokenRejected(t *testing.T) {
	mux, _ := newServer()
	req := httptest.NewRequest("GET", "/api/sites", nil)
	req.Header.Set("Authorization", "Bearer nope")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("code = %d", rec.Code)
	}
}

func TestTopDefaults(t *testing.T) {
	mux, store := newServer()
	cases := []struct{ qs, dim, event string }{
		{"", "path", "pageview"},
		{"?dim=event", "event", ""},
		{"?dim=prop:recipe", "prop:recipe", ""},
		{"?dim=path&event=*", "path", ""},
		{"?dim=prop:recipe&event=copy_snippet", "prop:recipe", "copy_snippet"},
	}
	for _, c := range cases {
		if rec := do(mux, "GET", "/api/sites/cookbook/stats/top"+c.qs, "", true); rec.Code != 200 {
			t.Fatalf("%s: %d %s", c.qs, rec.Code, rec.Body)
		}
		if store.lastTop.dim != c.dim || store.lastTop.event != c.event {
			t.Errorf("%s: got dim=%q event=%q", c.qs, store.lastTop.dim, store.lastTop.event)
		}
	}
	if rec := do(mux, "GET", "/api/sites/cookbook/stats/top?dim=bogus", "", true); rec.Code != 400 {
		t.Errorf("bogus dim: %d", rec.Code)
	}
	if rec := do(mux, "GET", "/api/sites/cookbook/stats/top?limit=1000", "", true); rec.Code != 400 {
		t.Errorf("limit too high: %d", rec.Code)
	}
}

func TestBadRange(t *testing.T) {
	mux, _ := newServer()
	if rec := do(mux, "GET", "/api/stats/overview?range=forever", "", true); rec.Code != 400 {
		t.Errorf("code = %d", rec.Code)
	}
}

func TestOverviewIncludesSitesWithoutData(t *testing.T) {
	mux, _ := newServer()
	rec := do(mux, "GET", "/api/stats/overview?range=7d", "", true)
	var body struct {
		Sites []overviewSite `json:"sites"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sites) != 2 {
		t.Fatalf("got %d sites", len(body.Sites))
	}
	for _, s := range body.Sites {
		if len(s.Sparkline) != 7 {
			t.Errorf("%s sparkline has %d points", s.Site.ID, len(s.Sparkline))
		}
	}
}

func TestCreateSite(t *testing.T) {
	mux, _ := newServer()
	rec := do(mux, "POST", "/api/sites", `{"id":"blog","domain":"https://www.Blog.dev/","name":"Blog"}`, true)
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"domain":"blog.dev"`) {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	if rec := do(mux, "POST", "/api/sites", `{"id":"blog","domain":"blog.dev","name":"Blog"}`, true); rec.Code != 409 {
		t.Errorf("duplicate: %d", rec.Code)
	}
	if rec := do(mux, "POST", "/api/sites", `{"id":"Bad Id","domain":"x.dev","name":"X"}`, true); rec.Code != 400 {
		t.Errorf("invalid: %d", rec.Code)
	}
	if rec := do(mux, "POST", "/api/sites", `{"id":"x","domain":"x.dev","name":"X"}`, false); rec.Code != 401 {
		t.Errorf("unauthenticated: %d", rec.Code)
	}
}
