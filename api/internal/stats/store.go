package stats

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Totals struct {
	Pageviews int64 `json:"pageviews"`
	Visitors  int64 `json:"visitors"`
	Sessions  int64 `json:"sessions"`
	Events    int64 `json:"events"`
}

// Period holds totals for the selected range and the one before it.
type Period struct {
	Current  Totals `json:"current"`
	Previous Totals `json:"previous"`
}

type Point struct {
	T        time.Time `json:"t"`
	Events   int64     `json:"events"`
	Visitors int64     `json:"visitors"`
}

type TopRow struct {
	Value    string `json:"value"`
	Events   int64  `json:"events"`
	Visitors int64  `json:"visitors"`
}

type EventRow struct {
	ID          int64           `json:"id"`
	Name        string          `json:"name"`
	TS          time.Time       `json:"ts"`
	SessionID   string          `json:"session_id"`
	VisitorID   string          `json:"visitor_id"`
	Path        string          `json:"path,omitempty"`
	Referrer    string          `json:"referrer,omitempty"`
	UTMSource   string          `json:"utm_source,omitempty"`
	UTMMedium   string          `json:"utm_medium,omitempty"`
	UTMCampaign string          `json:"utm_campaign,omitempty"`
	Country     string          `json:"country,omitempty"`
	Device      string          `json:"device,omitempty"`
	Browser     string          `json:"browser,omitempty"`
	OS          string          `json:"os,omitempty"`
	Props       json.RawMessage `json:"props"`
}

// Cursor marks a position in the (ts DESC, id DESC) event feed.
type Cursor struct {
	TS time.Time
	ID int64
}

func (c Cursor) String() string { return fmt.Sprintf("%d_%d", c.TS.UnixMicro(), c.ID) }

func ParseCursor(s string) (*Cursor, error) {
	if s == "" {
		return nil, nil
	}
	a, b, ok := strings.Cut(s, "_")
	us, err1 := strconv.ParseInt(a, 10, 64)
	id, err2 := strconv.ParseInt(b, 10, 64)
	if !ok || err1 != nil || err2 != nil {
		return nil, fmt.Errorf("invalid cursor")
	}
	return &Cursor{TS: time.UnixMicro(us).UTC(), ID: id}, nil
}

// Dimensions that can be ranked with Top. Values are trusted SQL expressions;
// "prop:<key>" is handled separately with the key passed as a parameter.
var dimensions = map[string]string{
	"path":         "path",
	"referrer":     `regexp_replace(split_part(referrer, '/', 3), '^www\.', '')`,
	"utm_source":   "utm_source",
	"utm_medium":   "utm_medium",
	"utm_campaign": "utm_campaign",
	"country":      "country",
	"device":       "device",
	"browser":      "browser",
	"os":           "os",
	"event":        "name",
}

var propKeyRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

// DefaultEvent is the event a dimension is ranked over when none is given:
// page-level dimensions look at pageviews, event names and props at everything.
func DefaultEvent(dim string) string {
	if dim == "event" || strings.HasPrefix(dim, "prop:") {
		return ""
	}
	return "pageview"
}

func ValidDimension(dim string) bool {
	if key, ok := strings.CutPrefix(dim, "prop:"); ok {
		return propKeyRe.MatchString(key)
	}
	_, ok := dimensions[dim]
	return ok
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// nullable turns "" into NULL so `$n::text IS NULL OR col = $n` disables the filter.
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Totals returns current and previous-period totals per site. site "" means all sites.
func (s *Store) Totals(ctx context.Context, site string, r Range) (map[string]Period, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT site_id,
		  count(*) FILTER (WHERE ts >= $2 AND name = 'pageview'),
		  count(DISTINCT visitor_id) FILTER (WHERE ts >= $2),
		  count(DISTINCT session_id) FILTER (WHERE ts >= $2),
		  count(*) FILTER (WHERE ts >= $2),
		  count(*) FILTER (WHERE ts < $2 AND name = 'pageview'),
		  count(DISTINCT visitor_id) FILTER (WHERE ts < $2),
		  count(DISTINCT session_id) FILTER (WHERE ts < $2),
		  count(*) FILTER (WHERE ts < $2)
		FROM events
		WHERE ts >= $1 AND ts < $3 AND ($4::text IS NULL OR site_id = $4)
		GROUP BY site_id`,
		r.PrevFrom, r.From, r.To, nullable(site))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]Period{}
	for rows.Next() {
		var id string
		var p Period
		if err := rows.Scan(&id,
			&p.Current.Pageviews, &p.Current.Visitors, &p.Current.Sessions, &p.Current.Events,
			&p.Previous.Pageviews, &p.Previous.Visitors, &p.Previous.Sessions, &p.Previous.Events,
		); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

// Series returns one gap-filled time series per site. site "" means all sites; event "" means all events.
func (s *Store) Series(ctx context.Context, site, event string, r Range) (map[string][]Point, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT site_id, date_trunc($1::text, ts, $2::text) AS bucket, count(*), count(DISTINCT visitor_id)
		FROM events
		WHERE ts >= $3 AND ts < $4
		  AND ($5::text IS NULL OR site_id = $5)
		  AND ($6::text IS NULL OR name = $6)
		GROUP BY 1, 2`,
		string(r.Interval), r.Loc.String(), r.From, r.To, nullable(site), nullable(event))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	raw := map[string]map[int64]Point{}
	for rows.Next() {
		var id string
		var p Point
		if err := rows.Scan(&id, &p.T, &p.Events, &p.Visitors); err != nil {
			return nil, err
		}
		if raw[id] == nil {
			raw[id] = map[int64]Point{}
		}
		raw[id][p.T.Unix()] = p
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	buckets := r.Buckets()
	out := make(map[string][]Point, len(raw))
	for id, m := range raw {
		out[id] = Fill(buckets, m)
	}
	return out, nil
}

// Fill returns one point per bucket, using zeros where there is no data.
func Fill(buckets []time.Time, data map[int64]Point) []Point {
	out := make([]Point, len(buckets))
	for i, b := range buckets {
		p := data[b.Unix()]
		p.T = b
		out[i] = p
	}
	return out
}

// Top ranks values of a dimension. dim must pass ValidDimension.
func (s *Store) Top(ctx context.Context, site, dim, event string, r Range, limit int) ([]TopRow, error) {
	args := []any{site, r.From, r.To, nullable(event), limit}
	expr, ok := dimensions[dim]
	if key, isProp := strings.CutPrefix(dim, "prop:"); isProp {
		expr, ok = "props->>$6", true
		args = append(args, key)
	}
	if !ok {
		return nil, fmt.Errorf("invalid dimension %q", dim)
	}

	q := fmt.Sprintf(`
		SELECT %[1]s AS value, count(*) AS events, count(DISTINCT visitor_id) AS visitors
		FROM events
		WHERE site_id = $1 AND ts >= $2 AND ts < $3
		  AND ($4::text IS NULL OR name = $4)
		  AND NULLIF(%[1]s, '') IS NOT NULL
		GROUP BY 1
		ORDER BY 2 DESC, 1
		LIMIT $5`, expr)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []TopRow{}
	for rows.Next() {
		var row TopRow
		if err := rows.Scan(&row.Value, &row.Events, &row.Visitors); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Events returns the newest raw events for a site, older than the cursor if given.
func (s *Store) Events(ctx context.Context, site, name string, before *Cursor, limit int) ([]EventRow, error) {
	var beforeTS *time.Time
	var beforeID int64
	if before != nil {
		beforeTS, beforeID = &before.TS, before.ID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, ts, session_id, visitor_id,
		       coalesce(path, ''), coalesce(referrer, ''),
		       coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, ''),
		       coalesce(country, ''), coalesce(device, ''), coalesce(browser, ''), coalesce(os, ''),
		       props::text
		FROM events
		WHERE site_id = $1
		  AND ($2::text IS NULL OR name = $2)
		  AND ($3::timestamptz IS NULL OR (ts, id) < ($3, $4))
		ORDER BY ts DESC, id DESC
		LIMIT $5`,
		site, nullable(name), beforeTS, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []EventRow{}
	for rows.Next() {
		var e EventRow
		var props string
		if err := rows.Scan(&e.ID, &e.Name, &e.TS, &e.SessionID, &e.VisitorID,
			&e.Path, &e.Referrer, &e.UTMSource, &e.UTMMedium, &e.UTMCampaign,
			&e.Country, &e.Device, &e.Browser, &e.OS, &props); err != nil {
			return nil, err
		}
		e.Props = json.RawMessage(props)
		out = append(out, e)
	}
	return out, rows.Err()
}
