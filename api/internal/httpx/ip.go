package httpx

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the caller's IP. With trustProxy it uses the last X-Forwarded-For entry,
// the one our own proxy appended (earlier entries are client-supplied and can be forged).
// Only enable it when the API sits behind a single proxy you control.
func ClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			last := xff[strings.LastIndexByte(xff, ',')+1:]
			if ip := strings.TrimSpace(last); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
