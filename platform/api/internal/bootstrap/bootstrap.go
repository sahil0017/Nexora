// Package bootstrap wires configuration, logging and the HTTP router.
package bootstrap

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/config"
	httpapi "github.com/nexora/platform/api/internal/http"
	"github.com/nexora/platform/api/internal/platform/database"
	"github.com/nexora/platform/api/internal/platform/events"
	"github.com/nexora/platform/api/internal/storage"
)

type App struct {
	Config *config.Config
	Router http.Handler
	Logger *slog.Logger
	DB     *pgxpool.Pool
}

func New(logger *slog.Logger) *App {
	cfg := config.Load()

	// PostgreSQL + PostGIS (RDS in production, local container in dev).
	var pg *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		pool, err := database.Connect(context.Background(), cfg.DatabaseURL)
		if err != nil {
			logger.Error("PostgreSQL connection failed, continuing without SQL persistence", "err", err)
		} else {
			logger.Info("database: PostgreSQL connected")
			pg = pool
		}
	} else {
		logger.Warn("DATABASE_URL not set; SQL persistence disabled")
	}

	// Document storage: AWS DynamoDB + AWS config for SNS/SQS event publishing.
	var docs storage.DocumentStore
	awsCfg, awsErr := awsconfig.LoadDefaultConfig(context.Background())
	if cfg.AWSTableName != "" {
		if awsErr != nil {
			logger.Error("AWS config load failed, continuing without document storage", "err", awsErr)
		} else {
			ddb := storage.NewDynamoDBClient(awsCfg)
			candidate := storage.NewDynamoDBStore(ddb, cfg.AWSTableName)
			if err := candidate.Ping(context.Background()); err != nil {
				logger.Error("DynamoDB unreachable, continuing without document storage", "err", err)
			} else {
				logger.Info("document storage: AWS DynamoDB", "table", cfg.AWSTableName)
				docs = candidate
			}
		}
	} else {
		logger.Warn("no document storage configured; document endpoints disabled")
	}

	if pg != nil {
		var awsCfgPtr *aws.Config
		if awsErr == nil {
			awsCfgPtr = &awsCfg
		}
		events.NewOutboxRelay(pg, awsCfgPtr, cfg.SNSEventsTopicARN, cfg.MLServiceURL, logger).Start(context.Background())
		logger.Info("event outbox relay started", "sns_topic", cfg.SNSEventsTopicARN, "ml_url", cfg.MLServiceURL)
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	httpapi.RegisterRoutes(r, cfg, logger, pg, docs)

	return &App{
		Config: cfg,
		Router: r,
		Logger: logger,
		DB:     pg,
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Request-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
