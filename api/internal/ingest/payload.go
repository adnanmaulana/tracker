package ingest

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

const (
	MaxBodyBytes = 64 << 10
	MaxBatch     = 50
	MaxURLLen    = 2048
	MaxPropsLen  = 2048
)

var (
	siteRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	nameRe    = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
	sessionRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
)

// RawEvent is what the tracker (or a server) sends.
type RawEvent struct {
	Site      string          `json:"site"`
	Name      string          `json:"name"`
	URL       string          `json:"url,omitempty"`
	Referrer  string          `json:"referrer,omitempty"`
	SessionID string          `json:"session_id,omitempty"`
	TS        int64           `json:"ts,omitempty"` // unix millis, optional
	Props     json.RawMessage `json:"props,omitempty"`
}

// ParseBody accepts a single event object or an array of events.
func ParseBody(body []byte) ([]RawEvent, error) {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return nil, errors.New("empty body")
	}

	var events []RawEvent
	if body[0] == '[' {
		if err := json.Unmarshal(body, &events); err != nil {
			return nil, fmt.Errorf("invalid JSON: %w", err)
		}
	} else {
		var e RawEvent
		if err := json.Unmarshal(body, &e); err != nil {
			return nil, fmt.Errorf("invalid JSON: %w", err)
		}
		events = []RawEvent{e}
	}

	if len(events) == 0 {
		return nil, errors.New("no events")
	}
	if len(events) > MaxBatch {
		return nil, fmt.Errorf("too many events: max %d per request", MaxBatch)
	}
	return events, nil
}

// Validate checks the shape of a raw event (not whether the site exists).
func (e RawEvent) Validate() error {
	switch {
	case !siteRe.MatchString(e.Site):
		return errors.New("invalid site")
	case !nameRe.MatchString(e.Name):
		return errors.New("invalid name: use 1-64 chars of [A-Za-z0-9_.:-]")
	case len(e.URL) > MaxURLLen:
		return errors.New("url too long")
	case len(e.Referrer) > MaxURLLen:
		return errors.New("referrer too long")
	case len(e.Props) > MaxPropsLen:
		return fmt.Errorf("props too large: max %d bytes", MaxPropsLen)
	}
	if p := bytes.TrimSpace(e.Props); len(p) > 0 && !bytes.Equal(p, []byte("null")) {
		if p[0] != '{' || !json.Valid(p) {
			return errors.New("props must be a JSON object")
		}
	}
	return nil
}
