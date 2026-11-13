package health

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// IngestEvent represents an asynchronous sensor-feature ingestion job.
type IngestEvent struct {
	EventID    string
	EventType  string
	EnqueuedAt time.Time
	Request    SensorIngestRequest
}

// QueueStats exposes live metrics for the event-driven health ingestion queue.
type QueueStats struct {
	QueueDepth   int   `json:"queue_depth"`
	Capacity     int   `json:"capacity"`
	Enqueued     int64 `json:"enqueued"`
	Processed    int64 `json:"processed"`
	Deduplicated int64 `json:"deduplicated"`
	Dropped      int64 `json:"dropped"`
}

// IngestQueue decouples high-frequency mobile feature ingestion from ML processing and DB persistence.
type IngestQueue struct {
	ch           chan IngestEvent
	svc          *Service
	logger       *slog.Logger
	mu           sync.Mutex
	seenKeys     map[string]time.Time
	enqueued     atomic.Int64
	processed    atomic.Int64
	deduplicated atomic.Int64
	dropped      atomic.Int64
	stopCh       chan struct{}
	stopOnce     sync.Once
	wg           sync.WaitGroup
}

func NewIngestQueue(svc *Service, capacity, workers int, logger *slog.Logger) *IngestQueue {
	if capacity <= 0 {
		capacity = 256
	}
	if workers <= 0 {
		workers = 2
	}
	if logger == nil {
		logger = slog.Default()
	}
	q := &IngestQueue{
		ch:       make(chan IngestEvent, capacity),
		svc:      svc,
		logger:   logger,
		seenKeys: make(map[string]time.Time),
		stopCh:   make(chan struct{}),
	}
	for i := 0; i < workers; i++ {
		q.wg.Add(1)
		go q.worker()
	}
	q.wg.Add(1)
	go q.outboxLoop()
	return q
}

// Enqueue submits an ingestion event non-blockingly, deduplicating by IdempotencyKey.
func (q *IngestQueue) Enqueue(req SensorIngestRequest) (eventID string, status string) {
	if req.IdempotencyKey != "" {
		q.mu.Lock()
		if _, exists := q.seenKeys[req.IdempotencyKey]; exists {
			q.mu.Unlock()
			q.deduplicated.Add(1)
			return req.IdempotencyKey, "deduplicated"
		}
		if len(q.seenKeys) > 4096 {
			q.seenKeys = make(map[string]time.Time)
		}
		q.seenKeys[req.IdempotencyKey] = time.Now().UTC()
		q.mu.Unlock()
	}

	evID := newID("hev")
	ev := IngestEvent{
		EventID:    evID,
		EventType:  "health.features.ingested.v1",
		EnqueuedAt: time.Now().UTC(),
		Request:    req,
	}

	select {
	case q.ch <- ev:
		q.enqueued.Add(1)
		return evID, "queued"
	default:
		q.dropped.Add(1)
		return evID, "dropped_backpressure"
	}
}

func (q *IngestQueue) worker() {
	defer q.wg.Done()
	for ev := range q.ch {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if _, err := q.svc.processAndPersistIngest(ctx, ev.Request); err != nil {
			q.logger.Warn("async health ingest worker failed", "event_id", ev.EventID, "err", err)
		} else {
			q.processed.Add(1)
		}
		cancel()
	}
}

func (q *IngestQueue) outboxLoop() {
	defer q.wg.Done()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-q.stopCh:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			q.svc.FlushOutbox(ctx, 25)
			cancel()
		}
	}
}

func (q *IngestQueue) Stats() QueueStats {
	return QueueStats{
		QueueDepth:   len(q.ch),
		Capacity:     cap(q.ch),
		Enqueued:     q.enqueued.Load(),
		Processed:    q.processed.Load(),
		Deduplicated: q.deduplicated.Load(),
		Dropped:      q.dropped.Load(),
	}
}

func (q *IngestQueue) Close() {
	q.stopOnce.Do(func() {
		close(q.stopCh)
		close(q.ch)
		q.wg.Wait()
	})
}
