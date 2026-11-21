package ingest

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"monitoring-tools/api/internal/event"
	"monitoring-tools/api/internal/geo"
	"monitoring-tools/api/internal/httpx"
	"monitoring-tools/api/internal/sites"
)

type SiteLookup interface {
	Get(id string) (sites.Site, bool)
	AnyDomainMatches(host string) bool
}

// Geo resolves an IP to a coarse location (implemented by *geo.Locator).
type Geo interface {
	Lookup(ip string) geo.Location
}

type Sink interface {
	Add(e event.Event) bool
}

type Handler struct {
	Sites      SiteLookup
	Sink       Sink
	Enricher   *Enricher
	Geo        Geo // optional
	ServerKey  string
	TrustProxy bool
	// AllowLocalhost accepts browser events from localhost for every site (development only).
	AllowLocalhost bool
	Log            *slog.Logger
}

type response struct {
	Accepted int      `json:"accepted"`
	Rejected int      `json:"rejected"`
	Errors   []string `json:"errors,omitempty"`
}

// Preflight answers CORS preflight requests from registered domains.
func (h *Handler) Preflight(w http.ResponseWriter, r *http.Request) {
	if h.setCORS(w, r) {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
	}
	w.WriteHeader(http.StatusNoContent)
}

// Collect handles POST /e.
func (h *Handler) Collect(w http.ResponseWriter, r *http.Request) {
	h.setCORS(w, r)
	originHost := hostOf(r.Header.Get("Origin"))

	// Server-side callers (no Origin) must present the server key, if one is configured.
	if originHost == "" && h.ServerKey != "" {
		if r.Header.Get("Authorization") != "Bearer "+h.ServerKey {
			writeJSON(w, http.StatusUnauthorized, response{Errors: []string{"missing or invalid server key"}})
			return
		}
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, response{Errors: []string{"body too large"}})
		return
	}
	raws, err := ParseBody(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, response{Errors: []string{err.Error()}})
		return
	}

	// Silently accept bot traffic so crawlers don't retry, but don't store it.
	if IsBot(r.UserAgent()) {
		writeJSON(w, http.StatusAccepted, response{})
		return
	}

	info := RequestInfo{
		IP:        httpx.ClientIP(r, h.TrustProxy),
		UserAgent: r.UserAgent(),
		Country:   countryHeader(r),
	}
	if h.Geo != nil {
		// Only place names are kept; the IP is used for this lookup and the daily hash, then dropped.
		loc := h.Geo.Lookup(info.IP)
		info.Region, info.City = loc.Region, loc.City
		if info.Country == "" || (loc.Country != "" && loc.Country == info.Country) {
			info.Country = loc.Country
		} else {
			info.Region, info.City = "", "" // edge header disagrees; trust it and skip finer detail
		}
	}

	var res response
	for i, raw := range raws {
		if err := h.check(raw, originHost); err != nil {
			res.Rejected++
			res.Errors = append(res.Errors, fmt.Sprintf("event %d: %v", i, err))
			continue
		}
		if !h.Sink.Add(h.Enricher.Build(raw, info)) {
			res.Rejected++
			res.Errors = append(res.Errors, fmt.Sprintf("event %d: buffer full", i))
			h.Log.Warn("event buffer full, dropping event")
			continue
		}
		res.Accepted++
	}

	status := http.StatusAccepted
	if res.Accepted == 0 {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, res)
}

func (h *Handler) check(raw RawEvent, originHost string) error {
	if err := raw.Validate(); err != nil {
		return err
	}
	site, ok := h.Sites.Get(raw.Site)
	if !ok {
		return fmt.Errorf("unknown site %q", raw.Site)
	}
	if originHost != "" && !sites.MatchDomain(originHost, site.Domain) && !h.isDevOrigin(originHost) {
		return fmt.Errorf("origin %q not allowed for site %q", originHost, raw.Site)
	}
	return nil
}

// setCORS reflects the Origin if it belongs to a registered site.
func (h *Handler) setCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if host := hostOf(origin); origin == "" || (!h.Sites.AnyDomainMatches(host) && !h.isDevOrigin(host)) {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	return true
}

func (h *Handler) isDevOrigin(host string) bool {
	return h.AllowLocalhost && (host == "localhost" || host == "127.0.0.1" || host == "::1")
}

func hostOf(origin string) string {
	if origin == "" {
		return ""
	}
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// countryHeader reads a country code set by an edge proxy, if any.
func countryHeader(r *http.Request) string {
	for _, h := range []string{"CF-IPCountry", "X-Vercel-IP-Country", "X-Country-Code"} {
		if v := strings.TrimSpace(r.Header.Get(h)); len(v) == 2 && v != "XX" {
			return v
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
