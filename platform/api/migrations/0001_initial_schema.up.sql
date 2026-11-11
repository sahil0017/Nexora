-- NEXORA initial schema — v1 baseline
-- Conventions: UUID PKs (gen_random_uuid), UTC timestamps (timestamptz),
-- soft deletes via deleted_at, PostGIS geography for spatial data,
-- GiST spatial indexes, explicit ownership per logical schema.

-- ============================================================
-- SCHEMAS
-- ============================================================
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS intelligence;
CREATE SCHEMA IF NOT EXISTS mobility;
CREATE SCHEMA IF NOT EXISTS health;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS work;
CREATE SCHEMA IF NOT EXISTS audit;

-- ============================================================
-- 1. IDENTITY
-- ============================================================

CREATE TABLE identity.users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE NOT NULL,
    phone         TEXT UNIQUE,
    password_hash TEXT NOT NULL,              -- argon2id/bcrypt, never plaintext
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','deleted')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE TABLE identity.user_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_name TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON identity.user_sessions(user_id);

-- Trigger: keep updated_at fresh (shared across schemas)
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch BEFORE UPDATE ON identity.users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- 2. PLATFORM
-- ============================================================

CREATE TABLE platform.profiles (
    user_id      UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    locale       TEXT NOT NULL DEFAULT 'en-IN',
    timezone     TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    avatar_url   TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON platform.profiles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE platform.module_preferences (
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL CHECK (module_key IN ('move','health','finance','work','assistant')),
    enabled    BOOLEAN NOT NULL DEFAULT false,
    config     JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, module_key)
);
CREATE TRIGGER trg_modprefs_touch BEFORE UPDATE ON platform.module_preferences
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Permission = durable grant for resource/action pairs
CREATE TABLE platform.permissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL,
    resource   TEXT NOT NULL,               -- e.g. 'health.documents'
    action     TEXT NOT NULL,               -- 'read'|'write'|'delete'
    granted    BOOLEAN NOT NULL DEFAULT true,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, module_key, resource, action)
);

-- Purpose-scoped consent (separate from permissions: consents govern data USE)
CREATE TABLE platform.consent_records (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,               -- 'model_training','assistant_memory',...
    scope      TEXT NOT NULL,               -- 'mobility.location_raw','health.documents',...
    granted    BOOLEAN NOT NULL,
    granted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (granted = (granted_at IS NOT NULL))
);
CREATE INDEX idx_consent_user_purpose ON platform.consent_records(user_id, purpose);

CREATE TABLE platform.integrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,              -- 'google_calendar','strava',...
    status      TEXT NOT NULL DEFAULT 'connected'
                CHECK (status IN ('connected','expired','revoked')),
    secret_ref  TEXT,                       -- pointer into secret store; never raw tokens
    scopes      TEXT[] NOT NULL DEFAULT '{}',
    connected_at TIMESTAMPTZ,
    disconnected_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider)
);

CREATE TABLE platform.notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    payload    JSONB NOT NULL DEFAULT '{}',
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON platform.notifications(user_id, created_at DESC)
    WHERE read_at IS NULL;

-- ============================================================
-- 3. INTELLIGENCE (assistant, agents, memory)
-- ============================================================

CREATE TABLE intelligence.conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New conversation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_conversations_user ON intelligence.conversations(user_id, updated_at DESC);
CREATE TRIGGER trg_convos_touch BEFORE UPDATE ON intelligence.conversations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE intelligence.messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES intelligence.conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
    content         TEXT NOT NULL,
    tool_calls      JSONB,                  -- for assistant/tool role messages
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_convo ON intelligence.messages(conversation_id, created_at);

CREATE TABLE intelligence.agent_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES intelligence.conversations(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','awaiting_approval','completed','failed','cancelled')),
    intent       TEXT,
    result       JSONB,
    error        TEXT,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_runs_user ON intelligence.agent_runs(user_id, created_at DESC);

CREATE TABLE intelligence.tool_invocations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id UUID NOT NULL REFERENCES intelligence.agent_runs(id) ON DELETE CASCADE,
    tool_name    TEXT NOT NULL,
    module_key   TEXT NOT NULL,
    input_ref    JSONB,                     -- reference to inputs, not raw sensitive payloads
    output_ref   JSONB,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','succeeded','failed','denied')),
    risk_level   TEXT NOT NULL DEFAULT 'read'
                 CHECK (risk_level IN ('read','low_write','external_write','sensitive','high_impact')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every irreversible/sensitive action requires one of these
CREATE TABLE intelligence.action_approvals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id UUID NOT NULL REFERENCES intelligence.agent_runs(id) ON DELETE CASCADE,
    tool_invocation_id UUID REFERENCES intelligence.tool_invocations(id) ON DELETE CASCADE,
    action_summary TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','expired')),
    version      INTEGER NOT NULL DEFAULT 1, -- edited action => new approval row
    decided_at   TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived operational context references (NOT raw data copies)
CREATE TABLE intelligence.context_references (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL,
    resource_type TEXT NOT NULL,            -- 'health.document','finance.period',...
    resource_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ctxrefs_user ON intelligence.context_references(user_id, expires_at);

-- Long-term user memory: minimal, consent-scoped, encrypted-at-rest content refs
CREATE TABLE intelligence.memory_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    category      TEXT NOT NULL,            -- 'preference','fact','habit',...
    content_ref   TEXT NOT NULL,            -- ref into encrypted store
    consent_scope TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_memory_user ON intelligence.memory_items(user_id, category);

-- ============================================================
-- 4. MOBILITY (NEXORA Move)
-- ============================================================

CREATE TABLE mobility.saved_places (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    place_type TEXT NOT NULL DEFAULT 'custom'
               CHECK (place_type IN ('home','work','custom')),
    location   geography(POINT, 4326) NOT NULL,
    address    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_savedplaces_user ON mobility.saved_places(user_id);
CREATE INDEX idx_savedplaces_loc ON mobility.saved_places USING GIST(location);

CREATE TABLE mobility.trips (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','active','completed','cancelled')),
    primary_mode TEXT NOT NULL
                 CHECK (primary_mode IN ('walk','bicycle','two_wheeler','car','bus','metro','multimodal')),
    origin       geography(POINT, 4326) NOT NULL,
    destination  geography(POINT, 4326),
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trips_user ON mobility.trips(user_id, started_at DESC);

CREATE TABLE mobility.trip_legs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id   UUID NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    mode      TEXT NOT NULL CHECK (mode IN ('walk','bicycle','two_wheeler','car','bus','metro')),
    sequence  INT NOT NULL,
    origin    geography(POINT, 4326) NOT NULL,
    destination geography(POINT, 4326) NOT NULL,
    distance_m DOUBLE PRECISION,
    duration_s INT,
    UNIQUE (trip_id, sequence)
);

CREATE TABLE mobility.route_options (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id      UUID NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,             -- 'valhalla','osrm','google',...
    mode_sequence TEXT[] NOT NULL,
    distance_m   DOUBLE PRECISION NOT NULL,
    predicted_duration_s INT NOT NULL,
    eta_p50_s    INT,
    eta_p90_s    INT,
    reliability  TEXT NOT NULL DEFAULT 'medium'
                 CHECK (reliability IN ('low','medium','high')),
    geometry     geography(MULTILINESTRING, 4326),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_routeoptions_trip ON mobility.route_options(trip_id);

-- High-volume: partition by month. Parent + default child; worker adds future partitions.
CREATE TABLE mobility.location_samples (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    trip_id     UUID NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    location    geography(POINT, 4326) NOT NULL,
    speed_mps   REAL,
    heading_deg REAL,
    accuracy_m  REAL,
    recorded_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- differs from recorded_at by design
    PRIMARY KEY (recorded_at, id)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE mobility.location_samples_default
    PARTITION OF mobility.location_samples DEFAULT;
CREATE INDEX idx_locsamples_trip ON mobility.location_samples(trip_id, recorded_at);
CREATE INDEX idx_locsamples_loc  ON mobility.location_samples USING GIST(location);

CREATE TABLE mobility.road_segments (
    id          TEXT PRIMARY KEY,           -- OSM way-derived stable id
    city_id     TEXT NOT NULL DEFAULT 'hyd',
    geometry    geography(MULTILINESTRING, 4326) NOT NULL,
    length_m    DOUBLE PRECISION NOT NULL,
    speed_limit_kmph SMALLINT,
    road_class  TEXT,
    oneway      BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_roadsegments_city ON mobility.road_segments(city_id);
CREATE INDEX idx_roadsegments_geom ON mobility.road_segments USING GIST(geometry);

CREATE TABLE mobility.traffic_observations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    segment_id  TEXT NOT NULL REFERENCES mobility.road_segments(id),
    speed_kmph  REAL NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('probe','provider','gtfs_rt','user_report')),
    observed_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (observed_at, id)
) PARTITION BY RANGE (observed_at);

CREATE TABLE mobility.traffic_observations_default
    PARTITION OF mobility.traffic_observations DEFAULT;
CREATE INDEX idx_traffobs_segment ON mobility.traffic_observations(segment_id, observed_at DESC);

CREATE TABLE mobility.traffic_predictions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id   TEXT NOT NULL REFERENCES mobility.road_segments(id),
    model_version TEXT NOT NULL,
    horizon_min  SMALLINT NOT NULL CHECK (horizon_min IN (15,30,60,120)),
    predicted_speed_kmph REAL NOT NULL,
    uncertainty_low  REAL,
    uncertainty_high REAL,
    predicted_for TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (segment_id, predicted_for, horizon_min, model_version)
);

CREATE TABLE mobility.transit_stops (
    id        TEXT PRIMARY KEY,             -- GTFS stop_id
    city_id   TEXT NOT NULL DEFAULT 'hyd',
    name      TEXT NOT NULL,
    location  geography(POINT, 4326) NOT NULL,
    stop_type TEXT CHECK (stop_type IN ('bus','metro','rail','tram'))
);
CREATE INDEX idx_transitstops_loc ON mobility.transit_stops USING GIST(location);

CREATE TABLE mobility.transit_routes (
    id         TEXT PRIMARY KEY,            -- GTFS route_id
    agency_id  TEXT NOT NULL,
    short_name TEXT,
    long_name  TEXT,
    route_type SMALLINT NOT NULL,           -- GTFS route_type code
    city_id    TEXT NOT NULL DEFAULT 'hyd'
);

CREATE TABLE mobility.transit_trips (
    id          TEXT PRIMARY KEY,           -- GTFS trip_id
    route_id    TEXT NOT NULL REFERENCES mobility.transit_routes(id),
    service_id  TEXT NOT NULL,
    headsign    TEXT,
    city_id     TEXT NOT NULL DEFAULT 'hyd'
);

CREATE TABLE mobility.transit_stop_times (
    trip_id       TEXT NOT NULL REFERENCES mobility.transit_trips(id),
    stop_id       TEXT NOT NULL REFERENCES mobility.transit_stops(id),
    stop_sequence INT NOT NULL,
    arrival_time  INTERVAL NOT NULL,
    departure_time INTERVAL NOT NULL,
    PRIMARY KEY (trip_id, stop_sequence)
);
CREATE INDEX idx_stoptimes_stop ON mobility.transit_stop_times(stop_id);

CREATE TABLE mobility.trip_feedback (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id    UUID NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    rating     SMALLINT CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT,
    outcome_duration_s INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (trip_id, user_id)
);

-- ============================================================
-- 5. HEALTH
-- ============================================================

CREATE TABLE health.records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL CHECK (record_type IN ('report','observation','condition','medication','appointment')),
    title       TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'user_entered',
    recorded_at DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_healthrec_user ON health.records(user_id, recorded_at DESC);
CREATE TRIGGER trg_healthrec_touch BEFORE UPDATE ON health.records
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE health.documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id   UUID NOT NULL REFERENCES health.records(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,              -- object-store key; separate encrypted bucket
    mime_type   TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE health.extractions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES health.documents(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'uploaded'
                 CHECK (status IN ('uploaded','processing','review_required','completed','failed')),
    extracted    JSONB NOT NULL DEFAULT '{}',   -- structured fields
    model_version TEXT,
    reviewed     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_extract_touch BEFORE UPDATE ON health.extractions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE health.observations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id   UUID REFERENCES health.records(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    metric      TEXT NOT NULL,               -- 'hemoglobin','blood_pressure_systolic',...
    value_num   NUMERIC NOT NULL,
    unit        TEXT NOT NULL,
    ref_low     NUMERIC,
    ref_high    NUMERIC,
    verified    BOOLEAN NOT NULL DEFAULT false,  -- user/clinician-confirmed
    observed_at DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_healthobs_user_metric ON health.observations(user_id, metric, observed_at DESC);

CREATE TABLE health.conditions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    code       TEXT,                        -- ICD-10 etc when known
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','chronic')),
    noted_on   DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE health.medications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    dosage      TEXT,
    schedule    TEXT,                        -- free-text or structured later
    active      BOOLEAN NOT NULL DEFAULT true,
    started_on  DATE,
    stopped_on  DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE health.insights (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    evidence    JSONB NOT NULL DEFAULT '[]',    -- referencing observations/records
    confidence  REAL CHECK (confidence BETWEEN 0 AND 1),
    dismissed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. FINANCE
-- ============================================================

CREATE TABLE finance.accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('cash','bank','wallet','credit_card','investment')),
    institution  TEXT,
    currency     CHAR(3) NOT NULL DEFAULT 'INR',
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    is_connected BOOLEAN NOT NULL DEFAULT false,  -- NEVER implied by manual entry
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE TABLE finance.transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    account_id    UUID NOT NULL REFERENCES finance.accounts(id) ON DELETE CASCADE,
    txn_date      DATE NOT NULL,
    amount        NUMERIC(18,2) NOT NULL,    -- signed: negative = expense
    currency      CHAR(3) NOT NULL DEFAULT 'INR',
    merchant      TEXT,
    description   TEXT,
    category_id   UUID,
    is_recurring_candidate BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_txn_user_date ON finance.transactions(user_id, txn_date DESC);
CREATE INDEX idx_txn_account ON finance.transactions(account_id, txn_date DESC);
CREATE TRIGGER trg_txn_touch BEFORE UPDATE ON finance.transactions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE finance.categories (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID REFERENCES identity.users(id) ON DELETE CASCADE,  -- NULL = system default
    name      TEXT NOT NULL,
    icon      TEXT,
    color     TEXT,
    parent_id UUID REFERENCES finance.categories(id),
    UNIQUE (user_id, name)
);

ALTER TABLE finance.transactions
    ADD CONSTRAINT fk_txn_category FOREIGN KEY (category_id) REFERENCES finance.categories(id);

CREATE TABLE finance.budgets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    period     TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
    start_date DATE NOT NULL,
    end_date   DATE,
    amount     NUMERIC(18,2) NOT NULL,
    currency   CHAR(3) NOT NULL DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_budget_touch BEFORE UPDATE ON finance.budgets
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE finance.budget_entries (
    budget_id   UUID NOT NULL REFERENCES finance.budgets(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES finance.categories(id),
    amount      NUMERIC(18,2) NOT NULL,
    PRIMARY KEY (budget_id, category_id)
);

-- ============================================================
-- 7. WORK
-- ============================================================

CREATE TABLE work.projects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work.tasks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES work.projects(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
    priority   SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),  -- 1=highest
    due_at     TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_user_status ON work.tasks(user_id, status, due_at);
CREATE TRIGGER trg_tasks_touch BEFORE UPDATE ON work.tasks
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE work.task_checklists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES work.tasks(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    done       BOOLEAN NOT NULL DEFAULT false,
    sequence   INT NOT NULL,
    UNIQUE (task_id, sequence)
);

CREATE TABLE work.calendar_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','google','outlook')),
    external_ref TEXT,                       -- provider event id when synced
    title       TEXT NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    location    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calevents_user ON work.calendar_events(user_id, starts_at);

-- ============================================================
-- 8. AUDIT
-- ============================================================

CREATE TABLE audit.access_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY,
    actor_id     UUID NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id  TEXT NOT NULL,
    action       TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE audit.access_log_default PARTITION OF audit.access_log DEFAULT;

CREATE TABLE audit.agent_action_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_run_id UUID NOT NULL,
    tool         TEXT NOT NULL,
    approval_id  UUID,
    result       TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
