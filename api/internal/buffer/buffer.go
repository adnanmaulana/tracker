// Package buffer batches events in memory and writes them to Postgres with COPY.
package buffer

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"monitoring-tools/api/internal/event"
)

var columns = []string{
	"site_id", "name", "ts", "session_id", "visitor_id", "path", "referrer",
	"utm_source", "utm_medium", "utm_campaign", "country", "device", "browser", "os", "props",
}

type Buffer struct {
	pool     *pgxpool.Pool
	log      *slog.Logger
	ch       chan event.Event
	size     int
	interval time.Duration
	done     chan struct{}
}

func New(pool *pgxpool.Pool, log *slog.Logger, size int, interval time.Duration) *Buffer {
	return &Buffer{
		pool:     pool,
		log:      log,
		ch:       make(chan event.Event, size*4),
		size:     size,
		interval: interval,
		done:     make(chan struct{}),
	}
}

// Add enqueues an event without blocking. It returns false if the buffer is full.
func (b *Buffer) Add(e event.Event) bool {
	select {
	case b.ch <- e:
		return true
	default:
		return false
	}
}

// Run flushes batches until ctx is cancelled, then drains whatever is left.
func (b *Buffer) Run(ctx context.Context) {
	defer close(b.done)
	t := time.NewTicker(b.interval)
	defer t.Stop()

	batch := make([]event.Event, 0, b.size)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := b.write(fctx, batch); err != nil {
			b.log.Error("flush events", "count", len(batch), "err", err)
		} else {
			b.log.Debug("flushed events", "count", len(batch))
		}
		batch = batch[:0]
	}

	for {
		select {
		case e := <-b.ch:
			batch = append(batch, e)
			if len(batch) >= b.size {
				flush()
			}
		case <-t.C:
			flush()
		case <-ctx.Done():
			for {
				select {
				case e := <-b.ch:
					batch = append(batch, e)
					if len(batch) >= b.size {
						flush()
					}
				default:
					flush()
					return
				}
			}
		}
	}
}

// Wait blocks until Run has returned (after the final flush).
func (b *Buffer) Wait() { <-b.done }

func (b *Buffer) write(ctx context.Context, batch []event.Event) error {
	_, err := b.pool.CopyFrom(ctx, pgx.Identifier{"events"}, columns,
		pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
			e := batch[i]
			return []any{
				e.SiteID, e.Name, e.TS, e.SessionID, e.VisitorID,
				null(e.Path), null(e.Referrer), null(e.UTMSource), null(e.UTMMedium), null(e.UTMCampaign),
				null(e.Country), null(e.Device), null(e.Browser), null(e.OS), string(e.Props),
			}, nil
		}))
	return err
}

func null(s string) any {
	if s == "" {
		return nil
	}
	return s
}
