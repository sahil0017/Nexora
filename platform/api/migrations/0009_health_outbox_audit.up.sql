-- NEXORA Health: Durable Transactional Outbox, Consent Erasure Jobs, and Clinical Governance Audit Trail

CREATE TABLE IF NOT EXISTS health_ingest_outbox (
    outbox_id       TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    payload_json    JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_health_outbox_pending
    ON health_ingest_outbox (status, next_retry_at ASC);

CREATE TABLE IF NOT EXISTS health_erasure_jobs (
    job_id               TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    consent_scope        TEXT NOT NULL,
    observation_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status               TEXT NOT NULL DEFAULT 'pending',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS health_audit_log (
    audit_id      TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    details_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_audit_user_time
    ON health_audit_log (user_id, created_at DESC);
