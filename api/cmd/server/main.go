package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // the distroless image has no zoneinfo; needed for ?tz=

	"monitoring-tools/api/internal/buffer"
	"monitoring-tools/api/internal/config"
	"monitoring-tools/api/internal/db"
	"monitoring-tools/api/internal/geo"
	"monitoring-tools/api/internal/httpx"
	"monitoring-tools/api/internal/ingest"
	"monitoring-tools/api/internal/sites"
	"monitoring-tools/api/internal/stats"
	"monitoring-tools/api/static"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	if err := db.EnsurePartitions(ctx, pool, time.Now(), 2); err != nil {
		return err
	}
	go func() { // keep upcoming partitions in place
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := db.EnsurePartitions(ctx, pool, time.Now(), 2); err != nil {
					log.Error("ensure partitions", "err", err)
				}
			}
		}
	}()

	siteStore := sites.NewStore(pool, log)
	if err := siteStore.Refresh(ctx); err != nil {
		return err
	}
	go siteStore.Run(ctx, time.Minute)

	locator, err := geo.Open(cfg.GeoIPDB)
	if err != nil {
		return err
	}
	defer locator.Close()
	if locator.Enabled() {
		log.Info("location lookup enabled", "db", cfg.GeoIPDB)
	} else {
		log.Info("location lookup disabled (GEOIP_DB not set)")
	}

	// The buffer gets its own context so it can drain after the HTTP server stops.
	bufCtx, stopBuf := context.WithCancel(context.Background())
	buf := buffer.New(pool, log, cfg.BatchSize, cfg.FlushInterval)
	go buf.Run(bufCtx)

	limiter := httpx.NewRateLimiter(20, 60, cfg.TrustProxy)
	go limiter.Cleanup(ctx)

	ing := &ingest.Handler{
		Sites:      siteStore,
		Sink:       buf,
		Enricher:   ingest.NewEnricher(cfg.HashSecret),
		Geo:        locator,
		ServerKey:  cfg.ServerKey,
		TrustProxy: cfg.TrustProxy,
		Log:        log,

		AllowLocalhost: cfg.AllowLocal,
	}
	if cfg.AllowLocal {
		log.Warn("ALLOW_LOCALHOST is on: accepting events from localhost for every site (dev only)")
	}

	mux := http.NewServeMux()
	mux.Handle("POST /e", limiter.Middleware(http.HandlerFunc(ing.Collect)))
	mux.HandleFunc("OPTIONS /e", ing.Preflight)
	mux.HandleFunc("GET /t.js", static.TrackerHandler)

	statsHandler := &stats.Handler{
		Store: stats.NewStore(pool),
		Sites: siteStore,
		Token: cfg.APIToken,
		Log:   log,
	}
	statsHandler.Register(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		stopBuf()
		buf.Wait()
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("http shutdown", "err", err)
	}
	stopBuf()
	buf.Wait()
	log.Info("bye")
	return nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	if err := l.UnmarshalText([]byte(level)); err != nil {
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
