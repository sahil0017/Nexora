package bootstrap

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeadersMiddleware(t *testing.T) {
	handler := securityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("missing nosniff header")
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("missing DENY frame header")
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected Cache-Control: no-store on /api/ routes")
	}
}

func TestIPRateLimiter(t *testing.T) {
	lim := newIPRateLimiter(60, 2)
	handler := lim.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
		req.RemoteAddr = "198.51.100.1:1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 on request %d, got %d", i, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.RemoteAddr = "198.51.100.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on burst overflow, got %d", rec.Code)
	}
}

func TestMaxBodyMiddleware(t *testing.T) {
	handler := maxBodyMiddleware(16)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "too large", http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me", bytes.NewReader(bytes.Repeat([]byte("a"), 64)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversized body, got %d", rec.Code)
	}
}
