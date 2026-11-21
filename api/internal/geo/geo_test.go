package geo

import (
	"os"
	"testing"
)

func TestDisabledFindsNothing(t *testing.T) {
	l, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	if l.Enabled() || l.Lookup("8.8.8.8") != (Location{}) {
		t.Fatal("expected empty locator")
	}
	var nilL *Locator
	if nilL.Lookup("8.8.8.8") != (Location{}) {
		t.Fatal("nil locator should find nothing")
	}
}

// Runs against a real database when GEOIP_TEST_DB points at one.
func TestLookupRealDB(t *testing.T) {
	path := os.Getenv("GEOIP_TEST_DB")
	if path == "" {
		t.Skip("GEOIP_TEST_DB not set")
	}
	l, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := l.Lookup("8.8.8.8"); got.Country != "US" {
		t.Fatalf("8.8.8.8: got %+v", got)
	}
	if got := l.Lookup("192.168.1.10"); got != (Location{}) {
		t.Fatalf("private IP should be empty, got %+v", got)
	}
	if got := l.Lookup("not-an-ip"); got != (Location{}) {
		t.Fatalf("bad IP should be empty, got %+v", got)
	}
	t.Logf("103.193.179.175 -> %+v", l.Lookup("103.193.179.175"))
}
