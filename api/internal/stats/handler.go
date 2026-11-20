package stats

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"monitoring-tools/api/internal/sites"
)

// Querier is the read side of the event store (implemented by *Store).
type Querier interface {
	Totals(ctx context.Context, site string, r Range) (map[string]Period, error)
	Series(ctx context.Context, site, event string, r Range) (map[string][]Point, error)
	Top(ctx context.Context, site, dim, event string, r Range, limit int) ([]TopRow, error)
	Events(ctx context.Context, site, name string, before *Cursor, limit int) ([]EventRow, error)
}

// Registry is the site catalogue (implemented by *sites.Store).
type Registry interface {
	Get(id string) (sites.Site, bool)
	List() []sites.Site
	Create(ctx context.Context, s sites.Site) (sites.Site, error)
}

type Handler struct {
	Store Querier
	Sites Registry
	Token string // required as "Authorization: Bearer <token>" except on public site stats
	Now   func() time.Time
	Log   *slog.Logger
}

// Register mounts the stats routes on mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sites", h.private(h.listSites))
	mux.HandleFunc("POST /api/sites", h.private(h.createSite))
	mux.HandleFunc("GET /api/stats/overview", h.private(h.overview))
	mux.HandleFunc("GET /api/sites/{site}/stats/summary", h.forSite(true, h.summary))
	mux.HandleFunc("GET /api/sites/{site}/stats/timeseries", h.forSite(true, h.timeseries))
	mux.HandleFunc("GET /api/sites/{site}/stats/top", h.forSite(true, h.top))
	mux.HandleFunc("GET /api/sites/{site}/events", h.forSite(false, h.events))
}

// ---- auth ----

func (h *Handler) authorized(r *http.Request) bool {
	want := "Bearer " + h.Token
	got := r.Header.Get("Authorization")
	return h.Token != "" && subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (h *Handler) private(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.authorized(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		fn(w, r)
	}
}

type siteHandler func(w http.ResponseWriter, r *http.Request, site sites.Site)

// forSite resolves {site}. With allowPublic, sites marked is_public can be read without a token.
func (h *Handler) forSite(allowPublic bool, fn siteHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		site, ok := h.Sites.Get(r.PathValue("site"))
		authed := h.authorized(r)
		switch {
		case !ok && authed:
			writeError(w, http.StatusNotFound, "site not found")
		case !ok, !authed && !(allowPublic && site.IsPublic):
			// Don't reveal whether a private site exists.
			writeError(w, http.StatusUnauthorized, "unauthorized")
		default:
			fn(w, r, site)
		}
	}
}

// ---- sites ----

func (h *Handler) listSites(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sites": h.Sites.List()})
}

func (h *Handler) createSite(w http.ResponseWriter, r *http.Request) {
	var in sites.Site
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	site, err := h.Sites.Create(r.Context(), in)
	var invalid *sites.ValidationError
	switch {
	case errors.Is(err, sites.ErrExists):
		writeError(w, http.StatusConflict, err.Error())
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		h.serverError(w, err)
	default:
		writeJSON(w, http.StatusCreated, site)
	}
}

// ---- stats ----

type rangeJSON struct {
	From     time.Time `json:"from"`
	To       time.Time `json:"to"`
	PrevFrom time.Time `json:"prev_from"`
	Interval Interval  `json:"interval"`
	TZ       string    `json:"tz"`
}

func toJSON(r Range) rangeJSON {
	return rangeJSON{r.From, r.To, r.PrevFrom, r.Interval, r.Loc.String()}
}

func (h *Handler) parseRange(w http.ResponseWriter, r *http.Request) (Range, bool) {
	rng, err := ParseRange(r.URL.Query(), h.now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return Range{}, false
	}
	return rng, true
}

type overviewSite struct {
	Site      sites.Site `json:"site"`
	Current   Totals     `json:"current"`
	Previous  Totals     `json:"previous"`
	Sparkline []Point    `json:"sparkline"`
}

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	rng, ok := h.parseRange(w, r)
	if !ok {
		return
	}
	totals, err := h.Store.Totals(r.Context(), "", rng)
	if err != nil {
		h.serverError(w, err)
		return
	}
	series, err := h.Store.Series(r.Context(), "", "pageview", rng)
	if err != nil {
		h.serverError(w, err)
		return
	}

	empty := Fill(rng.Buckets(), nil)
	out := []overviewSite{}
	for _, s := range h.Sites.List() {
		spark := series[s.ID]
		if spark == nil {
			spark = empty
		}
		p := totals[s.ID]
		out = append(out, overviewSite{Site: s, Current: p.Current, Previous: p.Previous, Sparkline: spark})
	}
	writeJSON(w, http.StatusOK, map[string]any{"range": toJSON(rng), "sites": out})
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request, site sites.Site) {
	rng, ok := h.parseRange(w, r)
	if !ok {
		return
	}
	totals, err := h.Store.Totals(r.Context(), site.ID, rng)
	if err != nil {
		h.serverError(w, err)
		return
	}
	p := totals[site.ID]
	writeJSON(w, http.StatusOK, map[string]any{
		"range": toJSON(rng), "site": site, "current": p.Current, "previous": p.Previous,
	})
}

// eventParam reads ?event=, where "*" means all events and "" means def.
func eventParam(r *http.Request, def string) string {
	switch e := r.URL.Query().Get("event"); e {
	case "":
		return def
	case "*":
		return ""
	default:
		return e
	}
}

func (h *Handler) timeseries(w http.ResponseWriter, r *http.Request, site sites.Site) {
	rng, ok := h.parseRange(w, r)
	if !ok {
		return
	}
	event := eventParam(r, "pageview")
	series, err := h.Store.Series(r.Context(), site.ID, event, rng)
	if err != nil {
		h.serverError(w, err)
		return
	}
	points := series[site.ID]
	if points == nil {
		points = Fill(rng.Buckets(), nil)
	}
	writeJSON(w, http.StatusOK, map[string]any{"range": toJSON(rng), "event": orAll(event), "points": points})
}

func (h *Handler) top(w http.ResponseWriter, r *http.Request, site sites.Site) {
	rng, ok := h.parseRange(w, r)
	if !ok {
		return
	}
	dim := r.URL.Query().Get("dim")
	if dim == "" {
		dim = "path"
	}
	if !ValidDimension(dim) {
		writeError(w, http.StatusBadRequest, "invalid dim: use path, referrer, utm_source, utm_medium, utm_campaign, country, device, browser, os, event or prop:<key>")
		return
	}
	limit, ok := intParam(w, r, "limit", 10, 100)
	if !ok {
		return
	}
	event := eventParam(r, DefaultEvent(dim))
	rows, err := h.Store.Top(r.Context(), site.ID, dim, event, rng, limit)
	if err != nil {
		h.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"range": toJSON(rng), "dim": dim, "event": orAll(event), "rows": rows})
}

func (h *Handler) events(w http.ResponseWriter, r *http.Request, site sites.Site) {
	limit, ok := intParam(w, r, "limit", 50, 200)
	if !ok {
		return
	}
	before, err := ParseCursor(r.URL.Query().Get("before"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := h.Store.Events(r.Context(), site.ID, r.URL.Query().Get("name"), before, limit)
	if err != nil {
		h.serverError(w, err)
		return
	}
	var next *string
	if len(rows) == limit {
		last := rows[len(rows)-1]
		c := Cursor{TS: last.TS, ID: last.ID}.String()
		next = &c
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": rows, "next": next})
}

// ---- helpers ----

func (h *Handler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *Handler) serverError(w http.ResponseWriter, err error) {
	if h.Log != nil {
		h.Log.Error("stats request failed", "err", err)
	}
	writeError(w, http.StatusInternalServerError, "internal error")
}

func intParam(w http.ResponseWriter, r *http.Request, key string, def, max int) (int, bool) {
	s := r.URL.Query().Get(key)
	if s == "" {
		return def, true
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > max {
		writeError(w, http.StatusBadRequest, key+" must be between 1 and "+strconv.Itoa(max))
		return 0, false
	}
	return n, true
}

func orAll(event string) string {
	if event == "" {
		return "*"
	}
	return event
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
