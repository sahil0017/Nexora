// Package events provides transactional outbox helpers and the AWS SNS / ML relay worker.
package events

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBTX is satisfied by both *pgxpool.Pool and pgx.Tx.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// EnqueueOutbox writes an event into platform.event_outbox within the caller's transaction.
func EnqueueOutbox(ctx context.Context, db DBTX, eventType, aggregateType, aggregateID, partitionKey string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("outbox marshal %s: %w", eventType, err)
	}
	_, err = db.Exec(ctx,
		`INSERT INTO platform.event_outbox (event_type, schema_version, aggregate_type, aggregate_id, partition_key, payload)
		 VALUES ($1, 1, $2, $3, $4, $5::jsonb)`,
		eventType, aggregateType, aggregateID, partitionKey, string(raw),
	)
	if err != nil {
		return fmt.Errorf("outbox insert %s: %w", eventType, err)
	}
	return nil
}

// OutboxRelay drains unpublished rows from platform.event_outbox and publishes them to AWS SNS and nexora-ml.
type OutboxRelay struct {
	pool        *pgxpool.Pool
	awsCfg      *aws.Config
	snsTopicARN string
	mlBaseURL   string
	httpClient  *http.Client
	logger      *slog.Logger
}

// NewOutboxRelay creates a background relay worker.
func NewOutboxRelay(pool *pgxpool.Pool, awsCfg *aws.Config, snsTopicARN, mlBaseURL string, logger *slog.Logger) *OutboxRelay {
	return &OutboxRelay{
		pool:        pool,
		awsCfg:      awsCfg,
		snsTopicARN: strings.TrimSpace(snsTopicARN),
		mlBaseURL:   strings.TrimRight(strings.TrimSpace(mlBaseURL), "/"),
		httpClient:  &http.Client{Timeout: 3 * time.Second},
		logger:      logger,
	}
}

// Start runs the periodic outbox drain loop in a goroutine until ctx is cancelled.
func (r *OutboxRelay) Start(ctx context.Context) {
	if r == nil || r.pool == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.FlushBatch(ctx)
			}
		}
	}()
}

// FlushBatch publishes up to 25 pending outbox events.
func (r *OutboxRelay) FlushBatch(ctx context.Context) int {
	if r == nil || r.pool == nil {
		return 0
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, event_type, schema_version, occurred_at, payload
		 FROM platform.event_outbox
		 WHERE published_at IS NULL AND attempts < 10
		 ORDER BY occurred_at ASC
		 LIMIT 25`,
	)
	if err != nil {
		return 0
	}
	type rowItem struct {
		id         string
		eventType  string
		version    int
		occurredAt time.Time
		payload    json.RawMessage
	}
	var batch []rowItem
	for rows.Next() {
		var it rowItem
		if scanErr := rows.Scan(&it.id, &it.eventType, &it.version, &it.occurredAt, &it.payload); scanErr == nil {
			batch = append(batch, it)
		}
	}
	rows.Close()

	published := 0
	for _, it := range batch {
		envelope := map[string]any{
			"event_id":       it.id,
			"event_type":     it.eventType,
			"schema_version": it.version,
			"occurred_at":    it.occurredAt.UTC().Format(time.RFC3339),
			"ingested_at":    time.Now().UTC().Format(time.RFC3339),
			"producer":       "nexora-api",
			"payload":        it.payload,
		}
		rawEnv, _ := json.Marshal(envelope)

		var pubErr error
		if r.snsTopicARN != "" && r.awsCfg != nil {
			pubErr = r.publishSNS(ctx, string(rawEnv), it.eventType)
		}
		if r.mlBaseURL != "" {
			if mlErr := r.forwardToML(ctx, rawEnv); mlErr != nil && pubErr == nil && r.snsTopicARN == "" {
				pubErr = mlErr
			}
		}

		if pubErr != nil {
			_, _ = r.pool.Exec(ctx,
				`UPDATE platform.event_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
				it.id, pubErr.Error(),
			)
			continue
		}
		_, _ = r.pool.Exec(ctx,
			`UPDATE platform.event_outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
			it.id,
		)
		published++
	}
	return published
}

func (r *OutboxRelay) publishSNS(ctx context.Context, messageJSON, eventType string) error {
	region := r.awsCfg.Region
	if region == "" {
		region = "ap-south-1"
	}
	endpoint := fmt.Sprintf("https://sns.%s.amazonaws.com/", region)
	form := url.Values{}
	form.Set("Action", "Publish")
	form.Set("Version", "2010-03-31")
	form.Set("TopicArn", r.snsTopicARN)
	form.Set("Message", messageJSON)
	form.Set("MessageAttributes.entry.1.Name", "event_type")
	form.Set("MessageAttributes.entry.1.Value.DataType", "String")
	form.Set("MessageAttributes.entry.1.Value.StringValue", eventType)
	bodyStr := form.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(bodyStr))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")

	creds, err := r.awsCfg.Credentials.Retrieve(ctx)
	if err != nil {
		return fmt.Errorf("sns retrieve credentials: %w", err)
	}
	sum := sha256.Sum256([]byte(bodyStr))
	payloadHash := hex.EncodeToString(sum[:])

	signer := v4.NewSigner()
	if err := signer.SignHTTP(ctx, creds, req, payloadHash, "sns", region, time.Now().UTC()); err != nil {
		return fmt.Errorf("sns sign request: %w", err)
	}

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("sns http post: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("sns publish status %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func (r *OutboxRelay) forwardToML(ctx context.Context, rawEnvelope []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.mlBaseURL+"/v1/events/ingest", bytes.NewReader(rawEnvelope))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ml ingest status %d", resp.StatusCode)
	}
	return nil
}
