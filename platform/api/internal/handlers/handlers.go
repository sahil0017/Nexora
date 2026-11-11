package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/config"
	"github.com/nexora/platform/api/internal/platform/cache"
	"github.com/nexora/platform/api/internal/storage"
)

// Handler holds shared dependencies for top-level endpoints.
type Handler struct {
	cfg    *config.Config
	logger *slog.Logger
	pg     *pgxpool.Pool
	docs   storage.DocumentStore // nil => documents disabled
	redis  *cache.Client
}

func New(cfg *config.Config, logger *slog.Logger, pg *pgxpool.Pool, docs storage.DocumentStore) *Handler {
	return &Handler{
		cfg:    cfg,
		logger: logger,
		pg:     pg,
		docs:   docs,
		redis:  cache.New(cfg.RedisURL),
	}
}

type healthResponse struct {
	Status   string    `json:"status"`
	Service  string    `json:"service"`
	Version  string    `json:"version"`
	Time     time.Time `json:"time"`
	Database string    `json:"database"`
	DocStore string    `json:"docstore"`
	Redis    string    `json:"redis"`
}

func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	pgStatus := "not_configured"
	if h.pg != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		if err := h.pg.Ping(ctx); err != nil {
			h.logger.Error("health check: postgres ping failed", "err", err)
			pgStatus = "down"
		} else {
			pgStatus = "up"
		}
		cancel()
	}

	docStatus := "not_configured"
	if h.docs != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		if err := h.docs.Ping(ctx); err != nil {
			h.logger.Error("health check: docstore ping failed", "err", err)
			docStatus = "down"
		} else {
			docStatus = "up"
		}
		cancel()
	}

	redisStatus := "not_configured"
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
		if err := h.redis.Ping(ctx); err != nil {
			h.logger.Warn("health check: redis ping failed", "err", err)
			redisStatus = "down"
		} else {
			redisStatus = "up"
		}
		cancel()
	}

	writeJSON(w, http.StatusOK, healthResponse{
		Status:   "ok",
		Service:  "nexora-api",
		Version:  "0.1.0",
		Time:     time.Now().UTC(),
		Database: pgStatus,
		DocStore: docStatus,
		Redis:    redisStatus,
	})
}

func (h *Handler) Ready(w http.ResponseWriter, _ *http.Request) {
	if h.pg != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := h.pg.Ping(ctx)
		cancel()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "postgres_unreachable"})
			return
		}
	}
	if h.docs != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := h.docs.Ping(ctx)
		cancel()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "storage_unreachable"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
