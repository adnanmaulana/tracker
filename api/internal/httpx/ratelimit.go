package httpx

import (
	"context"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter is a per-IP token bucket.
type RateLimiter struct {
	limit      rate.Limit
	burst      int
	trustProxy bool

	mu      sync.Mutex
	clients map[string]*client
}

type client struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

func NewRateLimiter(perSecond float64, burst int, trustProxy bool) *RateLimiter {
	return &RateLimiter{
		limit:      rate.Limit(perSecond),
		burst:      burst,
		trustProxy: trustProxy,
		clients:    map[string]*client{},
	}
}

func (rl *RateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	c, ok := rl.clients[ip]
	if !ok {
		c = &client{lim: rate.NewLimiter(rl.limit, rl.burst)}
		rl.clients[ip] = c
	}
	c.lastSeen = time.Now()
	return c.lim.Allow()
}

// Cleanup drops idle clients every minute until ctx is cancelled.
func (rl *RateLimiter) Cleanup(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rl.mu.Lock()
			for ip, c := range rl.clients {
				if time.Since(c.lastSeen) > 3*time.Minute {
					delete(rl.clients, ip)
				}
			}
			rl.mu.Unlock()
		}
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(ClientIP(r, rl.trustProxy)) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
