package config

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Host          string // interface to bind; empty means all
	Port          string
	DatabaseURL   string
	HashSecret    string        // secret used to derive the daily visitor-hash salt
	ServerKey     string        // if set, requests without an Origin must send "Authorization: Bearer <key>"
	APIToken      string        // bearer token for the stats API (used by the dashboard)
	TrustProxy    bool          // read client IP from X-Forwarded-For
	AllowLocal    bool          // accept browser events from localhost for any site (dev only)
	BatchSize     int           // flush the buffer when it holds this many events
	FlushInterval time.Duration // ...or after this long
	LogLevel      string
}

func Load() (Config, error) {
	c := Config{
		Host:          os.Getenv("HOST"),
		Port:          env("PORT", "8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		HashSecret:    os.Getenv("HASH_SECRET"),
		ServerKey:     os.Getenv("SERVER_KEY"),
		APIToken:      os.Getenv("API_TOKEN"),
		TrustProxy:    envBool("TRUST_PROXY", false),
		AllowLocal:    envBool("ALLOW_LOCALHOST", false),
		BatchSize:     envInt("BATCH_SIZE", 500),
		FlushInterval: envDuration("FLUSH_INTERVAL", 2*time.Second),
		LogLevel:      env("LOG_LEVEL", "info"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if c.HashSecret == "" {
		return c, errors.New("HASH_SECRET is required")
	}
	if len(c.APIToken) < 16 {
		return c, errors.New("API_TOKEN is required (at least 16 chars)")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envBool(k string, def bool) bool {
	if v, err := strconv.ParseBool(os.Getenv(k)); err == nil {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}

func envDuration(k string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}
