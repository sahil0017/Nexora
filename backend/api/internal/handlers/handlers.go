package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/nexora/platform/backend/api/internal/config"
)

// Handler holds shared dependencies for top-level endpoints.
type Handler struct {
	cfg    *config.Config
	logger *slog.Logger
}

func New(cfg *config.Config, logger *slog.Logger) *Handler {
	return &Handler{cfg: cfg, logger: logger}
}

type healthResponse struct {
	Status   string    `json:"status"`
	Service  string    `json:"service"`
	Version  string    `json:"version"`
	Time     time.Time `json:"time"`
	Database string    `json:"database"`
	Redis    string    `json:"redis"`
}

func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{
		Status:   "ok",
		Service:  "nexora-api",
		Version:  "0.1.0",
		Time:     time.Now().UTC(),
		Database: "unknown",
		Redis:    "unknown",
	})
}

func (h *Handler) Ready(w http.ResponseWriter, _ *http.Request) {
	// Dependency checks (PostgreSQL, Redis, Redpanda) will be wired in M1.
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
