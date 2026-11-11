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

	// AWS DynamoDB (document backend) + SNS/SQS (free-tier event bus).
	AWSRegion            string
	AWSTableName         string
	SNSEventsTopicARN    string
	SQSIntelligenceQueue string
}

func Load() *Config {
	return &Config{
		Env:          getenv("APP_ENV", "development"),
		HTTPPort:     getenv("HTTP_PORT", "8080"),
		DatabaseURL:  getenv("DATABASE_URL", ""),
		RedisURL:     getenv("REDIS_URL", ""),
		KafkaBrokers: getenv("KAFKA_BROKERS", ""),
		MLServiceURL: getenv("ML_SERVICE_URL", "http://localhost:8000"),

		AWSRegion:            getenv("AWS_REGION", ""),
		AWSTableName:         getenv("DDB_DOCS_TABLE", ""),
		SNSEventsTopicARN:    getenv("SNS_EVENTS_TOPIC_ARN", ""),
		SQSIntelligenceQueue: getenv("SQS_INTELLIGENCE_QUEUE_URL", ""),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
