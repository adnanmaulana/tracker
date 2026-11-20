package ingest

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/mileusna/useragent"

	"monitoring-tools/api/internal/event"
)

// RequestInfo is the request-level context shared by every event in a batch.
type RequestInfo struct {
	IP        string
	UserAgent string
	Country   string
}

type Enricher struct {
	secret string
	now    func() time.Time
}

func NewEnricher(secret string) *Enricher {
	return &Enricher{secret: secret, now: time.Now}
}

// Build turns a validated raw event into a storable event. The raw IP is only used
// for hashing and is never stored.
func (en *Enricher) Build(raw RawEvent, info RequestInfo) event.Event {
	now := en.now().UTC()
	ua := useragent.Parse(info.UserAgent)

	e := event.Event{
		SiteID:    raw.Site,
		Name:      raw.Name,
		TS:        clampTS(raw.TS, now),
		VisitorID: en.visitorID(raw.Site, info.IP, info.UserAgent, now),
		Country:   strings.ToUpper(info.Country),
		Device:    deviceType(ua),
		Browser:   ua.Name,
		OS:        ua.OS,
		Props:     normalizeProps(raw.Props),
	}

	e.SessionID = raw.SessionID
	if !sessionRe.MatchString(e.SessionID) {
		e.SessionID = e.VisitorID
	}

	var pageHost string
	if u, err := url.Parse(raw.URL); err == nil && raw.URL != "" {
		pageHost = u.Hostname()
		e.Path = u.Path
		if e.Path == "" {
			e.Path = "/"
		}
		q := u.Query()
		e.UTMSource = q.Get("utm_source")
		e.UTMMedium = q.Get("utm_medium")
		e.UTMCampaign = q.Get("utm_campaign")
	}

	e.Referrer = externalReferrer(raw.Referrer, pageHost)
	return e
}

// visitorID is a daily-rotating, non-reversible hash: the same person gets a new ID
// each day, so visitors can be counted without cookies or stored IPs.
func (en *Enricher) visitorID(site, ip, ua string, now time.Time) string {
	salt := sha256.Sum256([]byte(en.secret + "|" + now.Format("2006-01-02")))
	h := sha256.New()
	h.Write(salt[:])
	h.Write([]byte(site + "|" + ip + "|" + ua))
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// clampTS accepts a client timestamp only if it is recent; otherwise uses server time.
func clampTS(ms int64, now time.Time) time.Time {
	if ms <= 0 {
		return now
	}
	t := time.UnixMilli(ms).UTC()
	if t.Before(now.Add(-24*time.Hour)) || t.After(now.Add(5*time.Minute)) {
		return now
	}
	return t
}

// externalReferrer drops same-site referrers and query strings.
func externalReferrer(ref, pageHost string) string {
	if ref == "" {
		return ""
	}
	u, err := url.Parse(ref)
	if err != nil || u.Host == "" {
		return ""
	}
	if pageHost != "" && strings.EqualFold(u.Hostname(), pageHost) {
		return ""
	}
	return u.Scheme + "://" + u.Host + u.Path
}

func deviceType(ua useragent.UserAgent) string {
	switch {
	case ua.Tablet:
		return "tablet"
	case ua.Mobile:
		return "mobile"
	case ua.Desktop:
		return "desktop"
	default:
		return "other"
	}
}

func normalizeProps(p []byte) []byte {
	p = bytes.TrimSpace(p)
	if len(p) == 0 || bytes.Equal(p, []byte("null")) {
		return []byte("{}")
	}
	return p
}

var botRe = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|preview|scan`)

// IsBot reports whether the user agent looks automated. Empty UAs count as bots.
func IsBot(ua string) bool {
	if strings.TrimSpace(ua) == "" {
		return true
	}
	return botRe.MatchString(ua) || useragent.Parse(ua).Bot
}
