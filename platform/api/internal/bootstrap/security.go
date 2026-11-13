package bootstrap

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// securityHeadersMiddleware applies strict transport, MIME, framing, and cache-control headers.
func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// maxBodyMiddleware caps incoming request bodies to prevent oversized payload DoS.
func maxBodyMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

type rateBucket struct {
	tokens   float64
	lastSeen time.Time
}

// ipRateLimiter enforces a per-IP token bucket while exempting health/readiness probes.
type ipRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*rateBucket
	rate    float64 // tokens per second
	burst   float64
}

func newIPRateLimiter(reqPerMinute, burst int) *ipRateLimiter {
	return &ipRateLimiter{
		buckets: make(map[string]*rateBucket),
		rate:    float64(reqPerMinute) / 60.0,
		burst:   float64(burst),
	}
}

func (l *ipRateLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.buckets) > 10000 {
		cutoff := now.Add(-5 * time.Minute)
		for k, b := range l.buckets {
			if b.lastSeen.Before(cutoff) {
				delete(l.buckets, k)
			}
		}
	}

	b, ok := l.buckets[ip]
	if !ok {
		l.buckets[ip] = &rateBucket{tokens: l.burst - 1, lastSeen: now}
		return true
	}

	elapsed := now.Sub(b.lastSeen).Seconds()
	if elapsed > 0 {
		b.tokens = min(l.burst, b.tokens+elapsed*l.rate)
	}
	b.lastSeen = now
	if b.tokens < 1 {
		return false
	}
	b.tokens -= 1
	return true
}

func (l *ipRateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/healthz" || r.URL.Path == "/api/v1/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r)
		if !l.allow(ip, time.Now()) {
			w.Header().Set("Retry-After", "10")
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first := strings.TrimSpace(strings.Split(xff, ",")[0])
		if first != "" {
			return first
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}
