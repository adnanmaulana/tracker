package db

import (
	"testing"
	"time"
)

func TestMonthlyPartitionsCrossesYear(t *testing.T) {
	specs := MonthlyPartitions(time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC), 2)
	want := []string{"events_2026_11", "events_2026_12", "events_2027_01"}
	if len(specs) != len(want) {
		t.Fatalf("got %d specs", len(specs))
	}
	for i, s := range specs {
		if s.Name != want[i] {
			t.Errorf("spec %d = %s, want %s", i, s.Name, want[i])
		}
		if !s.End.Equal(s.Start.AddDate(0, 1, 0)) {
			t.Errorf("%s does not span one month", s.Name)
		}
	}
}
