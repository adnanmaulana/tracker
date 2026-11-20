// Package sites keeps an in-memory cache of registered sites, refreshed from Postgres.
package sites

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Site struct {
	ID       string `json:"id"`
	Domain   string `json:"domain"`
	Name     string `json:"name"`
	IsPublic bool   `json:"is_public"`
}

type Store struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	mu   sync.RWMutex
	byID map[string]Site
}

func NewStore(pool *pgxpool.Pool, log *slog.Logger) *Store {
	return &Store{pool: pool, log: log, byID: map[string]Site{}}
}

// Refresh reloads all sites from the database.
func (s *Store) Refresh(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT id, domain, name, is_public FROM sites`)
	if err != nil {
		return err
	}
	defer rows.Close()

	next := map[string]Site{}
	for rows.Next() {
		var site Site
		if err := rows.Scan(&site.ID, &site.Domain, &site.Name, &site.IsPublic); err != nil {
			return err
		}
		next[site.ID] = site
	}
	if err := rows.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	s.byID = next
	s.mu.Unlock()
	return nil
}

// Run refreshes the cache every interval until ctx is cancelled.
func (s *Store) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.Refresh(ctx); err != nil && ctx.Err() == nil {
				s.log.Error("refresh sites", "err", err)
			}
		}
	}
}

func (s *Store) Get(id string) (Site, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	site, ok := s.byID[id]
	return site, ok
}

// List returns all cached sites sorted by name.
func (s *Store) List() []Site {
	s.mu.RLock()
	out := make([]Site, 0, len(s.byID))
	for _, site := range s.byID {
		out = append(out, site)
	}
	s.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

var (
	ErrExists    = errors.New("site already exists")
	idRe         = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	domainRe     = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)
	schemePrefix = regexp.MustCompile(`^[a-z]+://`)
)

// Normalize cleans user input ("https://www.Me.dev/" -> "me.dev") and validates it.
func (site *Site) Normalize() error {
	site.ID = strings.TrimSpace(site.ID)
	site.Name = strings.TrimSpace(site.Name)
	d := strings.ToLower(strings.TrimSpace(site.Domain))
	d = schemePrefix.ReplaceAllString(d, "")
	d, _, _ = strings.Cut(d, "/")
	d, _, _ = strings.Cut(d, ":")
	site.Domain = strings.TrimPrefix(d, "www.")

	switch {
	case !idRe.MatchString(site.ID):
		return &ValidationError{"id must be lowercase letters, digits and dashes (max 63)"}
	case !domainRe.MatchString(site.Domain) || len(site.Domain) > 253:
		return &ValidationError{"invalid domain"}
	case site.Name == "" || len(site.Name) > 100:
		return &ValidationError{"name is required (max 100 chars)"}
	}
	return nil
}

// ValidationError means the input was rejected (as opposed to a database failure).
type ValidationError struct{ msg string }

func (e *ValidationError) Error() string { return e.msg }

// Create inserts a site and refreshes the cache.
func (s *Store) Create(ctx context.Context, site Site) (Site, error) {
	if err := site.Normalize(); err != nil {
		return Site{}, err
	}
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO sites (id, domain, name, is_public) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		site.ID, site.Domain, site.Name, site.IsPublic)
	if err != nil {
		return Site{}, err
	}
	if tag.RowsAffected() == 0 {
		return Site{}, ErrExists
	}
	return site, s.Refresh(ctx)
}

// AnyDomainMatches reports whether host belongs to any registered site (used for CORS preflight).
func (s *Store) AnyDomainMatches(host string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, site := range s.byID {
		if MatchDomain(host, site.Domain) {
			return true
		}
	}
	return false
}

// MatchDomain reports whether host is domain or a subdomain of it.
func MatchDomain(host, domain string) bool {
	host, domain = strings.ToLower(host), strings.ToLower(domain)
	if host == "" || domain == "" {
		return false
	}
	return host == domain || strings.HasSuffix(host, "."+domain)
}
