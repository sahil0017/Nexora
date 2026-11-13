-- NEXORA Health: Separated Sensor Measurement, Research Inference, and Clinical Reference Validation Schema

CREATE TABLE IF NOT EXISTS health_sensor_devices (
    device_id          TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    signal_source      TEXT NOT NULL,
    capabilities_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
    calibration_status TEXT NOT NULL DEFAULT 'uncalibrated',
    connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_sensor_sessions (
    session_id          TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    device_id           TEXT REFERENCES health_sensor_devices(device_id),
    protocol            TEXT NOT NULL,
    is_simulated        BOOLEAN NOT NULL DEFAULT FALSE,
    consent_scope       TEXT NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS health_physiological_features (
    feature_id          TEXT PRIMARY KEY,
    session_id          TEXT,
    user_id             TEXT NOT NULL,
    idempotency_key     TEXT UNIQUE,
    feature_name        TEXT NOT NULL,
    numeric_value       DOUBLE PRECISION,
    category_value      TEXT,
    unit                TEXT NOT NULL,
    signal_source       TEXT NOT NULL,
    measurement_status  TEXT NOT NULL,
    signal_quality      DOUBLE PRECISION NOT NULL,
    algorithm_version   TEXT NOT NULL,
    missing_reason      TEXT,
    device_timestamp_ms BIGINT NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_phys_features_user_time
    ON health_physiological_features (user_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS health_research_predictions (
    prediction_id       TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    cohort_id           TEXT,
    target              TEXT NOT NULL,
    estimate_value      DOUBLE PRECISION NOT NULL,
    unit                TEXT NOT NULL,
    ci_95_low           DOUBLE PRECISION NOT NULL,
    ci_95_high          DOUBLE PRECISION NOT NULL,
    epistemic_std       DOUBLE PRECISION NOT NULL,
    aleatoric_std       DOUBLE PRECISION NOT NULL,
    available_modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_modalities  JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    model_stage         TEXT NOT NULL,
    model_version       TEXT NOT NULL,
    is_fallback         BOOLEAN NOT NULL DEFAULT FALSE,
    claim_guardrail     TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_reference_measurements (
    reference_id                 TEXT PRIMARY KEY,
    user_id                      TEXT NOT NULL,
    cohort_id                    TEXT NOT NULL,
    site_id                      TEXT NOT NULL,
    scanner_field_t              DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    surrogate_type               TEXT NOT NULL,
    dti_alps_index               DOUBLE PRECISION,
    csf_pulsatile_velocity_cm_s  DOUBLE PRECISION,
    bold_csf_coupling_r          DOUBLE PRECISION,
    pvs_burden_score             DOUBLE PRECISION,
    quality_score                DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    paired_prediction_id         TEXT,
    acquired_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_sensor_permissions (
    permission_id       TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    consent_scope       TEXT NOT NULL,
    granted             BOOLEAN NOT NULL,
    revoked_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_sensor_observations (
    observation_id      TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    session_id          TEXT,
    s3_object_key       TEXT NOT NULL,
    sha256_ciphertext   TEXT NOT NULL,
    sample_count        INTEGER NOT NULL,
    sample_rate_hz      DOUBLE PRECISION NOT NULL,
    device_timestamp_ms BIGINT NOT NULL,
    monotonic_ms        BIGINT NOT NULL,
    sync_uncertainty_ms DOUBLE PRECISION NOT NULL,
    consent_scope       TEXT NOT NULL,
    revoked             BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_validation_runs (
    run_id              TEXT PRIMARY KEY,
    surrogate_target    TEXT NOT NULL,
    sample_count        INTEGER NOT NULL,
    lin_ccc             DOUBLE PRECISION NOT NULL,
    pearson_r           DOUBLE PRECISION NOT NULL,
    mae                 DOUBLE PRECISION NOT NULL,
    rmse                DOUBLE PRECISION NOT NULL,
    multi_night_icc     DOUBLE PRECISION,
    icc_formulation     TEXT NOT NULL,
    validation_passed   BOOLEAN NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
