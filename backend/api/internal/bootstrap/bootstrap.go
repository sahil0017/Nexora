// Package bootstrap wires configuration, logging and the HTTP router.
package bootstrap

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/nexora/platform/backend/api/internal/config"
	httpapi "github.com/nexora/platform/backend/api/internal/http"
)

type App struct {
	Config *config.Config
	Router http.Handler
	Logger *slog.Logger
}

func New(logger *slog.Logger) *App {
	cfg := config.Load()

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	httpapi.RegisterRoutes(r, cfg, logger)

	return &App{
		Config: cfg,
		Router: r,
		Logger: logger,
	}
}
