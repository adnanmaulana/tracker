package ingest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"monitoring-tools/api/internal/event"
	"monitoring-tools/api/internal/sites"
)

const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

func TestParseBody(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		want    int
		wantErr bool
	}{
		{"single", `{"site":"portfolio","name":"pageview"}`, 1, false},
		{"array", `[{"site":"a","name":"x"},{"site":"a","name":"y"}]`, 2, false},
		{"empty", ``, 0, true},
		{"empty array", `[]`, 0, true},
		{"bad json", `{nope`, 0, true},
		{"too many", "[" + strings.Repeat(`{"site":"a","name":"x"},`, MaxBatch) + `{"site":"a","name":"x"}]`, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseBody([]byte(tt.body))
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if len(got) != tt.want {
				t.Fatalf("got %d events, want %d", len(got), tt.want)
			}
		})
	}
}

func TestValidate(t *testing.T) {
	ok := RawEvent{Site: "portfolio", Name: "pageview"}
	tests := []struct {
		name    string
		mutate  func(*RawEvent)
		wantErr bool
	}{
		{"valid", func(*RawEvent) {}, false},
		{"valid props", func(e *RawEvent) { e.Props = json.RawMessage(`{"plan":"pro"}`) }, false},
		{"null props", func(e *RawEvent) { e.Props = json.RawMessage(`null`) }, false},
		{"bad site", func(e *RawEvent) { e.Site = "Bad Site!" }, true},
		{"empty name", func(e *RawEvent) { e.Name = "" }, true},
		{"name with space", func(e *RawEvent) { e.Name = "sign up" }, true},
		{"array props", func(e *RawEvent) { e.Props = json.RawMessage(`[1,2]`) }, true},
		{"huge props", func(e *RawEvent) {
			e.Props = json.RawMessage(`{"x":"` + strings.Repeat("a", MaxPropsLen) + `"}`)
		}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := ok
			tt.mutate(&e)
			if err := e.Validate(); (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func fixedEnricher(now time.Time) *Enricher {
	return &Enricher{secret: "test", now: func() time.Time { return now }}
}

func TestBuild(t *testing.T) {
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	en := fixedEnricher(now)
	info := RequestInfo{IP: "1.2.3.4", UserAgent: chromeUA, Country: "id"}

	e := en.Build(RawEvent{
		Site:      "portfolio",
		Name:      "pageview",
		URL:       "https://me.dev/projects?utm_source=twitter&utm_medium=social&utm_campaign=launch",
		Referrer:  "https://t.co/abc?x=1",
		SessionID: "sess_12345678",
		TS:        now.Add(-time.Minute).UnixMilli(),
	}, info)

	checks := map[string][2]string{
		"path":     {e.Path, "/projects"},
		"utm":      {e.UTMSource + "/" + e.UTMMedium + "/" + e.UTMCampaign, "twitter/social/launch"},
		"referrer": {e.Referrer, "https://t.co/abc"},
		"session":  {e.SessionID, "sess_12345678"},
		"country":  {e.Country, "ID"},
		"device":   {e.Device, "desktop"},
		"browser":  {e.Browser, "Chrome"},
		"props":    {string(e.Props), "{}"},
	}
	for k, v := range checks {
		if v[0] != v[1] {
			t.Errorf("%s = %q, want %q", k, v[0], v[1])
		}
	}
	if !e.TS.Equal(now.Add(-time.Minute)) {
		t.Errorf("ts = %v, want client ts", e.TS)
	}
	if len(e.VisitorID) != 32 {
		t.Errorf("visitor id length = %d, want 32", len(e.VisitorID))
	}
}

func TestBuildDropsSameSiteReferrerAndBadSession(t *testing.T) {
	en := fixedEnricher(time.Now())
	e := en.Build(RawEvent{
		Site: "portfolio", Name: "pageview",
		URL: "https://me.dev/a", Referrer: "https://me.dev/b", SessionID: "x",
	}, RequestInfo{IP: "1.2.3.4", UserAgent: chromeUA})

	if e.Referrer != "" {
		t.Errorf("same-site referrer kept: %q", e.Referrer)
	}
	if e.SessionID != e.VisitorID {
		t.Errorf("invalid session id should fall back to visitor id")
	}
}

func TestVisitorIDRotatesDaily(t *testing.T) {
	day1 := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	en := fixedEnricher(day1)
	a := en.visitorID("portfolio", "1.2.3.4", chromeUA, day1)
	b := en.visitorID("portfolio", "1.2.3.4", chromeUA, day1.Add(3*time.Hour))
	c := en.visitorID("portfolio", "1.2.3.4", chromeUA, day1.Add(24*time.Hour))
	d := en.visitorID("cookbook", "1.2.3.4", chromeUA, day1)

	if a != b {
		t.Error("same day should give same visitor id")
	}
	if a == c {
		t.Error("next day should give a different visitor id")
	}
	if a == d {
		t.Error("different sites should give different visitor ids")
	}
}

func TestClampTS(t *testing.T) {
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	if got := clampTS(0, now); !got.Equal(now) {
		t.Errorf("zero ts should use now")
	}
	if got := clampTS(now.Add(-48*time.Hour).UnixMilli(), now); !got.Equal(now) {
		t.Errorf("old ts should be clamped to now")
	}
	if got := clampTS(now.Add(time.Hour).UnixMilli(), now); !got.Equal(now) {
		t.Errorf("future ts should be clamped to now")
	}
}

func TestIsBot(t *testing.T) {
	for ua, want := range map[string]bool{
		"":       true,
		chromeUA: false,
		"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)":              true,
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0 Safari/537.36": true,
		"curl/8.7.1": false,
	} {
		if got := IsBot(ua); got != want {
			t.Errorf("IsBot(%q) = %v, want %v", ua, got, want)
		}
	}
}

// --- handler tests with fakes ---

type fakeSites map[string]sites.Site

func (f fakeSites) Get(id string) (sites.Site, bool) { s, ok := f[id]; return s, ok }
func (f fakeSites) AnyDomainMatches(host string) bool {
	for _, s := range f {
		if sites.MatchDomain(host, s.Domain) {
			return true
		}
	}
	return false
}

type fakeSink struct{ events []event.Event }

func (f *fakeSink) Add(e event.Event) bool { f.events = append(f.events, e); return true }

func newTestHandler(serverKey string) (*Handler, *fakeSink) {
	sink := &fakeSink{}
	return &Handler{
		Sites:     fakeSites{"portfolio": {ID: "portfolio", Domain: "me.dev"}},
		Sink:      sink,
		Enricher:  fixedEnricher(time.Now()),
		ServerKey: serverKey,
	}, sink
}

func post(h *Handler, body, origin, auth string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/e", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("User-Agent", chromeUA)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.Collect(rec, req)
	return rec
}

func TestCollect(t *testing.T) {
	const ev = `{"site":"portfolio","name":"pageview","url":"https://me.dev/"}`

	t.Run("accepts matching origin and sets CORS", func(t *testing.T) {
		h, sink := newTestHandler("")
		rec := post(h, ev, "https://www.me.dev", "")
		if rec.Code != http.StatusAccepted || len(sink.events) != 1 {
			t.Fatalf("code=%d events=%d body=%s", rec.Code, len(sink.events), rec.Body)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://www.me.dev" {
			t.Errorf("CORS origin = %q", got)
		}
	})

	t.Run("rejects foreign origin", func(t *testing.T) {
		h, sink := newTestHandler("")
		rec := post(h, ev, "https://evil.com", "")
		if rec.Code != http.StatusBadRequest || len(sink.events) != 0 {
			t.Fatalf("code=%d events=%d", rec.Code, len(sink.events))
		}
	})

	t.Run("rejects unknown site", func(t *testing.T) {
		h, _ := newTestHandler("")
		rec := post(h, `{"site":"nope","name":"pageview"}`, "https://me.dev", "")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("code=%d", rec.Code)
		}
	})

	t.Run("partial batch is accepted", func(t *testing.T) {
		h, sink := newTestHandler("")
		rec := post(h, `[`+ev+`,{"site":"portfolio","name":""}]`, "https://me.dev", "")
		var res response
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if rec.Code != http.StatusAccepted || res.Accepted != 1 || res.Rejected != 1 || len(sink.events) != 1 {
			t.Fatalf("code=%d res=%+v", rec.Code, res)
		}
	})

	t.Run("localhost only with AllowLocalhost", func(t *testing.T) {
		h, sink := newTestHandler("")
		if rec := post(h, ev, "http://localhost:3000", ""); rec.Code != http.StatusBadRequest {
			t.Fatalf("localhost without flag: code=%d", rec.Code)
		}
		h.AllowLocalhost = true
		rec := post(h, ev, "http://localhost:3000", "")
		if rec.Code != http.StatusAccepted || len(sink.events) != 1 {
			t.Fatalf("localhost with flag: code=%d body=%s", rec.Code, rec.Body)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
			t.Errorf("CORS origin = %q", got)
		}
	})

	t.Run("server key required without origin", func(t *testing.T) {
		h, _ := newTestHandler("secret")
		if rec := post(h, ev, "", ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("no key: code=%d", rec.Code)
		}
		if rec := post(h, ev, "", "Bearer secret"); rec.Code != http.StatusAccepted {
			t.Fatalf("with key: code=%d body=%s", rec.Code, rec.Body)
		}
	})
}
