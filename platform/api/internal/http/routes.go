// Package httpapi registers all public HTTP routes.
package httpapi

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/config"
	"github.com/nexora/platform/api/internal/handlers"
	"github.com/nexora/platform/api/internal/modules/finance"
	"github.com/nexora/platform/api/internal/modules/mobility"
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
	if pg != nil {
		mobRepo = mobility.NewPostgresRepository(pg)
		finRepo = finance.NewPostgresRepository(pg)
	}
	sharedCache := cache.New(cfg.RedisURL)
	mobSvc := mobility.NewService(mobRepo, mobility.HeuristicRoutingProvider{}, mobility.NewMLClient(cfg.MLServiceURL), logger).
		WithCache(sharedCache)
	finSvc := finance.NewService(finRepo, finance.NewMLClient(cfg.MLServiceURL), finance.NewEnvelopeVault(cfg.FinanceMasterKey), logger).
		WithCache(sharedCache)

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
	})
}
