package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name, xff string
		trust     bool
		want      string
	}{
		{"no proxy ignores header", "1.1.1.1", false, "10.0.0.9"},
		{"single entry", "1.1.1.1", true, "1.1.1.1"},
		{"forged prefix is ignored", "6.6.6.6, 1.1.1.1", true, "1.1.1.1"},
		{"no header falls back", "", true, "10.0.0.9"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/e", nil)
			r.RemoteAddr = "10.0.0.9:5555"
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := ClientIP(r, c.trust); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
