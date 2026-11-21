// Package geo turns an IP address into a coarse location (country, region, city)
// using a local MaxMind-format database such as DB-IP "IP to City Lite".
// The IP itself is never stored; only the looked-up place names are.
package geo

import (
	"fmt"
	"net/netip"

	"github.com/oschwald/maxminddb-golang/v2"
)

type Location struct {
	Country string // ISO 3166-1 alpha-2, e.g. "ID"
	Region  string // e.g. "Jakarta"
	City    string // e.g. "South Jakarta"
}

// Locator looks up locations. The zero value (or a nil *Locator) finds nothing.
// The database is read once at startup; restart the API to pick up an updated file.
type Locator struct {
	db *maxminddb.Reader
}

// Open loads the database at path. An empty path returns a Locator that finds nothing.
func Open(path string) (*Locator, error) {
	if path == "" {
		return &Locator{}, nil
	}
	db, err := maxminddb.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open geo database: %w", err)
	}
	return &Locator{db: db}, nil
}

// Enabled reports whether a database is loaded.
func (l *Locator) Enabled() bool { return l != nil && l.db != nil }

// Close releases the database.
func (l *Locator) Close() error {
	if !l.Enabled() {
		return nil
	}
	return l.db.Close()
}

type record struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	Subdivisions []struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
}

// Lookup returns the location for ip, or a zero Location if unknown or private.
func (l *Locator) Lookup(ip string) Location {
	if !l.Enabled() {
		return Location{}
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil || !addr.IsGlobalUnicast() || addr.IsPrivate() {
		return Location{}
	}
	var rec record
	if err := l.db.Lookup(addr.Unmap()).Decode(&rec); err != nil {
		return Location{}
	}
	loc := Location{Country: rec.Country.ISOCode, City: rec.City.Names["en"]}
	if len(rec.Subdivisions) > 0 {
		loc.Region = rec.Subdivisions[0].Names["en"]
	}
	return loc
}
