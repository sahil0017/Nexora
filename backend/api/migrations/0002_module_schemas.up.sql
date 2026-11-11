-- Intelligence schema ---------------------------------------------------------
CREATE TABLE intelligence.conversations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    title      text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intelligence.messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES intelligence.conversations(id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content_ref     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intelligence.agent_runs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    status      text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','awaiting_approval','completed','failed','cancelled')),
    started_at  timestamptz,
    completed_at timestamptz
);

CREATE TABLE intelligence.tool_invocations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id uuid NOT NULL REFERENCES intelligence.agent_runs(id) ON DELETE CASCADE,
    tool_name    text NOT NULL,
    status       text NOT NULL DEFAULT 'pending',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intelligence.action_approvals (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id   uuid NOT NULL REFERENCES intelligence.agent_runs(id) ON DELETE CASCADE,
    action_summary text NOT NULL,
    status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','expired')),
    expires_at     timestamptz NOT NULL,
    decided_at     timestamptz
);

CREATE TABLE intelligence.context_references (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module      text NOT NULL,
    resource_id text NOT NULL,
    expires_at  timestamptz NOT NULL
);

CREATE TABLE intelligence.memory_items (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    category             text NOT NULL,
    encrypted_content_ref text NOT NULL,
    consent_scope        text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- Mobility schema ------------------------------------------------------------
CREATE TABLE mobility.saved_places (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       text NOT NULL,
    place_type text NOT NULL DEFAULT 'custom',
    location   geography(POINT, 4326) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mobility.trips (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz,
    status       text NOT NULL DEFAULT 'active',
    primary_mode text NOT NULL
);

CREATE TABLE mobility.trip_legs (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id   uuid NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    mode      text NOT NULL,
    sequence  int NOT NULL
);

CREATE TABLE mobility.location_samples (
    id          bigserial PRIMARY KEY,
    trip_id     uuid NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    location    geography(POINT, 4326) NOT NULL,
    speed       real,
    recorded_at timestamptz NOT NULL
) PARTITION BY RANGE (recorded_at);

CREATE TABLE mobility.location_samples_default
    PARTITION OF mobility.location_samples DEFAULT;

CREATE INDEX mobility_location_samples_gix
    ON mobility.location_samples USING gist (location);

CREATE TABLE mobility.road_segments (
    id       text PRIMARY KEY,
    city_id  text NOT NULL,
    geometry geometry(LINESTRING, 4326) NOT NULL,
    length_m double precision NOT NULL,
    speed_limit real
);

CREATE INDEX mobility_road_segments_gix
    ON mobility.road_segments USING gist (geometry);

CREATE TABLE mobility.traffic_observations (
    id              bigserial PRIMARY KEY,
    road_segment_id text NOT NULL REFERENCES mobility.road_segments(id),
    speed           real NOT NULL,
    source          text NOT NULL,
    observed_at     timestamptz NOT NULL
) PARTITION BY RANGE (observed_at);

CREATE TABLE mobility.traffic_observations_default
    PARTITION OF mobility.traffic_observations DEFAULT;

CREATE TABLE mobility.traffic_predictions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    road_segment_id text NOT NULL REFERENCES mobility.road_segments(id),
    model_version   text NOT NULL,
    predicted_speed real,
    horizon_minutes int NOT NULL,
    predicted_for   timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mobility.route_options (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id            uuid REFERENCES mobility.trips(id) ON DELETE CASCADE,
    provider           text NOT NULL,
    predicted_duration int,
    reliability        real
);

CREATE TABLE mobility.trip_feedback (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id  uuid NOT NULL REFERENCES mobility.trips(id) ON DELETE CASCADE,
    rating   int CHECK (rating BETWEEN 1 AND 5),
    feedback jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE mobility.transit_stops (
    id       text PRIMARY KEY,
    city_id  text NOT NULL,
    name     text NOT NULL,
    location geography(POINT, 4326) NOT NULL
);

CREATE TABLE mobility.transit_routes (
    id         text PRIMARY KEY,
    agency_id  text NOT NULL,
    route_type text NOT NULL
);

-- Health schema ---------------------------------------------------------------
CREATE TABLE health.records (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    record_type text NOT NULL,
    source      text,
    occurred_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE health.documents (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id      uuid NOT NULL REFERENCES health.records(id) ON DELETE CASCADE,
    storage_bucket text NOT NULL,
    storage_key    text NOT NULL,
    mime_type      text,
    upload_status  text NOT NULL DEFAULT 'uploaded'
                   CHECK (upload_status IN ('uploaded','processing','review_required','completed','failed'))
);

CREATE TABLE health.extractions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  uuid NOT NULL REFERENCES health.documents(id) ON DELETE CASCADE,
    extracted    jsonb NOT NULL DEFAULT '{}',
    verified     boolean NOT NULL DEFAULT false,
    verified_at  timestamptz
);

CREATE TABLE health.observations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id   uuid REFERENCES health.records(id) ON DELETE SET NULL,
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    metric      text NOT NULL,
    value_num   double precision,
    unit        text,
    ref_range   text,
    observed_at date NOT NULL,
    status      text NOT NULL DEFAULT 'extracted'
                CHECK (status IN ('extracted','user_confirmed','clinician_confirmed'))
);

-- Finance schema ---------------------------------------------------------------
CREATE TABLE finance.accounts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('manual','connected')),
    currency    char(3) NOT NULL DEFAULT 'INR',
    opening_balance numeric(18,2) NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.transactions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES finance.accounts(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    occurred_at timestamptz NOT NULL,
    amount      numeric(18,2) NOT NULL,
    currency    char(3) NOT NULL DEFAULT 'INR',
    merchant    text,
    description text,
    category_id uuid,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.categories (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name    text NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE finance.budgets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       text NOT NULL,
    period     text NOT NULL DEFAULT 'monthly',
    start_date date NOT NULL
);

CREATE TABLE finance.budget_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id   uuid NOT NULL REFERENCES finance.budgets(id) ON DELETE CASCADE,
    category_id uuid REFERENCES finance.categories(id),
    limit_amount numeric(18,2) NOT NULL
);

CREATE TABLE finance.balance_snapshots (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   uuid NOT NULL REFERENCES finance.accounts(id) ON DELETE CASCADE,
    balance      numeric(18,2) NOT NULL,
    currency     char(3) NOT NULL,
    snapshot_at  timestamptz NOT NULL DEFAULT now(),
    source       text NOT NULL
);

-- Work schema ------------------------------------------------------------------
CREATE TABLE work.projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work.tasks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    project_id  uuid REFERENCES work.projects(id) ON DELETE SET NULL,
    title       text NOT NULL,
    notes       text,
    due_at      timestamptz,
    priority    text NOT NULL DEFAULT 'medium',
    status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','done','cancelled')),
    completed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work.task_checklists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    uuid NOT NULL REFERENCES work.tasks(id) ON DELETE CASCADE,
    label      text NOT NULL,
    done       boolean NOT NULL DEFAULT false
);

CREATE TABLE work.calendar_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    title      text NOT NULL,
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL,
    source     text NOT NULL DEFAULT 'local'
);

CREATE TABLE work.automations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name       text NOT NULL,
    definition jsonb NOT NULL,
    enabled    boolean NOT NULL DEFAULT false
);

CREATE TABLE work.automation_runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id uuid NOT NULL REFERENCES work.automations(id) ON DELETE CASCADE,
    status       text NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);

-- Helpful indexes ---------------------------------------------------------------
CREATE INDEX idx_trips_user_started ON mobility.trips (user_id, started_at DESC);
CREATE INDEX idx_transactions_user_occurred ON finance.transactions (user_id, occurred_at DESC);
CREATE INDEX idx_tasks_user_status ON work.tasks (user_id, status);
CREATE INDEX idx_notifications_user_created ON notifications.notifications (user_id, created_at DESC);
