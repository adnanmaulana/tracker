// Package event holds the enriched event model written to Postgres.
package event

import "time"

type Event struct {
	SiteID      string
	Name        string
	TS          time.Time
	SessionID   string
	VisitorID   string
	Path        string
	Referrer    string
	UTMSource   string
	UTMMedium   string
	UTMCampaign string
	Country     string
	Device      string
	Browser     string
	OS          string
	Props       []byte // JSON object
}
