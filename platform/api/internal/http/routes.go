// Package httpapi registers all public HTTP routes.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/config"
	"github.com/nexora/platform/api/internal/handlers"
	"github.com/nexora/platform/api/internal/modules/finance"
	"github.com/nexora/platform/api/internal/modules/health"
	"github.com/nexora/platform/api/internal/modules/mobility"
	"github.com/nexora/platform/api/internal/modules/privacy"
	"github.com/nexora/platform/api/internal/modules/voice"
	"github.com/nexora/platform/api/internal/platform/cache"
	"github.com/nexora/platform/api/internal/platform/identity"
	"github.com/nexora/platform/api/internal/storage"
)

// RegisterRoutes mounts health, identity, assistant, documents and module routes
// under the /api/v1 base path.
func RegisterRoutes(r chi.Router, cfg *config.Config, logger *slog.Logger, pg *pgxpool.Pool, docs storage.DocumentStore) {
	h := handlers.New(cfg, logger, pg, docs)
	idHandler := identity.NewHandler(pg)

	var mobRepo mobility.Repository
	var finRepo finance.Repository
	var voiceRepo voice.Repository
	var healthRepo health.Repository
	if pg != nil {
		mobRepo = mobility.NewPostgresRepository(pg)
		finRepo = finance.NewPostgresRepository(pg)
		voiceRepo = voice.NewPostgresRepository(pg)
		healthRepo = health.NewPostgresRepository(pg)
	}
	sharedCache := cache.New(cfg.RedisURL)
	mobSvc := mobility.NewService(mobRepo, mobility.HeuristicRoutingProvider{}, mobility.NewMLClient(cfg.MLServiceURL), logger).
		WithCache(sharedCache)
	finSvc := finance.NewService(finRepo, finance.NewMLClient(cfg.MLServiceURL), finance.NewEnvelopeVault(cfg.FinanceMasterKey), logger).
		WithCache(sharedCache)
	voiceSvc := voice.NewService(voiceRepo, voice.NewMLClient(cfg.MLServiceURL), voice.NewVoiceVault(cfg.FinanceMasterKey), logger).
		WithCache(sharedCache)
	healthSvc := health.NewService(healthRepo, health.NewMLClient(cfg.MLServiceURL), logger)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Get("/healthz", h.Health)
		v1.Get("/readyz", h.Ready)

		// Platform: identity
		v1.Post("/auth/register", idHandler.Register)
		v1.Post("/auth/login", idHandler.Login)
		v1.Get("/me", idHandler.Me)

		// Documents (DynamoDB)
		v1.Post("/documents", h.PutDocument)
		v1.Get("/documents", h.ListDocuments)
		v1.Get("/documents/{id}", h.GetDocument)
		v1.Delete("/documents/{id}", h.DeleteDocument)

		// Assistant
		v1.Post("/assistant/conversations", handlers.StartConversation)
		v1.Post("/assistant/conversations/{id}/messages", handlers.SendMessage)

		// Mobility module (MoveSmart Feature 1)
		mobility.Mount(v1, mobSvc)

		// Finance Intelligence Network module
		finance.Mount(v1, finSvc)

		// Voice Intelligence Platform module
		voice.Mount(v1, voiceSvc)

		// Health & Sleep-Related Brain Clearance Research module
		health.Mount(v1, healthSvc)

		// User Privacy & Permissions Persistence module
		privacy.Mount(v1, privacy.NewHandler(pg))

		// Deep Learning Intelligence Gateway (proxies all 16 architectures to nexora-ml)
		mountDeepGateway(v1, cfg.MLServiceURL, logger)
	})
}

func mountDeepGateway(r chi.Router, mlBaseURL string, logger *slog.Logger) {
	trimmed := strings.TrimRight(strings.TrimSpace(mlBaseURL), "/")
	if trimmed == "" {
		trimmed = "http://localhost:8000"
	}
	targetURL, err := url.Parse(trimmed)
	if err != nil {
		logger.Error("invalid MLServiceURL for deep gateway", "url", mlBaseURL, "err", err)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		// Map /api/v1/deep/* to /v1/deep/*
		subPath := strings.TrimPrefix(req.URL.Path, "/api/v1")
		req.URL.Path = subPath
		req.Host = targetURL.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Warn("deep ML gateway proxy error", "path", r.URL.Path, "err", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK) // Return 200 with degraded envelope so mobile UI handles offline brain smoothly
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":          "degraded",
			"brain_reachable": false,
			"error":           "Deep ML brain unreachable or offline",
			"path":            r.URL.Path,
		})
	}

	r.HandleFunc("/deep", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/api/v1/deep/status"
		proxy.ServeHTTP(w, r)
	})
	r.HandleFunc("/deep/*", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})
}
