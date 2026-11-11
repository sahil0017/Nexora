// Package httpapi registers all public HTTP routes.
package httpapi

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/nexora/platform/backend/api/internal/config"
	"github.com/nexora/platform/backend/api/internal/handlers"
	"github.com/nexora/platform/backend/api/internal/modules/mobility"
	"github.com/nexora/platform/backend/api/internal/platform/identity"
)

// RegisterRoutes mounts health, identity, assistant and module routes
// under the /api/v1 base path.
func RegisterRoutes(r chi.Router, cfg *config.Config, logger *slog.Logger) {
	h := handlers.New(cfg, logger)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Get("/healthz", h.Health)
		v1.Get("/readyz", h.Ready)

		// Platform: identity
		v1.Post("/auth/register", identity.HandleRegister)
		v1.Post("/auth/login", identity.HandleLogin)
		v1.Get("/me", identity.HandleMe)

		// Assistant
		v1.Post("/assistant/conversations", handlers.StartConversation)
		v1.Post("/assistant/conversations/{id}/messages", handlers.SendMessage)

		// Mobility module
		mobility.Mount(v1)
	})
}
