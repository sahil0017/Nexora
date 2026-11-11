// Package config loads runtime configuration from environment variables.
package config

import "os"

type Config struct {
	Env          string
	HTTPPort     string
	DatabaseURL  string
	RedisURL     string
	KafkaBrokers string
	MLServiceURL string
}

func Load() *Config {
	return &Config{
		Env:          getenv("APP_ENV", "development"),
		HTTPPort:     getenv("HTTP_PORT", "8080"),
		DatabaseURL:  getenv("DATABASE_URL", ""),
		RedisURL:     getenv("REDIS_URL", ""),
		KafkaBrokers: getenv("KAFKA_BROKERS", ""),
		MLServiceURL: getenv("ML_SERVICE_URL", "http://localhost:8000"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
