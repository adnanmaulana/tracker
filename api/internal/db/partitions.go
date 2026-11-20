package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PartitionSpec describes one monthly partition of the events table.
type PartitionSpec struct {
	Name       string
	Start, End time.Time
}

// MonthlyPartitions returns partitions for the month containing now plus monthsAhead more.
func MonthlyPartitions(now time.Time, monthsAhead int) []PartitionSpec {
	now = now.UTC()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	specs := make([]PartitionSpec, 0, monthsAhead+1)
	for i := 0; i <= monthsAhead; i++ {
		start := first.AddDate(0, i, 0)
		specs = append(specs, PartitionSpec{
			Name:  fmt.Sprintf("events_%04d_%02d", start.Year(), int(start.Month())),
			Start: start,
			End:   start.AddDate(0, 1, 0),
		})
	}
	return specs
}

// EnsurePartitions creates any missing monthly partitions. Safe to call repeatedly.
func EnsurePartitions(ctx context.Context, pool *pgxpool.Pool, now time.Time, monthsAhead int) error {
	for _, p := range MonthlyPartitions(now, monthsAhead) {
		// Values are generated above (not user input), so formatting them in is safe.
		q := fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s PARTITION OF events FOR VALUES FROM ('%s') TO ('%s')`,
			p.Name, p.Start.Format(time.RFC3339), p.End.Format(time.RFC3339),
		)
		if _, err := pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("create partition %s: %w", p.Name, err)
		}
	}
	return nil
}
